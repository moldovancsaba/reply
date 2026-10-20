import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { candidatePaths, cleanStaleCopies, createWhatsAppConnector, probeFile, resolveDbPath, schemaProblem, toNormalized } from "../src/connectors/whatsapp.js";
import { createRunner } from "../src/connectors/runner.js";
import { normalizeHandle } from "../src/identity/normalize.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { buildFixtures } from "./fixtures/build.js";
import { memoryLogger } from "./helpers.js";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "rc-wat-"));
const stale = () => readdirSync(os.tmpdir()).filter((n) => n.startsWith("rc-wa-")).sort();
let fx;
let root;
test.before(async () => { root = tmp(); fx = await buildFixtures({ seed: 42, out: path.join(root, "fx") }); });
test.after(() => rmSync(root, { recursive: true, force: true }));

function pipeline(dbPath, { pageLimit = 500, forceCopy = false, logger } = {}) {
    const home = tmp();
    const { db } = openDb(home);
    const repo = createRepo(db);
    const runner = createRunner({ db, repo, pageLimit, logger, sleep: async () => {} });
    const connector = createWhatsAppConnector({ config: { whatsappDb: dbPath, defaultRegion: "HU" }, logger, forceCopy });
    return { db, repo, runner, connector };
}

const row = (over = {}) => ({ Z_PK: 7, ZTEXT: "hello", ZMESSAGEDATE: 780000000, ZISFROMME: 0, ZFROMJID: "36301234567@s.whatsapp.net", ZMEDIAITEM: null, ZMESSAGETYPE: 0, ZSESSIONJID: "36301234567@s.whatsapp.net", ...over });

test("paths: an explicit one wins, then the first existing candidate, else the primary", () => {
    assert.equal(resolveDbPath({ whatsappDb: "/x/db.sqlite" }), "/x/db.sqlite");
    const home = tmp();
    const second = candidatePaths(home)[1];
    mkdirSync(path.dirname(second), { recursive: true });
    writeFileSync(second, "");
    assert.equal(resolveDbPath({}, home), second);
    const empty = tmp();
    assert.equal(resolveDbPath({}, empty), candidatePaths(empty)[0], "falls back to the primary path so errors name it");
    assert.equal(candidatePaths("/h").length, 4);
});

test("toNormalized: direct, group with sender, media, system, status, empty, lid, timestamps", () => {
    const d = toNormalized(row(), "HU").message;
    assert.deepEqual([d.channel, d.handle_norm, d.providerMessageKey, d.threadKey, d.isFromMe, d.text, d.meta], ["whatsapp", "+36301234567@wa", "7", "36301234567@s.whatsapp.net", false, "hello", {}]);
    assert.equal(d.tsMs, (780000000 + 978307200) * 1000, "Core Data seconds");
    assert.equal(toNormalized(row({ ZMESSAGEDATE: 780000000.6 }), "HU").message.tsMs, Math.round((780000000.6 + 978307200) * 1000));
    assert.equal(d.handle_norm, normalizeHandle("+36301234567", "whatsapp").handle_norm);
    const g = toNormalized(row({ ZSESSIONJID: "120363000000000001@g.us", ZFROMJID: "36309999999@s.whatsapp.net" }), "HU").message;
    assert.deepEqual([g.handle_norm, g.meta], ["group:120363000000000001@g.us", { isGroup: true, sender: "+36309999999@wa" }]);
    const mine = toNormalized(row({ ZSESSIONJID: "120363000000000001@g.us", ZISFROMME: 1 }), "HU").message;
    assert.deepEqual(mine.meta, { isGroup: true });
    assert.equal(toNormalized(row({ ZTEXT: null, ZMEDIAITEM: 5 }), "HU").message.text, "[Media attachment]");
    assert.equal(toNormalized(row({ ZTEXT: "  text  ", ZMEDIAITEM: 5 }), "HU").message.text, "text");
    assert.deepEqual(toNormalized(row({ ZMESSAGETYPE: 10 }), "HU"), { skip: "system" });
    assert.deepEqual(toNormalized(row({ ZSESSIONJID: "status@broadcast" }), "HU"), { skip: "system" });
    assert.deepEqual(toNormalized(row({ ZTEXT: "  ", ZMEDIAITEM: null }), "HU"), { skip: "empty" });
    assert.deepEqual(toNormalized(row({ ZTEXT: null }), "HU"), { skip: "empty" });
    assert.equal(toNormalized(row({ ZSESSIONJID: "98765@lid" }), "HU").message.handle_norm, "other:98765@lid");
    assert.deepEqual(toNormalized(row({ ZSESSIONJID: "" }), "HU"), { skip: "bad_handle" });
});

