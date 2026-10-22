import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { openDb, StorageError } from "../src/storage/db.js";
import { migrate, MigrationError } from "../src/storage/migrate.js";
import { createRepo, ftsQuery, ValidationError } from "../src/storage/repo.js";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "rc-store-"));
const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);

function setup() {
    const home = tmp();
    const { db, file } = openDb(home);
    return { home, db, file, repo: createRepo(db, { now: () => NOW }) };
}

const msg = (over = {}) => ({
    channel: "imessage", account: "", providerMessageKey: "g1", threadKey: "t1", handle_norm: "+36301234567",
    isFromMe: false, tsMs: NOW - 1000, text: "hello", attachments: [], ...over,
});

test("first start creates schema, WAL, foreign keys and private permissions", () => {
    const { home, db, file } = setup();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table')").all().map((r) => r.name);
    for (const t of ["messages", "handles", "contacts", "contact_handles", "merge_log", "contact_summary", "sync_state", "messages_fts", "schema_migrations"]) {
        assert.ok(tables.includes(t), `missing ${t}`);
    }
    assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(home).mode & 0o777, 0o700);
    db.close();
});

test("migrations: re-run is a no-op, tampering is refused, failure rolls back", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "0001_a.sql"), "CREATE TABLE a (x INTEGER);");
    writeFileSync(path.join(dir, "0002_b.sql"), "CREATE TABLE b (x INTEGER);");
    const db = new Database(":memory:");
    assert.deepEqual(migrate(db, { dir }).applied, [1, 2]);
    assert.deepEqual(migrate(db, { dir }).applied, []);

    writeFileSync(path.join(dir, "0001_a.sql"), "CREATE TABLE a (x INTEGER, y INTEGER);");
    assert.throws(() => migrate(db, { dir }), (e) => e instanceof MigrationError && e.code === "migration_checksum_mismatch");

    const dir2 = tmp();
    writeFileSync(path.join(dir2, "0001_ok.sql"), "CREATE TABLE ok (x INTEGER);");
    writeFileSync(path.join(dir2, "0002_bad.sql"), "CREATE TABLE half (x INTEGER); THIS IS NOT SQL;");
    const db2 = new Database(":memory:");
    assert.throws(() => migrate(db2, { dir: dir2 }));
    assert.equal(db2.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='half'").get().n, 0, "failed migration must roll back");
    assert.equal(db2.prepare("SELECT MAX(version) v FROM schema_migrations").get().v, 1);
});

test("pre-migration backup keeps the last 3 copies", () => {
    const home = tmp();
    const dir = tmp();
    const file = path.join(home, "core.db");
    const db = new Database(file);
    db.pragma("journal_mode = WAL");
    for (let v = 1; v <= 6; v++) {
        writeFileSync(path.join(dir, `000${v}_m${v}.sql`), `CREATE TABLE t${v} (x INTEGER);`);
        migrate(db, { dir, dbFile: file });
    }
    const backups = readdirSync(home).filter((f) => f.includes(".bak-"));
    assert.equal(backups.length, 3);
});

test("upsert is idempotent and counts insert, update, skip", () => {
    const { repo, db } = setup();
    assert.deepEqual(repo.upsertMessages([msg(), msg({ providerMessageKey: "g2", text: "second" })]), { inserted: 2, updated: 0, skipped: 0, quarantined: 0 });
    assert.deepEqual(repo.upsertMessages([msg(), msg({ providerMessageKey: "g2", text: "second" })]), { inserted: 0, updated: 0, skipped: 2, quarantined: 0 });
    assert.equal(repo.upsertMessages([msg({ text: "edited" })]).updated, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages").get().n, 2);
    assert.equal(db.prepare("SELECT text FROM messages WHERE provider_message_key='g1'").get().text, "edited");
});

test("every handle gets exactly one auto contact and a summary", () => {
    const { repo, db } = setup();
    repo.upsertMessages([msg(), msg({ providerMessageKey: "g2", handle_norm: "a@example.com", channel: "email", subject: "Hi", text: "Body\n\n  text" })]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM contacts").get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM contact_handles").get().n, 2);
    const kinds = Object.fromEntries(db.prepare("SELECT handle_norm, kind FROM handles").all().map((r) => [r.handle_norm, r.kind]));
    assert.deepEqual(kinds, { "+36301234567": "phone", "a@example.com": "email" });
    const mail = db.prepare("SELECT s.* FROM contact_summary s JOIN contacts c ON c.id = s.contact_id WHERE c.display_name = 'a@example.com'").get();
    assert.equal(mail.last_preview, "Body text");
    assert.equal(mail.last_channel, "email");
    assert.deepEqual(JSON.parse(mail.counts_json), { imessage: 0, email: 1, whatsapp: 0 });
});

