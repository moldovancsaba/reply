import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createImessageConnector, toNormalized } from "../src/connectors/imessage.js";
import { createRunner } from "../src/connectors/runner.js";
import { defaultHelperPath, sha256File } from "../src/helper/index.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { buildFixtures } from "./fixtures/build.js";

const skip = existsSync(defaultHelperPath()) ? false : "helper not built: run helper/build.sh";
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "rc-im-"));
let fx;
let root;
test.before(async () => { root = tmp(); fx = await buildFixtures({ seed: 42, out: path.join(root, "fx") }); });
test.after(() => rmSync(root, { recursive: true, force: true }));

function pipeline(dbPath, { pageLimit = 500, helper } = {}) {
    const home = tmp();
    const { db } = openDb(home);
    const repo = createRepo(db);
    const runner = createRunner({ db, repo, pageLimit, sleep: async () => {}, now: () => Date.now() });
    const connector = createImessageConnector({ config: { imessageDb: dbPath, defaultRegion: "HU" }, ...(helper ? { helper } : {}) });
    return { db, repo, runner, connector };
}

const rec = (over = {}) => ({ type: "message", schemaVersion: 1, source: "imessage", providerMessageKey: "g1", account: "", threadKey: "iMessage;-;+12125550100", counterpartHandle: "+12125550100", isFromMe: false, tsMs: 1760000000000, text: "hi", attachments: [], isGroup: false, isReaction: false, service: "iMessage", ...over });

test("toNormalized: direct, group, reaction, bad handle", () => {
    const d = toNormalized(rec(), "HU").message;
    assert.deepEqual([d.channel, d.handle_norm, d.providerMessageKey, d.meta], ["imessage", "+12125550100", "g1", { service: "iMessage" }]);
    const g = toNormalized(rec({ isGroup: true, threadKey: "iMessage;+;chat1", counterpartHandle: "+12125550101" }), "HU").message;
    assert.equal(g.handle_norm, "group:iMessage;+;chat1");
    assert.deepEqual(g.meta, { service: "iMessage", isGroup: true, sender: "+12125550101" });
    const mine = toNormalized(rec({ isGroup: true, threadKey: "iMessage;+;chat1", counterpartHandle: "", isFromMe: true }), "HU").message;
    assert.equal(mine.meta.sender, undefined);
    assert.deepEqual(toNormalized(rec({ isReaction: true }), "HU"), { skip: "reaction" });
    assert.deepEqual(toNormalized(rec({ counterpartHandle: "" }), "HU"), { skip: "bad_handle" });
    assert.equal(toNormalized(rec({ counterpartHandle: "Anna@Example.COM" }), "HU").message.handle_norm, "anna@example.com", "email-based iMessage ids");
    assert.equal(toNormalized(rec({ counterpartHandle: "12125550100" }), "HU").message.handle_norm, "+12125550100", "handles stored without +");
});

test("fixture import: every message lands with the right shape, reactions are skipped, group threads are grouped", { skip }, async () => {
    const { db, runner, connector } = pipeline(fx.imessage);
    const res = await runner.start(connector, "").done;
    assert.equal(res.outcome, "ok");
    const src = new Database(fx.imessage, { readonly: true });
    const reactions = src.prepare("SELECT COUNT(*) n FROM message WHERE associated_message_type >= 2000").get().n;
    assert.ok(reactions > 0);
    assert.equal(res.inserted, 200 - reactions, "all but the reactions");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE channel = 'imessage'").get().n, 200 - reactions);

    // attributedBody-only messages carry decoded text
    const nullText = src.prepare("SELECT guid FROM message WHERE text IS NULL AND attributedBody IS NOT NULL AND associated_message_type < 2000").all();
    assert.ok(nullText.length > 0);
    for (const { guid } of nullText) assert.ok(db.prepare("SELECT text FROM messages WHERE provider_message_key = ?").get(guid).text.length > 0, guid);
    // attachment-only: placeholder text and metadata
    const att = src.prepare("SELECT guid FROM message WHERE cache_has_attachments = 1 AND text IS NULL").all();
    for (const { guid } of att) {
        const m = db.prepare("SELECT text, attachments_json FROM messages WHERE provider_message_key = ?").get(guid);
        if (!m) continue; // a reaction row can also carry the flag
        assert.match(m.text, /^\[Attachment: IMG_\d+\.jpeg\]$/);
        assert.equal(JSON.parse(m.attachments_json)[0].mimeType, "image/jpeg");
    }
    // group messages share one thread handle and record the sender
    const groupRows = db.prepare("SELECT handle_norm, meta_json, is_from_me FROM messages WHERE handle_norm LIKE 'group:%'").all();
    assert.ok(groupRows.length > 0);
    assert.equal(new Set(groupRows.map((r) => r.handle_norm)).size, 1);
    for (const r of groupRows) {
        const meta = JSON.parse(r.meta_json);
        assert.equal(meta.isGroup, true);
        if (!r.is_from_me) assert.match(meta.sender, /^\+1212555\d{4}$|@example\./);
    }
    // direction and both timestamp scales
    assert.ok(db.prepare("SELECT COUNT(*) n FROM messages WHERE is_from_me = 1").get().n > 0);
    assert.ok(db.prepare("SELECT MIN(ts_ms) a, MAX(ts_ms) b FROM messages").get().a > Date.UTC(2024, 0, 1), "second and nanosecond dates both convert");
    // phones normalized to E.164, email handles lowercased, one auto contact per handle
    const handles = db.prepare("SELECT DISTINCT handle_norm FROM messages WHERE handle_norm NOT LIKE 'group:%'").all().map((r) => r.handle_norm);
    for (const h of handles) assert.ok(/^\+\d{8,15}$/.test(h) || /^[a-z0-9.@-]+$/.test(h), h);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM handles").get().n, handles.length + 1);
    src.close();
});