test("fixture import: counts, direction, groups, media and system rows, idempotent second run", async () => {
    const before = stale();
    const p = pipeline(fx.whatsapp);
    const run = await p.runner.start(p.connector, "").done;
    assert.equal(run.outcome, "ok");
    const src = new Database(fx.whatsapp, { readonly: true });
    const total = src.prepare("SELECT COUNT(*) n FROM ZWAMESSAGE").get().n;
    const system = src.prepare("SELECT COUNT(*) n FROM ZWAMESSAGE WHERE ZMESSAGETYPE = 10 OR ZTOJID = 'status@broadcast' OR ZCHATSESSION = 101").get().n;
    const empty = src.prepare("SELECT COUNT(*) n FROM ZWAMESSAGE WHERE ZMESSAGETYPE != 10 AND ZCHATSESSION != 101 AND (ZTEXT IS NULL OR TRIM(ZTEXT) = '') AND ZMEDIAITEM IS NULL").get().n;
    assert.ok(system > 1 && total === 201);
    assert.equal(run.inserted, total - system - empty);
    assert.equal(p.db.prepare("SELECT COUNT(*) n FROM messages WHERE channel = 'whatsapp'").get().n, run.inserted);
    const media = src.prepare("SELECT Z_PK FROM ZWAMESSAGE WHERE ZTEXT IS NULL AND ZMEDIAITEM IS NOT NULL AND ZMESSAGETYPE != 10").all();
    assert.ok(media.length > 0);
    for (const { Z_PK } of media) assert.equal(p.db.prepare("SELECT text FROM messages WHERE provider_message_key = ?").get(String(Z_PK)).text, "[Media attachment]");
    const groups = p.db.prepare("SELECT handle_norm, meta_json, is_from_me FROM messages WHERE handle_norm LIKE 'group:%'").all();
    assert.ok(groups.length > 0 && new Set(groups.map((g) => g.handle_norm)).size === 1);
    for (const g of groups.filter((x) => !x.is_from_me)) assert.match(JSON.parse(g.meta_json).sender, /^\+1212555\d{4}@wa$/);
    const direct = p.db.prepare("SELECT DISTINCT handle_norm FROM messages WHERE handle_norm NOT LIKE 'group:%'").all().map((r) => r.handle_norm);
    assert.ok(direct.length > 5 && direct.every((h) => /^\+\d{8,15}@wa$/.test(h)));
    assert.ok(p.db.prepare("SELECT COUNT(*) n FROM messages WHERE is_from_me = 1").get().n > 0);
    assert.equal(p.db.prepare("SELECT COUNT(*) n FROM messages WHERE handle_norm LIKE '%status%'").get().n, 0);
    const again = await p.runner.start(p.connector, "").done;
    assert.deepEqual([again.inserted, again.updated, again.outcome], [0, 0, "ok"]);
    assert.deepEqual(JSON.parse(p.repo.getSyncState("whatsapp", "").cursor_json), { pk: 201, db: "FIXTURE-UUID-0001" });
    assert.deepEqual(stale(), before, "no temporary copies left behind");
    src.close();
});

test("a WhatsApp number shares a contact with iMessage only through the address book", async () => {
    const p = pipeline(fx.whatsapp);
    await p.runner.start(p.connector, "").done;
    p.repo.upsertMessages([{ channel: "imessage", account: "", providerMessageKey: "i1", threadKey: "t", handle_norm: "+12125550100", isFromMe: false, tsMs: Date.UTC(2026, 0, 1), text: "sms", attachments: [] }]);
    const a = p.db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = '+12125550100'").get().c;
    const w = p.db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = '+12125550100@wa'").get()?.c;
    assert.ok(w && w !== a, "different handles, different contacts, until linked");
});

