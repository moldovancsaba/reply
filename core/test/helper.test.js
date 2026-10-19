import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import Database from "better-sqlite3";
import { buildFixtures } from "./fixtures/build.js";
import { defaultHelperPath, HelperError, helperDoctor, helperVersion, runHelper, sha256File, verifyChecksum } from "../src/helper/index.js";

const helper = defaultHelperPath();
const skip = existsSync(helper) ? false : "helper not built: run helper/build.sh";
const schema = JSON.parse(readFileSync(new URL("../helper/schema/v1.json", import.meta.url), "utf8"));
const validate = new Ajv({ strict: true }).compile(schema);

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "rc-helper-"));
let fx;
let root;
test.before(async () => {
    root = tmp();
    fx = await buildFixtures({ seed: 42, out: path.join(root, "fx") });
});
test.after(() => rmSync(root, { recursive: true, force: true }));

function stub(body) {
    const file = path.join(tmp(), "stub-helper");
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
    writeFileSync(`${file}.sha256`, sha256File(file));
    return file;
}

// Independent JS reading of the same typedstream layout, to cross-check the Swift decoder on the fixture blobs.
function decodeBlob(buf) {
    const marker = Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]);
    let i = buf.indexOf(marker) + marker.length;
    let len = buf[i];
    if (len === 0x81) { len = buf.readUInt16LE(i + 1); i += 3; } else i += 1;
    return buf.subarray(i, i + len).toString("utf8").trim();
}

test("version is reported and the schema major is checked", { skip }, async () => {
    assert.deepEqual(await helperVersion(), { version: "1.0.0", schema: 1 });
    await assert.rejects(helperVersion({ helper: stub('echo "1.0.0 schema=2"'), }), (e) => e.code === "schema_unsupported");
    await assert.rejects(helperVersion({ helper: stub('echo "garbage"') }), (e) => e.code === "internal");
});

test("iMessage export validates against v1.json and covers every fixture edge case", { skip }, async () => {
    const { messages, records } = await runHelper(["imessage", "--db", fx.imessage, "--limit", "1000"]);
    for (const r of records) assert.ok(validate(r), JSON.stringify([r, validate.errors]));
    assert.equal(messages.length, 200);
    const db = new Database(fx.imessage, { readonly: true });
    const nullText = db.prepare("SELECT guid, attributedBody b FROM message WHERE text IS NULL AND attributedBody IS NOT NULL").all();
    assert.ok(nullText.length > 0);
    const byKey = new Map(messages.map((m) => [m.providerMessageKey, m]));
    for (const row of nullText) {
        const expected = decodeBlob(row.b);
        assert.ok(expected.length > 0);
        assert.equal(byKey.get(row.guid).text, expected, "attributedBody-only text decoded");
    }
    const reactions = db.prepare("SELECT guid FROM message WHERE associated_message_type >= 2000").all();
    assert.ok(reactions.length > 0);
    for (const r of reactions) assert.equal(byKey.get(r.guid).isReaction, true);
    const att = db.prepare("SELECT guid FROM message WHERE cache_has_attachments = 1").all();
    for (const r of att) {
        const m = byKey.get(r.guid);
        assert.equal(m.attachments.length, 1);
        assert.match(m.text, /^\[Attachment: IMG_\d+\.jpeg\]$/);
        assert.equal(m.attachments[0].mimeType, "image/jpeg");
    }
    const group = messages.filter((m) => m.isGroup);
    assert.ok(group.length > 0);
    assert.ok(group.every((m) => m.threadKey.startsWith("iMessage;+;")));
    assert.ok(group.filter((m) => m.isFromMe).every((m) => m.counterpartHandle === ""), "sent group rows have no single counterpart");
    assert.ok(messages.some((m) => m.service === "SMS") && messages.some((m) => m.service === "iMessage"));
    const nanos = db.prepare("SELECT guid, date FROM message WHERE date > 100000000000000 LIMIT 1").get();
    assert.equal(byKey.get(nanos.guid).tsMs, (Math.floor(nanos.date / 1e9) + 978307200) * 1000);
    const secs = db.prepare("SELECT guid, date FROM message WHERE date < 100000000000000 LIMIT 1").get();
    assert.equal(byKey.get(secs.guid).tsMs, (secs.date + 978307200) * 1000);
    assert.ok(messages.every((m) => m.tsMs > 0));
    db.close();
});