test("a second run inserts nothing and the cursor sits at the last row", { skip }, async () => {
    const { repo, runner, connector } = pipeline(fx.imessage);
    await runner.start(connector, "").done;
    const first = repo.getSyncState("imessage", "");
    const again = await runner.start(connector, "").done;
    assert.deepEqual([again.inserted, again.updated, again.outcome], [0, 0, "ok"]);
    assert.equal(repo.getSyncState("imessage", "").cursor_json, first.cursor_json);
    assert.equal(JSON.parse(first.cursor_json).rowid, 200);
});

test("paging in small pages gives the same result", { skip }, async () => {
    const big = pipeline(fx.imessage);
    const small = pipeline(fx.imessage, { pageLimit: 23 });
    await big.runner.start(big.connector, "").done;
    const r = await small.runner.start(small.connector, "").done;
    assert.ok(r.pages >= 9);
    const dump = (db) => JSON.stringify(db.prepare("SELECT id, handle_norm, text, ts_ms, is_from_me FROM messages ORDER BY id").all());
    assert.equal(dump(small.db), dump(big.db));
});

test("preflight reports each blocked cause with its code and hint", { skip }, async () => {
    const missing = createImessageConnector({ config: { imessageDb: "/nonexistent/chat.db" } });
    assert.deepEqual(await missing.preflight(), { ok: false, code: "source_missing", hint: "Messages has no database yet. Open Messages and sign in." });
    const locked = path.join(tmp(), "chat.db");
    copyFileSync(fx.imessage, locked);
    chmodSync(locked, 0o000);
    const denied = await createImessageConnector({ config: { imessageDb: locked } }).preflight();
    assert.deepEqual([denied.ok, denied.code], [false, "permission_denied"]);
    assert.match(denied.hint, /Full Disk Access/);
    const odd = path.join(tmp(), "chat.db");
    const d = new Database(odd);
    d.exec("CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT)");
    d.close();
    assert.equal((await createImessageConnector({ config: { imessageDb: odd } }).preflight()).code, "schema_unsupported");
    assert.equal((await createImessageConnector({ config: { imessageDb: fx.imessage } }).preflight()).ok, true);
    const nohelper = await createImessageConnector({ config: { imessageDb: fx.imessage }, helper: "/nonexistent/helper" }).preflight();
    assert.deepEqual([nohelper.ok, nohelper.code], [false, "helper_unavailable"]);
});

test("blocked sources write nothing and set the blocked state", { skip }, async () => {
    const locked = path.join(tmp(), "chat.db");
    copyFileSync(fx.imessage, locked);
    chmodSync(locked, 0o000);
    const p = pipeline(locked);
    const res = await p.runner.start(p.connector, "").done;
    assert.deepEqual([res.outcome, res.errorCode], ["blocked", "permission_denied"]);
    assert.equal(p.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 0);
    assert.equal(p.repo.getSyncState("imessage", "").state, "blocked");
});

test("a failure mid-import keeps what was committed and resumes from the cursor", { skip }, async () => {
    // helper stub: serves the real helper's first page, then a retryable failure, then the rest
    const real = defaultHelperPath();
    const stub = path.join(tmp(), "helper");
    const counter = path.join(path.dirname(stub), "count");
    writeFileSync(counter, "0");
    writeFileSync(stub, `#!/bin/sh\nn=$(cat "${counter}")\necho $((n+1)) > "${counter}"\nif [ "$n" = "1" ] && [ "$1" = "imessage" ]; then echo "reply-core-helper: source_locked: busy" >&2; exit 12; fi\nexec "${real}" "$@"\n`);
    chmodSync(stub, 0o755);
    writeFileSync(`${stub}.sha256`, sha256File(stub));
    const p = pipeline(fx.imessage, { pageLimit: 50, helper: stub });
    const res = await p.runner.start(p.connector, "").done;
    assert.equal(res.outcome, "ok");
    assert.equal(res.attempts, 1, "one retry after the locked page");
    const src = new Database(fx.imessage, { readonly: true });
    const reactions = src.prepare("SELECT COUNT(*) n FROM message WHERE associated_message_type >= 2000").get().n;
    assert.equal(p.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 200 - reactions);
    src.close();
});

test("a record with no usable date is quarantined, not stored", { skip }, async () => {
    const stub = path.join(tmp(), "helper");
    const lines = [rec({ providerMessageKey: "ok1" }), rec({ providerMessageKey: "nodate", tsMs: 0 })].map((r) => JSON.stringify(r)).join("\n");
    writeFileSync(stub, `#!/bin/sh\nif [ "$1" = "doctor" ]; then echo '{"contacts":"ok","imessage":"ok","mail":"ok"}'; exit 0; fi\ncat <<'EOF'\n${lines}\n{"type":"cursor","schemaVersion":1,"source":"imessage","cursor":{"rowid":2},"exported":2,"more":false}\nEOF\n`);
    chmodSync(stub, 0o755);
    writeFileSync(`${stub}.sha256`, sha256File(stub));
    const p = pipeline("/unused", { helper: stub });
    const res = await p.runner.start(p.connector, "").done;
    assert.deepEqual([res.inserted, res.quarantined], [1, 1]);
});