test("paging in small pages gives the same database; copy mode gives the same result and cleans up", async () => {
    const big = pipeline(fx.whatsapp);
    await big.runner.start(big.connector, "").done;
    const small = pipeline(fx.whatsapp, { pageLimit: 23 });
    const r = await small.runner.start(small.connector, "").done;
    assert.ok(r.pages >= 8);
    const before = stale();
    const copy = pipeline(fx.whatsapp, { pageLimit: 40, forceCopy: true });
    await copy.runner.start(copy.connector, "").done;
    const dump = (db) => JSON.stringify(db.prepare("SELECT id, handle_norm, text, ts_ms, is_from_me, meta_json FROM messages ORDER BY id").all());
    assert.equal(dump(small.db), dump(big.db));
    assert.equal(dump(copy.db), dump(big.db));
    assert.deepEqual(stale(), before, "the temp copy is removed when the run finishes");
});

test("a live WAL database that SQLite cannot open in place is read from a temporary copy", async () => {
    const dir = path.join(tmp(), "wa");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "ChatStorage.sqlite");
    cpSync(fx.whatsapp, file);
    const live = new Database(file);
    live.pragma("journal_mode = WAL");
    live.pragma("wal_autocheckpoint = 0");
    live.prepare("INSERT INTO ZWAMESSAGE (Z_PK, ZTEXT, ZMESSAGEDATE, ZISFROMME, ZFROMJID, ZTOJID, ZCHATSESSION, ZMEDIAITEM, ZMESSAGETYPE) VALUES (9001, 'only in the wal', 780000000, 0, '12125550100@s.whatsapp.net', 'x', 1, NULL, 0)").run();
    assert.ok(existsSync(`${file}-wal`), "the new row lives in the write-ahead log");
    const before = stale();
    const p = pipeline(file);
    const run = await p.runner.start(p.connector, "").done;
    live.close();
    assert.equal(run.outcome, "ok");
    assert.equal(p.db.prepare("SELECT text FROM messages WHERE provider_message_key = '9001'").get().text, "only in the wal", "uncheckpointed rows are seen");
    assert.deepEqual(stale(), before);
});

test("the temp copy is removed on failure and on abort too", async () => {
    const before = stale();
    const odd = path.join(tmp(), "ChatStorage.sqlite");
    const d = new Database(odd);
    d.exec("CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY)");
    d.close();
    const c = createWhatsAppConnector({ config: { whatsappDb: odd }, forceCopy: true });
    await assert.rejects(c.fetch("", {}, { limit: 10 }), (e) => e.code === "schema_unsupported");
    c.close();
    assert.deepEqual(stale(), before, "failure leaves nothing");
    const ok = createWhatsAppConnector({ config: { whatsappDb: fx.whatsapp }, forceCopy: true });
    await ok.fetch("", {}, { limit: 10 }); // more pages follow: the copy is kept for reuse
    assert.notDeepEqual(stale(), before);
    ok.close(); // as the scheduler does on shutdown
    assert.deepEqual(stale(), before);
});

test("stale copies from a crash are removed after an hour", () => {
    const dir = tmp();
    const old = path.join(dir, "rc-wa-old");
    const recent = path.join(dir, "rc-wa-recent");
    mkdirSync(old);
    mkdirSync(recent);
    const t = (Date.now() - 2 * 3_600_000) / 1000;
    utimesSync(old, t, t);
    assert.equal(cleanStaleCopies(dir), 1);
    assert.deepEqual(readdirSync(dir), ["rc-wa-recent"]);
});

test("a schema that changed is blocked and nothing is written", async () => {
    for (const [name, sql] of [["missing column", "ALTER TABLE ZWAMESSAGE DROP COLUMN ZMESSAGETYPE"], ["missing table", "DROP TABLE ZWACHATSESSION"], ["no metadata", "DROP TABLE Z_METADATA"]]) {
        const file = path.join(tmp(), "ChatStorage.sqlite");
        cpSync(fx.whatsapp, file);
        const d = new Database(file);
        d.exec(sql);
        d.close();
        const p = pipeline(file);
        const run = await p.runner.start(p.connector, "").done;
        assert.deepEqual([run.outcome, run.errorCode], ["blocked", "schema_unsupported"], name);
        assert.equal(p.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 0, name);
        assert.equal(p.repo.getSyncState("whatsapp", "").state, "blocked");
        const pre = await p.connector.preflight();
        assert.match(pre.hint, /changed its data format/);
    }
    const d = new Database(fx.whatsapp, { readonly: true });
    assert.equal(schemaProblem(d), null);
    d.close();
});

