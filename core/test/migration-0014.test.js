import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/storage/db.js";
import { checkFreeSpace, HOOKS, migrate, MigrationError } from "../src/storage/migrate.js";
import { createRepo } from "../src/storage/repo.js";

const SRC = new URL("../src/storage/migrations/", import.meta.url).pathname;
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "rc-m14-"));
const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);

// a database exactly as it is at version 13
function v13() {
    const home = tmp();
    const dir = path.join(tmp(), "migrations");
    mkdirSync(dir);
    for (const f of readdirSync(SRC).filter((x) => /^\d{4}_/.test(x) && Number(x.slice(0, 4)) <= 13)) copyFileSync(path.join(SRC, f), path.join(dir, f));
    const { db, file } = openDb(home, { migrationsDir: dir });
    return { home, db, file };
}
function fill(db) {
    const repo = createRepo(db, { now: () => NOW });
    const msg = (n, channel, handle, extra = {}) => ({ channel, account: "", providerMessageKey: `k${n}`, threadKey: "t", handle_norm: handle, isFromMe: n % 2 === 0, tsMs: NOW - n * 1000, text: `hello world ${n} ${channel}`, subject: channel === "email" ? `Subject ${n}` : undefined, attachments: [], ...extra });
    repo.upsertMessages([msg(1, "imessage", "+36301234567"), msg(2, "email", "anna@example.com"), msg(3, "whatsapp", "+36301234567@wa"), msg(4, "imessage", "+36301234567"), msg(5, "email", "anna@example.com", { attachments: [{ name: "a.pdf", mimeType: "application/pdf", bytes: 10 }] })]);
    db.prepare("INSERT INTO handoffs (id, ts_ms, contact_id, channel, handle_kind, text_length) VALUES ('h1', 1, 'c1', 'imessage', 'phone', 5), ('h2', 2, 'c1', 'whatsapp', 'whatsapp', 7)").run();
    db.prepare("INSERT INTO sends (id, client_id, ts_ms, contact_id, channel, handle_kind, text_length, status, error_code, done_ms) VALUES ('s1', 'client-0001', 1, 'c1', 'imessage', 'phone', 5, 'sent', NULL, 2), ('s2', 'client-0002', 3, 'c1', 'email', 'email', 9, 'failed', 'automation_denied', 4)").run();
}
const dump = (db) => JSON.stringify({
    messages: db.prepare("SELECT rowid AS rid, * FROM messages ORDER BY rowid").all(),
    handoffs: db.prepare("SELECT * FROM handoffs ORDER BY rowid").all(),
    sends: db.prepare("SELECT * FROM sends ORDER BY rowid").all(),
    summary: db.prepare("SELECT * FROM contact_summary ORDER BY contact_id").all(),
});
const search = (db, q) => db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rowid").all(q).map((r) => r.rowid);
const upgrade = (home) => openDb(home);

test("0014 keeps every row, rowid and search result, and allows any well-formed channel", () => {
    const { home, db, file } = v13();
    fill(db);
    const before = dump(db);
    const probes = ["hello", "world", "imessage", "whatsapp", "Subject"].map((q) => [q, search(db, q)]);
    assert.throws(() => db.prepare("INSERT INTO handoffs (id, ts_ms, contact_id, channel, handle_kind, text_length) VALUES ('x', 1, 'c', 'telegram', 'other', 1)").run(), /CHECK/, "version 13 refuses a new channel");
    db.close();

    const { db: after } = upgrade(home);
    assert.equal(after.prepare("SELECT MAX(version) v FROM schema_migrations").get().v, 14);
    assert.equal(dump(after), before, "every row and rowid identical");
    for (const [q, rows] of probes) assert.deepEqual(search(after, q), rows, `search for ${q}`);
    after.prepare("INSERT INTO messages_fts(messages_fts, rank) VALUES ('integrity-check', 1)").run();
    assert.equal(after.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(after.pragma("foreign_key_check"), []);
    assert.ok(existsSync(`${file}.bak-13`), "the pre-migration copy exists");

    const ins = (table) => after.prepare(table === "messages"
        ? "INSERT INTO messages (id, channel, account, provider_message_key, thread_key, handle_norm, is_from_me, ts_ms, text, attachments_json, ingested_at) VALUES (?, ?, '', ?, 't', 'h', 0, 1, 'x', '[]', 1)"
        : table === "handoffs" ? "INSERT INTO handoffs (id, ts_ms, contact_id, channel, handle_kind, text_length) VALUES (?, 1, 'c', ?, 'other', 1)"
        : "INSERT INTO sends (id, client_id, ts_ms, contact_id, channel, handle_kind, text_length, status) VALUES (?, ?, 1, 'c', ?, 'other', 1, 'sent')");
    const run = (table, id, channel) => (table === "messages" ? ins(table).run(id, channel, id) : table === "sends" ? ins(table).run(id, `client-${id}`.padEnd(12, "x"), channel) : ins(table).run(id, channel));
    for (const table of ["messages", "handoffs", "sends"]) {
        for (const ok of ["telegram", "beeper-signal", "a", "x".repeat(32), "abc_123"]) run(table, `${table}-${ok}`.slice(0, 40), ok);
        for (const bad of ["", "x".repeat(33), "Telegram", "tele gram", "tele;gram", "1tele", "-tele", "tele\n"]) assert.throws(() => run(table, `bad-${table}`, bad), /CHECK/, `${table} refuses ${JSON.stringify(bad)}`);
    }
    after.close();
});

test("0014: nothing references the rebuilt tables, so dropping them is safe with foreign keys on", () => {
    const { db } = v13();
    for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)) {
        const refs = db.prepare(`PRAGMA foreign_key_list(${JSON.stringify(t)})`).all().map((r) => r.table);
        for (const rebuilt of ["messages", "handoffs", "sends"]) assert.ok(!refs.includes(rebuilt), `${t} references ${rebuilt}`);
    }
    db.close();
});

