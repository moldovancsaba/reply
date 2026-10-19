import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { buildFixtures } from "./fixtures/build.js";
import { encodeAttributedBody } from "./fixtures/imessage.js";

const tmp = () => path.join(mkdtempSync(path.join(os.tmpdir(), "rc-fx-")), "out");
const rows = (file, sql) => { const db = new Database(file, { readonly: true }); try { return db.prepare(sql).all(); } finally { db.close(); } };

// Logical hash of every row of every table, so determinism does not depend on SQLite file bytes.
function logicalHash(file) {
    const db = new Database(file, { readonly: true });
    const h = createHash("sha256");
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()) {
        h.update(name);
        for (const r of db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).iterate()) h.update(JSON.stringify(r, (_k, v) => (Buffer.isBuffer(v) ? v.toString("hex") : v)));
    }
    db.close();
    return h.digest("hex");
}

let fx;
let out;
test.before(async () => { out = tmp(); fx = await buildFixtures({ seed: 42, out }); });
test.after(() => rmSync(path.dirname(out), { recursive: true, force: true }));

test("attributedBody encoder matches bytes captured from the real NSArchiver on macOS 26", () => {
    const real = {
        "Hi": "040b73747265616d747970656481e803840140848484124e5341747472696275746564537472696e67008484084e534f626a656374008592848484084e53537472696e67019484012b02486986840269490102928484840c4e5344696374696f6e6172790094840169008686",
        "Hello there, this is a longer message!!": "040b73747265616d747970656481e803840140848484124e5341747472696275746564537472696e67008484084e534f626a656374008592848484084e53537472696e67019484012b2748656c6c6f2074686572652c20746869732069732061206c6f6e676572206d657373616765212186840269490127928484840c4e5344696374696f6e6172790094840169008686",
        "café 😀": "040b73747265616d747970656481e803840140848484124e5341747472696275746564537472696e67008484084e534f626a656374008592848484084e53537472696e67019484012b0a636166c3a920f09f988086840269490107928484840c4e5344696374696f6e6172790094840169008686",
    };
    for (const [text, hex] of Object.entries(real)) assert.equal(encodeAttributedBody(text).toString("hex"), hex, text);
    const long = "x".repeat(200);
    const enc = encodeAttributedBody(long).toString("hex");
    assert.ok(enc.includes("2b81c800" + "78".repeat(200) + "8684026949" + "0181c800"), "two-byte lengths");
});

test("iMessage fixture has every documented edge case", () => {
    const f = fx.imessage;
    const q = (sql) => rows(f, sql)[0].n;
    assert.equal(q("SELECT COUNT(*) n FROM message"), 200);
    assert.ok(q("SELECT COUNT(*) n FROM message WHERE text IS NULL AND attributedBody IS NOT NULL") > 0, "attributedBody-only");
    assert.ok(q("SELECT COUNT(*) n FROM message WHERE associated_message_type >= 2000") > 0, "reactions");
    assert.ok(q("SELECT COUNT(*) n FROM message WHERE text IS NULL AND cache_has_attachments = 1") > 0, "attachment-only");
    assert.equal(q("SELECT COUNT(*) n FROM chat WHERE style = 43"), 1);
    assert.equal(q("SELECT COUNT(*) n FROM chat_handle_join"), 3, "group has 3 members");
    assert.ok(q("SELECT COUNT(*) n FROM chat_message_join j JOIN chat c ON c.ROWID = j.chat_id WHERE c.style = 43") > 0, "group messages");
    assert.ok(q("SELECT COUNT(DISTINCT service) n FROM message") >= 2, "iMessage and SMS");
    assert.ok(q("SELECT COUNT(*) n FROM message WHERE date > 100000000000000") > 0, "nanosecond timestamps");
    assert.ok(q("SELECT COUNT(*) n FROM message WHERE date < 100000000000000") > 0, "second timestamps");
    assert.ok(q("SELECT COUNT(*) n FROM handle WHERE id LIKE '+%'") > 0 && q("SELECT COUNT(*) n FROM handle WHERE id GLOB '[0-9]*'") > 0, "handles with and without +");
    assert.equal(q("SELECT COUNT(*) n FROM message_attachment_join"), q("SELECT COUNT(*) n FROM message WHERE cache_has_attachments = 1"));
    assert.ok(q("SELECT COUNT(*) n FROM message WHERE is_from_me = 1") > 0 && q("SELECT COUNT(*) n FROM message WHERE is_from_me = 0") > 0);
});