test("preflight: missing, unreadable, ok", async () => {
    assert.deepEqual(await createWhatsAppConnector({ config: { whatsappDb: "/nonexistent/ChatStorage.sqlite" } }).preflight(), { ok: false, code: "source_missing", hint: "WhatsApp Desktop has no data on this Mac. Install it and link your phone." });
    const locked = path.join(tmp(), "ChatStorage.sqlite");
    cpSync(fx.whatsapp, locked);
    chmodSync(locked, 0o000);
    const denied = await createWhatsAppConnector({ config: { whatsappDb: locked } }).preflight();
    assert.deepEqual([denied.ok, denied.code], [false, "permission_denied"]);
    assert.match(denied.hint, /Full Disk Access/);
    assert.deepEqual(await createWhatsAppConnector({ config: { whatsappDb: fx.whatsapp } }).preflight(), { ok: true });
});

test("a replaced database (new identity) restarts from the beginning with a warning", async () => {
    const { logger, lines } = memoryLogger();
    const c = createWhatsAppConnector({ config: { whatsappDb: fx.whatsapp }, logger });
    const page = await c.fetch("", { pk: 150, db: "SOME-OLD-UUID" }, { limit: 500 });
    assert.ok(page.messages.length > 150, "everything is read again");
    assert.deepEqual(page.nextCursor, { pk: 201, db: "FIXTURE-UUID-0001" });
    assert.ok(lines.join("").includes("identity changed"));
    const same = await c.fetch("", { pk: 150, db: "FIXTURE-UUID-0001" }, { limit: 500 });
    assert.ok(same.messages.length < 51);
});

test("a failure mid-import resumes from the committed cursor", async () => {
    const p = pipeline(fx.whatsapp, { pageLimit: 50 });
    let n = 0;
    const real = p.connector.fetch;
    p.connector.fetch = async (...a) => { if (++n === 2) throw Object.assign(new Error("busy"), { code: "source_locked" }); return real(...a); };
    const run = await p.runner.start(p.connector, "").done;
    assert.deepEqual([run.outcome, run.attempts], ["ok", 1]);
    const clean = pipeline(fx.whatsapp);
    await clean.runner.start(clean.connector, "").done;
    assert.equal(p.db.prepare("SELECT COUNT(*) n FROM messages").get().n, clean.db.prepare("SELECT COUNT(*) n FROM messages").get().n);
});

test("logs carry counts only: no text, number or name", async () => {
    const { logger, lines } = memoryLogger();
    const p = pipeline(fx.whatsapp, { logger });
    await p.runner.start(p.connector, "").done;
    const out = lines.join("");
    assert.ok(out.includes("connector.whatsapp page"));
    for (const secret of ["Schedule", "meeting", "12125550", "s.whatsapp.net", "[Media"]) assert.ok(!out.includes(secret), `leaked ${secret}`);
});

test("a macOS permission dialog that nobody has answered yet blocks politely and never piles up processes", async () => {
    const waiting = () => Promise.reject(Object.assign(new Error("w"), { code: "EPERM_WAIT" }));
    const c = createWhatsAppConnector({ config: { whatsappDb: fx.whatsapp }, probe: waiting });
    const t0 = performance.now();
    const pre = await c.preflight();
    assert.deepEqual([pre.ok, pre.code], [false, "permission_denied"]);
    assert.match(pre.hint, /permission dialog/);
    assert.ok(performance.now() - t0 < 1000);
    await assert.rejects(c.fetch("", {}, { limit: 10 }), (e) => e.code === "permission_denied" && /permission dialog/.test(e.hint));
});