test("paging with the returned cursor yields no duplicates and no gaps", { skip }, async () => {
    const seen = [];
    let after = 0;
    let pages = 0;
    for (;;) {
        const { messages, cursor } = await runHelper(["imessage", "--db", fx.imessage, "--after", String(after), "--limit", "37"]);
        seen.push(...messages.map((m) => m.providerMessageKey));
        pages++;
        assert.ok(cursor.cursor.rowid >= after, "cursor never moves backwards");
        after = cursor.cursor.rowid;
        if (!cursor.more) break;
    }
    assert.equal(seen.length, 200);
    assert.equal(new Set(seen).size, 200);
    assert.ok(pages >= 6);
    const again = await runHelper(["imessage", "--db", fx.imessage, "--after", String(after)]);
    assert.equal(again.messages.length, 0);
});

test("export is read-only: the source file is unchanged and no journal files appear", { skip }, async () => {
    const dir = path.dirname(fx.imessage);
    const before = createHash("sha256").update(readFileSync(fx.imessage)).digest("hex");
    const filesBefore = readdirSync(dir).sort();
    await runHelper(["imessage", "--db", fx.imessage]);
    assert.equal(createHash("sha256").update(readFileSync(fx.imessage)).digest("hex"), before);
    assert.deepEqual(readdirSync(dir).sort(), filesBefore);
});

test("Mail export validates and maps direction, kinds, recipients and exclusions", { skip }, async () => {
    const { records, messages } = await runHelper(["mail", "--root", fx.mail, "--limit", "1000"]);
    for (const r of records) assert.ok(validate(r), JSON.stringify([r, validate.errors]));
    const db = new Database(fx.mailIndex, { readonly: true });
    assert.equal(messages.length, db.prepare("SELECT COUNT(*) n FROM messages WHERE deleted = 0").get().n, "deleted rows are not exported");
    const kinds = new Set(messages.map((m) => m.mailboxKind));
    for (const k of ["inbox", "sent", "drafts", "junk", "trash"]) assert.ok(kinds.has(k), k);
    assert.ok(messages.every((m) => (m.mailboxKind === "sent") === m.isFromMe || m.isFromMe), "sent mailbox implies from me");
    const many = messages.find((m) => m.to.length === 20);
    assert.ok(many && many.isFromMe && many.counterpartHandle === many.to[0]);
    const inbound = messages.find((m) => m.mailboxKind === "inbox");
    assert.equal(inbound.counterpartHandle, inbound.sender);
    assert.ok(messages.some((m) => m.subject === undefined), "messages without a subject");
    assert.ok(messages.some((m) => m.text === ""), "html-only messages have empty text");
    assert.deepEqual([...new Set(messages.map((m) => m.account))].sort(), ["ACC-0001", "ACC-0002", "ACC-0003"]);
    db.close();
});

test("doctor reports per-source state and exits with the matching code", { skip }, async () => {
    const ok = await helperDoctor(["--db", fx.imessage, "--root", fx.mail, "--skip-contacts"]);
    assert.deepEqual(ok, { report: { contacts: "ok", imessage: "ok", mail: "ok" }, exitCode: 0 });
    const missing = await helperDoctor(["--db", "/nonexistent/chat.db", "--root", fx.mail, "--skip-contacts"]);
    assert.equal(missing.report.imessage, "source_missing");
    assert.equal(missing.exitCode, 11);
});