test("Mail fixture has every documented edge case", () => {
    const f = fx.mailIndex;
    const q = (sql) => rows(f, sql)[0].n;
    assert.equal(q("SELECT COUNT(*) n FROM messages"), 200);
    assert.equal(q("SELECT COUNT(*) n FROM mailboxes WHERE url LIKE 'imap://ACC-%/INBOX'"), 3, "three accounts");
    assert.ok(q("SELECT COUNT(*) n FROM messages WHERE subject IS NULL") > 0, "no subject");
    assert.ok(q("SELECT COUNT(*) n FROM messages WHERE summary IS NULL") > 0, "html-only (no summary)");
    assert.ok(q("SELECT COUNT(*) n FROM messages WHERE deleted = 1") > 0, "deleted rows");
    assert.ok(q("SELECT MAX(c) n FROM (SELECT COUNT(*) c FROM recipients GROUP BY message)") >= 20, "20 recipients");
    for (const box of ["Drafts", "Junk", "Deleted%20Messages", "Sent%20Messages"]) {
        assert.ok(q(`SELECT COUNT(*) n FROM messages m JOIN mailboxes b ON b.ROWID = m.mailbox WHERE b.url LIKE '%/${box}'`) > 0, box);
    }
    assert.ok(q("SELECT COUNT(*) n FROM messages m JOIN addresses a ON a.ROWID = m.sender WHERE a.address IN ('me@example.com','work@example.org','icloud-me@example.net')") > 0, "sent mail from own addresses");
});

test("WhatsApp fixture has every documented edge case", () => {
    const f = fx.whatsapp;
    const q = (sql) => rows(f, sql)[0].n;
    assert.equal(q("SELECT COUNT(*) n FROM ZWAMESSAGE"), 201, "200 plus one status row");
    assert.ok(q("SELECT COUNT(*) n FROM ZWACHATSESSION WHERE ZCONTACTJID LIKE '%@g.us'") === 1, "group chat");
    assert.ok(q("SELECT COUNT(*) n FROM ZWAMESSAGE WHERE ZTEXT IS NULL AND ZMEDIAITEM IS NOT NULL") > 0, "media-only");
    assert.ok(q("SELECT COUNT(*) n FROM ZWAMESSAGE WHERE ZMESSAGETYPE = 10") > 0, "system rows");
    assert.equal(q("SELECT COUNT(*) n FROM ZWAMESSAGE WHERE ZTOJID = 'status@broadcast'"), 1);
    assert.ok(q("SELECT COUNT(*) n FROM ZWAMESSAGE WHERE ZMESSAGEDATE < 800000000 AND ZMESSAGEDATE > 600000000") > 0, "Core Data epoch seconds");
    assert.equal(rows(f, "SELECT Z_UUID u FROM Z_METADATA")[0].u, "FIXTURE-UUID-0001");
});