test("probeFile: ok, missing, refused, and a blocked open is killed at the deadline (single flight)", async () => {
    await probeFile(fx.whatsapp);
    await assert.rejects(probeFile("/nonexistent/x"), (e) => e.code === "ENOENT");
    const locked = path.join(tmp(), "f");
    writeFileSync(locked, "x");
    chmodSync(locked, 0o000);
    await assert.rejects(probeFile(locked), (e) => e.code === "EACCES");
    const fifo = path.join(tmp(), "fifo");
    const { execFileSync } = await import("node:child_process");
    execFileSync("mkfifo", [fifo]); // opening a fifo for reading blocks until a writer appears, like an unanswered dialog
    const t0 = performance.now();
    const results = await Promise.allSettled([probeFile(fifo, 300), probeFile(fifo, 300)]);
    assert.deepEqual(results.map((r) => r.reason?.code), ["EPERM_WAIT", "EPERM_WAIT"]);
    assert.ok(performance.now() - t0 < 2000);
    await new Promise((r) => setTimeout(r, 100));
    const { spawnSync } = await import("node:child_process");
    assert.equal(spawnSync("pgrep", ["-f", `if=${fifo}`]).status, 1, "no probe process is left behind");
});

test("confirmSent: finds your message in the chat of that number, says when it is in another chat, none, or unavailable", async () => {
    const file = path.join(tmp(), "ChatStorage.sqlite");
    cpSync(fx.whatsapp, file);
    const d = new Database(file);
    const pk = (sql) => d.prepare(sql).get();
    const chat = pk("SELECT MAX(Z_PK) n FROM ZWACHATSESSION").n + 1;
    const other = chat + 1;
    const nowS = Date.now() / 1000 - 978307200;
    d.prepare("INSERT INTO ZWACHATSESSION (Z_PK, ZCONTACTJID, ZPARTNERNAME) VALUES (?, '36309998888@s.whatsapp.net', 'Target'), (?, '36307776666@s.whatsapp.net', 'Elsewhere')").run(chat, other);
    const add = (session, text, fromMe = 1, ageS = 1) => d.prepare("INSERT INTO ZWAMESSAGE (Z_PK, ZTEXT, ZMESSAGEDATE, ZISFROMME, ZCHATSESSION, ZMESSAGETYPE) VALUES ((SELECT MAX(Z_PK)+1 FROM ZWAMESSAGE), ?, ?, ?, ?, 0)").run(text, nowS - ageS, fromMe, session);
    const lid = other + 1;
    d.prepare("INSERT INTO ZWACHATSESSION (Z_PK, ZCONTACTJID, ZPARTNERNAME) VALUES (?, '4323000111222@lid', 'Same person under a lid')").run(lid);
    add(lid, "lid message");
    add(chat, "hello there");
    add(other, "wrong place");
    add(chat, "their message", 0);
    add(chat, "old news", 1, 3600);
    d.close();
    const c = createWhatsAppConnector({ config: { whatsappDb: file }, tmpDir: tmp() });
    const since = Date.now() - 10_000;
    assert.equal(await c.confirmSent({ handle: "+36309998888@wa", text: "hello there ", sinceMs: since }), "chat");
    assert.equal(await c.confirmSent({ handle: "+36309998888", text: "wrong place", sinceMs: since }), "other");
    assert.equal(await c.confirmSent({ handle: "+36309998888", text: "lid message", sinceMs: since }), "other", "a lid chat is another chat unless it is known to be this person's");
    assert.equal(await c.confirmSent({ handle: "+36309998888", chatIds: ["4323000111222"], text: "lid message", sinceMs: since }), "chat", "the person's own lid id counts");
    assert.equal(await c.confirmSent({ handle: "+36309998888", text: "their message", sinceMs: since }), "none", "only your own messages count");
    assert.equal(await c.confirmSent({ handle: "+36309998888", text: "old news", sinceMs: since }), "none", "not one from before the send");
    assert.equal(await c.confirmSent({ handle: "+36309998888", text: "x", sinceMs: since }), "none");
    const gone = createWhatsAppConnector({ config: { whatsappDb: path.join(tmp(), "nope.sqlite") }, tmpDir: tmp() });
    assert.equal(await gone.confirmSent({ handle: "+36309998888", text: "x", sinceMs: since }), "unavailable");
});