test("an unreadable source is permission_denied (exit 10) and a missing one is source_missing (exit 11)", { skip }, async () => {
    const locked = path.join(tmp(), "chat.db");
    copyFileSync(fx.imessage, locked);
    chmodSync(locked, 0o000);
    await assert.rejects(runHelper(["imessage", "--db", locked]), (e) => e instanceof HelperError && e.code === "permission_denied" && e.exitCode === 10 && e.retryable === false);
    await assert.rejects(runHelper(["imessage", "--db", "/nonexistent/chat.db"]), (e) => e.code === "source_missing" && e.exitCode === 11);
    await assert.rejects(runHelper(["mail", "--root", "/nonexistent/Mail"]), (e) => e.code === "source_missing");
});

test("a database with an unsupported layout is schema_unsupported (exit 13)", { skip }, async () => {
    const odd = path.join(tmp(), "chat.db");
    const db = new Database(odd);
    db.exec("CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT)");
    db.close();
    await assert.rejects(runHelper(["imessage", "--db", odd]), (e) => e.code === "schema_unsupported" && e.exitCode === 13);
});

test("usage errors never touch a source", { skip }, async () => {
    await assert.rejects(runHelper(["imessage", "--limit", "0"]), (e) => e.code === "internal" && e.exitCode === 2);
    await assert.rejects(runHelper(["frobnicate"]), (e) => e.exitCode === 2);
});

test("a swapped or missing binary is refused before it runs", async () => {
    const good = stub('echo \'{"type":"cursor","schemaVersion":1,"source":"imessage","cursor":{"rowid":0},"exported":0,"more":false}\'');
    assert.equal((await runHelper([], { helper: good })).cursor.exported, 0);
    writeFileSync(good, "#!/bin/sh\necho evil\n");
    assert.throws(() => verifyChecksum(good), (e) => e.code === "helper_unavailable" && /checksum mismatch/.test(e.message));
    await assert.rejects(runHelper([], { helper: good }), (e) => e.code === "helper_unavailable");
    await assert.rejects(runHelper([], { helper: "/nonexistent/helper" }), (e) => e.code === "helper_unavailable");
});

test("unknown schemaVersion and non-JSON output are rejected", async () => {
    await assert.rejects(runHelper([], { helper: stub('echo \'{"type":"message","schemaVersion":2}\'') }), (e) => e.code === "schema_unsupported");
    await assert.rejects(runHelper([], { helper: stub("echo not-json") }), (e) => e.code === "internal");
});

test("a hung helper is killed at the timeout and an abort signal stops it", async () => {
    const t0 = performance.now();
    await assert.rejects(runHelper([], { helper: stub("sleep 30"), timeoutMs: 300 }), (e) => e.code === "timeout" && e.retryable === true);
    assert.ok(performance.now() - t0 < 3000);
    const ac = new AbortController();
    const p = runHelper([], { helper: stub("sleep 30"), signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    await assert.rejects(p, /aborted/);
});

test("stderr never reaches the error message beyond its last short line, and non-zero exits map to codes", async () => {
    await assert.rejects(runHelper([], { helper: stub('echo "line one" >&2; echo "reply-core-helper: permission_denied: nope" >&2; exit 10') }), (e) => e.code === "permission_denied" && /permission_denied: nope/.test(e.message) && !/line one/.test(e.message));
    await assert.rejects(runHelper([], { helper: stub("exit 12") }), (e) => e.code === "source_locked" && e.retryable === true);
    await assert.rejects(runHelper([], { helper: stub("exit 20") }), (e) => e.code === "internal");
});

test("the binary links no networking APIs", { skip }, async () => {
    const { execFileSync } = await import("node:child_process");
    const imports = execFileSync("nm", ["-u", helper], { encoding: "utf8" });
    assert.ok(!/_(socket|connect|getaddrinfo|CFNetwork|NSURLSession)\b/i.test(imports));
    assert.ok(statSync(helper).size > 0);
});