test("contacts fixture has every documented edge case", () => {
    const list = readFileSync(fx.contacts, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(list.length, 25 + 8);
    assert.ok(list.every((r) => r.type === "contact" && r.schemaVersion === 1 && r.contactId));
    const multi = list.find((r) => r.contactId === "CNID-EDGE-MULTI");
    assert.equal(multi.phones.length, 3);
    assert.equal(multi.emails.length, 2);
    assert.equal(list.filter((r) => r.displayName === "Same Name").length, 2, "duplicate names, different people");
    assert.equal(list.find((r) => r.contactId === "CNID-EDGE-NOHANDLE").phones.length, 0);
    assert.ok(list.some((r) => /\p{Script=Han}/u.test(r.displayName)), "non-Latin name");
    const shared = list.filter((r) => r.phones.includes("+12125559041"));
    assert.equal(shared.length, 2, "two people share one landline");
});

test("corpus is NormalizedMessage NDJSON", () => {
    const lines = readFileSync(fx.corpus, "utf8").trim().split("\n");
    assert.equal(lines.length, 2000);
    const m = JSON.parse(lines[0]);
    for (const k of ["channel", "account", "providerMessageKey", "threadKey", "handle_norm", "isFromMe", "tsMs", "text", "attachments"]) assert.ok(k in m, k);
});

test("same seed gives logically identical output; a different seed differs", async () => {
    const a = tmp();
    const b = tmp();
    const c = tmp();
    const [fa, fb, fc] = await Promise.all([buildFixtures({ seed: 7, out: a }), buildFixtures({ seed: 7, out: b }), buildFixtures({ seed: 8, out: c })]);
    for (const k of ["imessage", "whatsapp", "mailIndex"]) assert.equal(logicalHash(fa[k]), logicalHash(fb[k]), k);
    for (const k of ["contacts", "corpus"]) assert.equal(readFileSync(fa[k], "utf8"), readFileSync(fb[k], "utf8"), k);
    assert.notEqual(logicalHash(fa.imessage), logicalHash(fc.imessage));
    for (const d of [a, b, c]) rmSync(path.dirname(d), { recursive: true, force: true });
});

test("changing one source count does not change another source's data", async () => {
    const a = tmp();
    const b = tmp();
    const [fa, fb] = await Promise.all([buildFixtures({ seed: 5, out: a }), buildFixtures({ seed: 5, out: b, counts: { mail: 50 } })]);
    assert.equal(logicalHash(fa.imessage), logicalHash(fb.imessage));
    assert.notEqual(logicalHash(fa.mailIndex), logicalHash(fb.mailIndex));
    for (const d of [a, b]) rmSync(path.dirname(d), { recursive: true, force: true });
});

test("refuses a non-empty output directory unless forced and rejects invalid counts", async () => {
    const d = tmp();
    await buildFixtures({ seed: 1, out: d });
    await assert.rejects(() => buildFixtures({ seed: 1, out: d }), /not empty/);
    await buildFixtures({ seed: 1, out: d, force: true });
    await assert.rejects(() => buildFixtures({ seed: 1, out: d, force: true, counts: { corpus: -1 } }), /counts must be non-negative integers/);
    assert.ok(readdirSync(d).length > 0, "invalid counts are rejected before anything is deleted");
    rmSync(path.dirname(d), { recursive: true, force: true });
});

test("all identifiers are synthetic: reserved phone range and example domains only", () => {
    const text = [fx.contacts, fx.corpus].map((f) => readFileSync(f, "utf8")).join("\n");
    for (const p of text.match(/\+\d{7,}/g) ?? []) assert.match(p, /^\+1212555\d{4}$/, p);
    for (const e of text.match(/[\w.+-]+@[\w.-]+/g) ?? []) assert.match(e, /@(example\.(com|org|net)|mail\.example\.com)$|@wa$|@s\.whatsapp\.net$/, e);
    const handles = rows(fx.imessage, "SELECT id FROM handle").map((r) => r.id);
    for (const h of handles) assert.ok(/^\+?1212555\d{4}$/.test(h) || /@example\.(com|org|net)$/.test(h), h);
    const deny = (process.env.REPLY_CORE_FIXTURE_DENYLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const everything = [text, handles.join("\n"), rows(fx.mailIndex, "SELECT address a FROM addresses").map((r) => r.a).join("\n")].join("\n");
    for (const d of deny) assert.ok(!everything.includes(d), "fixture contains a denylisted real identifier");
});

test("generators are deterministic by construction: no Math.random or Date.now outside the CLI timing line", () => {
    const dir = path.join(path.resolve("."), "test", "fixtures");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".js") && x !== "build.js")) {
        const src = readFileSync(path.join(dir, f), "utf8");
        assert.ok(!/Math\.random|Date\.now|new Date\(\)/.test(src), `${f} is non-deterministic`);
    }
    const build = readFileSync(path.join(dir, "build.js"), "utf8");
    assert.equal((build.match(/Date\.now/g) ?? []).length, 2, "build.js uses Date.now only for the CLI timing display");
});

test("small set builds in under 2 seconds", async () => {
    const d = tmp();
    const t0 = performance.now();
    await buildFixtures({ seed: 3, out: d });
    assert.ok(performance.now() - t0 < 2000);
    assert.ok(statSync(path.join(d, "imessage", "chat.db")).size > 0);
    rmSync(path.dirname(d), { recursive: true, force: true });
});