test("summary follows the latest message across linked handles and truncates previews", () => {
    const { repo, db } = setup();
    repo.upsertMessages([msg({ tsMs: NOW - 5000 })]);
    const a = db.prepare("SELECT contact_id FROM contact_handles WHERE handle_norm='+36301234567'").get().contact_id;
    repo.upsertMessages([msg({ providerMessageKey: "w1", channel: "whatsapp", handle_norm: "+36309999999@wa", tsMs: NOW - 100, isFromMe: true, text: "x".repeat(500) })]);
    const b = db.prepare("SELECT contact_id FROM contact_handles WHERE handle_norm='+36309999999@wa'").get().contact_id;
    db.prepare("UPDATE contact_handles SET contact_id = ? WHERE handle_norm = '+36309999999@wa'").run(a);
    repo.rebuildSummary(a);
    repo.rebuildSummary(b);
    const s = db.prepare("SELECT * FROM contact_summary WHERE contact_id = ?").get(a);
    assert.equal(s.last_channel, "whatsapp");
    assert.equal(s.last_from_me, 1);
    assert.equal(s.last_preview.length, 140);
    assert.equal(s.count_total, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM contact_summary WHERE contact_id = ?").get(b).n, 0);
});

test("invalid rows roll back the whole batch; bad timestamps are quarantined", () => {
    const { repo, db } = setup();
    assert.throws(() => repo.upsertMessages([msg(), msg({ providerMessageKey: "g2", handle_norm: "  " })]), ValidationError);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages").get().n, 0, "no partial batch");
    assert.throws(() => repo.upsertMessages([msg({ channel: "fax" })]), ValidationError);
    const r = repo.upsertMessages([msg({ tsMs: 0 }), msg({ providerMessageKey: "g3", tsMs: -5 }), msg({ providerMessageKey: "g4", tsMs: NOW + 3 * 86400000 }), msg({ providerMessageKey: "g5" })]);
    assert.deepEqual(r, { inserted: 1, updated: 0, skipped: 0, quarantined: 3 });
});

test("odd text is stored: emoji, RTL, NUL, huge bodies are capped", () => {
    const { repo, db } = setup();
    repo.upsertMessages([msg({ text: "😀 שלום \u0000 end" }), msg({ providerMessageKey: "big", text: "a".repeat(300 * 1024) })]);
    assert.ok(db.prepare("SELECT text FROM messages WHERE provider_message_key='g1'").get().text.includes("😀"));
    assert.equal(db.prepare("SELECT length(text) n FROM messages WHERE provider_message_key='big'").get().n, 256 * 1024);
});

test("full-text search: diacritics, edits, deletes, injection-like input", () => {
    const { repo, db } = setup();
    repo.upsertMessages([msg({ text: "Meeting at café tomorrow" }), msg({ providerMessageKey: "g2", subject: "Invoice 42", text: "see attached" })]);
    assert.equal(repo.search({ q: "cafe" }).length, 1);
    assert.equal(repo.search({ q: "invoice" }).length, 1);
    assert.equal(repo.search({ q: "mee" }).length, 1, "prefix match");
    repo.upsertMessages([msg({ text: "totally different" })]);
    assert.equal(repo.search({ q: "cafe" }).length, 0, "edit refreshes the index");
    assert.equal(repo.search({ q: "different" }).length, 1);
    db.prepare("DELETE FROM messages WHERE provider_message_key='g1'").run();
    assert.equal(repo.search({ q: "different" }).length, 0);
    for (const evil of ['" OR 1=1 --', "AND OR NOT", "*", '"', "a\"b", "NEAR(", "text:foo"]) {
        assert.doesNotThrow(() => repo.search({ q: evil }), evil);
    }
    assert.equal(ftsQuery('say "hi"'), '"say"* AND """hi"""*');
    assert.equal(ftsQuery("   "), "");
});

test("search can filter by channel and contact; snippets use control-character marks", () => {
    const { repo, db } = setup();
    repo.upsertMessages([msg({ text: "alpha beta" }), msg({ providerMessageKey: "e1", channel: "email", handle_norm: "x@example.com", text: "alpha gamma" })]);
    assert.equal(repo.search({ q: "alpha", channel: "email" }).length, 1);
    const cid = db.prepare("SELECT contact_id FROM contact_handles WHERE handle_norm='x@example.com'").get().contact_id;
    assert.equal(repo.search({ q: "alpha", contactId: cid }).length, 1);
    assert.ok(repo.search({ q: "alpha" })[0].snippet.includes("\u0001alpha\u0002"));
});

test("thread and contact list use keyset pagination in the documented order", () => {
    const { repo, db } = setup();
    const rows = [];
    for (let i = 0; i < 25; i++) rows.push(msg({ providerMessageKey: `k${String(i).padStart(2, "0")}`, tsMs: NOW - 100000 + Math.floor(i / 5) * 1000, text: `m${i}` }));
    repo.upsertMessages(rows);
    const cid = db.prepare("SELECT contact_id FROM contact_handles").get().contact_id;
    const seen = [];
    let cursor = {};
    for (;;) {
        const page = repo.getThread(cid, { limit: 7, ...cursor });
        if (!page.length) break;
        seen.push(...page.map((r) => r.id));
        const last = page.at(-1);
        cursor = { beforeTs: last.ts_ms, beforeId: last.id };
    }
    assert.equal(seen.length, 25);
    assert.equal(new Set(seen).size, 25, "no duplicates across pages");
    const ordered = [...seen].sort();
    assert.notDeepEqual(seen, ordered);

    repo.upsertMessages([msg({ providerMessageKey: "n1", handle_norm: "+36300000001", tsMs: NOW - 10 }), msg({ providerMessageKey: "n2", handle_norm: "+36300000002", tsMs: NOW - 20, channel: "whatsapp" })]);
    const list = repo.listContacts({});
    assert.deepEqual(list.map((r) => r.last_ts_ms), [...list.map((r) => r.last_ts_ms)].sort((a, b) => b - a));
    assert.equal(repo.listContacts({ channel: "whatsapp" }).length, 1);
    assert.equal(repo.listContacts({ query: "30000000" }).length, 2);
    assert.equal(repo.listContacts({ query: "100%" }).length, 0, "LIKE wildcards are escaped");
});

test("sync state defaults, merges patches and survives reopen", () => {
    const home = tmp();
    let { db } = openDb(home);
    let repo = createRepo(db);
    assert.equal(repo.getSyncState("imessage"), null);
    repo.setSyncState("imessage", "", { cursor_json: '{"rowid":5}', state: "running" });
    repo.setSyncState("imessage", "", { state: "idle", last_success_ms: 123, messages_total: 9 });
    db.close();
    ({ db } = openDb(home));
    repo = createRepo(db);
    assert.deepEqual(
        (({ cursor_json, state, last_success_ms, messages_total }) => ({ cursor_json, state, last_success_ms, messages_total }))(repo.getSyncState("imessage")),
        { cursor_json: '{"rowid":5}', state: "idle", last_success_ms: 123, messages_total: 9 },
    );
});

test("a corrupt database file is reported as storage_corrupt", () => {
    const home = tmp();
    mkdirSync(home, { recursive: true });
    writeFileSync(path.join(home, "core.db"), Buffer.alloc(4096, 7));
    assert.throws(() => openDb(home), (e) => e instanceof StorageError && e.code === "storage_corrupt");
});

test("a killed process mid-batch leaves the database consistent", async () => {
    const home = tmp();
    const { db } = openDb(home);
    createRepo(db).upsertMessages([msg()]);
    db.close();
    const script = `
        import Database from "better-sqlite3";
        const db = new Database(${JSON.stringify(path.join(home, "core.db"))});
        db.pragma("journal_mode = WAL");
        db.exec("BEGIN");
        const ins = db.prepare("INSERT INTO messages (id, channel, account, provider_message_key, thread_key, handle_norm, is_from_me, ts_ms, text, ingested_at) VALUES (?, 'imessage', '', ?, 't', '+1', 0, 1, 'x', 1)");
        for (let i = 0; i < 5000; i++) ins.run("imessage::p" + i, "p" + i);
        console.log("ready");
        setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: path.resolve("."), stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((resolve) => child.stdout.once("data", resolve));
    child.kill("SIGKILL");
    await new Promise((resolve) => child.on("exit", resolve));
    const { db: db2 } = openDb(home);
    assert.equal(db2.pragma("quick_check", { simple: true }), "ok");
    assert.equal(db2.prepare("SELECT COUNT(*) n FROM messages").get().n, 1, "uncommitted batch must not be visible");
    db2.close();
});

test("performance budgets hold on a 100k-message corpus (3x tolerance)", { timeout: 120000 }, () => {
    const { repo, db } = setup();
    const words = ["alpha", "invoice", "meeting", "dinner", "photo", "ticket", "report", "lunch", "birthday", "project"];
    const people = Array.from({ length: 2000 }, (_, i) => `+3630${String(1000000 + i)}`);
    const t0 = performance.now();
    for (let b = 0; b < 20; b++) {
        const batch = [];
        for (let i = 0; i < 5000; i++) {
            const n = b * 5000 + i;
            batch.push(msg({ providerMessageKey: `p${n}`, handle_norm: people[n % people.length], tsMs: NOW - n * 1000, channel: n % 3 === 0 ? "email" : "imessage", text: `${words[n % 10]} ${words[(n * 7) % 10]} note ${n}` }));
        }
        const t1 = performance.now();
        repo.upsertMessages(batch);
        assert.ok(performance.now() - t1 < 4500, "5,000-message batch must stay under 3x1.5 s");
    }
    const time = (fn) => { const s = performance.now(); fn(); return performance.now() - s; };
    const cid = db.prepare("SELECT contact_id FROM contact_handles WHERE handle_norm = ?").get(people[0]).contact_id;
    time(() => repo.listContacts({ limit: 50 }));
    assert.ok(time(() => repo.listContacts({ limit: 50 })) < 90, "contact list page");
    assert.ok(time(() => repo.getThread(cid, { limit: 50 })) < 45, "thread page");
    assert.ok(time(() => repo.search({ q: "invoice meeting" })) < 240, "search");
    assert.ok(performance.now() - t0 < 100000);
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM messages WHERE handle_norm IN (?) ORDER BY ts_ms DESC, id DESC LIMIT 50").all(people[0]).map((r) => r.detail).join(" ");
    assert.match(plan, /messages_handle_ts/);
    assert.ok(readFileSync(path.join(path.resolve("."), "src/storage/migrations/0001_init.sql"), "utf8").length > 0);
});

test("mail to yourself is one message: the other account's copy is collapsed, the longer text wins, old twins are cleaned up", () => {
    const mail = (account, key, text, over = {}) => msg({ channel: "email", account, providerMessageKey: key, handle_norm: "me@example.com", isFromMe: true, subject: "Test", tsMs: NOW - 5000, text, ...over });
    const count = (db) => db.prepare("SELECT COUNT(*) n FROM messages WHERE channel = 'email'").get().n;

    // the received copy (no body yet) first, then the sent copy with the body
    const a = setup();
    assert.equal(a.repo.upsertMessages([mail("inbox", "15", "Test")]).inserted, 1);
    const r = a.repo.upsertMessages([mail("sent", "15", "Test\n\nthe body")]);
    assert.deepEqual([r.inserted, r.updated], [0, 1]);
    assert.equal(count(a.db), 1);
    assert.equal(a.db.prepare("SELECT text FROM messages WHERE channel = 'email'").get().text, "Test\n\nthe body");

    // the sent copy first, then the shorter received copy: skipped
    const b = setup();
    b.repo.upsertMessages([mail("sent", "15", "Test\n\nthe body")]);
    const r2 = b.repo.upsertMessages([mail("inbox", "15", "Test")]);
    assert.deepEqual([r2.inserted, r2.skipped], [0, 1]);
    assert.equal(count(b.db), 1);
    assert.equal(b.db.prepare("SELECT count_total n FROM contact_summary").get().n, 1);

    // not the same mail: another second, another subject, someone else's mail, or the same account
    const c = setup();
    c.repo.upsertMessages([mail("sent", "1", "x")]);
    c.repo.upsertMessages([mail("inbox", "2", "x", { tsMs: NOW - 4000 }), mail("inbox", "3", "x", { subject: "Other" }), mail("inbox", "4", "x", { isFromMe: false }), mail("sent", "5", "x")]);
    assert.equal(count(c.db), 5);

    // twins stored before this rule are removed once, with the summary rebuilt
    const d = setup();
    d.db.pragma("foreign_keys = OFF");
    d.repo.upsertMessages([mail("sent", "15", "Test\n\nthe body")]);
    d.db.prepare("INSERT INTO messages (id, channel, account, provider_message_key, thread_key, handle_norm, is_from_me, ts_ms, subject, text, attachments_json, meta_json, ingested_at) SELECT 'email:inbox:15', channel, 'inbox', '15', thread_key, handle_norm, is_from_me, ts_ms, subject, 'Test', attachments_json, meta_json, ingested_at FROM messages").run();
    assert.equal(count(d.db), 2);
    assert.equal(d.repo.dedupeSelfMail(), 1);
    assert.equal(count(d.db), 1);
    assert.equal(d.db.prepare("SELECT text FROM messages WHERE channel = 'email'").get().text, "Test\n\nthe body");
    assert.equal(d.db.prepare("SELECT count_total n FROM contact_summary").get().n, 1);
    assert.equal(d.repo.dedupeSelfMail(), 0, "nothing more to do");
});