test("0014: a failing check rolls the whole migration back and leaves version 13 untouched", () => {
    const { db, file } = v13();
    fill(db);
    const before = dump(db);
    db.close();
    const dir = path.join(tmp(), "m"); mkdirSync(dir);
    for (const f of readdirSync(SRC).filter((x) => /^\d{4}_/.test(x))) copyFileSync(path.join(SRC, f), path.join(dir, f));
    // use the runner directly on the real file (openDb would apply the default hooks)
    for (const [name, hooks, code] of [
        ["injected failure after the SQL", { 14: { ...HOOKS[14], after() { throw new MigrationError("injected", "boom"); } } }, "injected"],
        ["a row lost while rebuilding", { 14: { ...HOOKS[14], after(d, snap) { d.prepare("DELETE FROM messages WHERE rowid = (SELECT MAX(rowid) FROM messages)").run(); HOOKS[14].after(d, snap); } } }, "migration_verify_failed"],
    ]) {
        const raw = new (db.constructor)(file);
        raw.pragma("foreign_keys = ON");
        assert.throws(() => migrate(raw, { dir, dbFile: file, hooks }), (e) => e.code === code, name);
        assert.equal(raw.prepare("SELECT MAX(version) v FROM schema_migrations").get().v, 13, `${name}: still version 13`);
        assert.equal(dump(raw), before, `${name}: data untouched`);
        assert.ok(!raw.prepare("SELECT 1 FROM sqlite_master WHERE name LIKE '%_new'").get(), `${name}: no half-built tables`);
        assert.throws(() => raw.prepare("INSERT INTO handoffs (id, ts_ms, contact_id, channel, handle_kind, text_length) VALUES ('x', 1, 'c', 'telegram', 'other', 1)").run(), /CHECK/, `${name}: old constraint still in place`);
        raw.close();
    }
});

test("0014: not enough free disk is refused before anything is touched, with a plain message", () => {
    const { db, file } = v13();
    fill(db);
    const tiny = () => ({ bavail: 10, bsize: 1024 });
    assert.throws(() => checkFreeSpace(file, { statfs: tiny }), (e) => e.code === "not_enough_disk" && /MB free to upgrade/.test(e.message) && /reply-core restore/.test(e.message));
    assert.doesNotThrow(() => checkFreeSpace(file, { statfs: () => ({ bavail: 1e9, bsize: 4096 }) }));
    assert.doesNotThrow(() => checkFreeSpace(undefined), "no file (in-memory test database): nothing to check");
    db.close();
});

test("0014: 100,000 messages migrate in well under a minute", () => {
    const { home, db } = v13();
    db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100000)
      INSERT INTO messages (id, channel, account, provider_message_key, thread_key, handle_norm, is_from_me, ts_ms, subject, text, attachments_json, ingested_at)
      SELECT 'm' || i, CASE i % 3 WHEN 0 THEN 'email' WHEN 1 THEN 'imessage' ELSE 'whatsapp' END, '', 'p' || i, 't', '+3630' || (i % 500), i % 2, 1000000 + i, NULL, 'word' || (i % 97) || ' hello', '[]', 1 FROM n`);
    const before = db.prepare("SELECT COUNT(*) n, SUM(rowid) r FROM messages").get();
    db.close();
    const t0 = performance.now();
    const { db: after } = upgrade(home);
    const ms = performance.now() - t0;
    assert.deepEqual(after.prepare("SELECT COUNT(*) n, SUM(rowid) r FROM messages").get(), before);
    assert.equal(search(after, "word7").length, after.prepare("SELECT COUNT(*) n FROM messages WHERE text LIKE 'word7 %'").get().n, "search still finds every message at scale");
    console.log(`# 0014 on 100,000 messages: ${Math.round(ms)} ms`);
    assert.ok(ms < 60_000, `took ${Math.round(ms)} ms`);
    after.close();
});
