import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import { createIdentity } from "../src/identity/service.js";
import { createReadService, limitSnippet } from "../src/read/service.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { makeRng } from "./fixtures/rng.js";
import { request, startServer } from "./helpers.js";

const schemaDoc = JSON.parse(readFileSync(new URL("../schema/api-read.json", import.meta.url), "utf8"));
const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);
const ajv = new Ajv({ strict: false });
ajv.addFormat("date-time", true);
ajv.addSchema(schemaDoc);
const check = (name) => { const v = ajv.getSchema(`${schemaDoc.$id}#/definitions/${name}`); return (doc) => { assert.ok(v(doc), JSON.stringify([v.errors, doc]).slice(0, 600)); }; };
const isList = check("ContactList");
const isContact = check("Contact");
const isThread = check("Thread");
const isSearch = check("SearchResult");
const isError = check("Error");

const msg = (n, handle, extra = {}) => ({ channel: "imessage", account: "", providerMessageKey: `m${n}`, threadKey: "t", handle_norm: handle, isFromMe: n % 2 === 0, tsMs: NOW - n * 1000, text: `message ${n}`, attachments: [], ...extra });

function setup() {
    const home = mkdtempSync(path.join(os.tmpdir(), "rc-read-"));
    const { db } = openDb(home);
    const repo = createRepo(db, { now: () => NOW });
    const identity = createIdentity({ db, repo });
    return { db, repo, identity, read: createReadService({ db }) };
}
const owner = (db, h) => db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = ?").get(h).c;

async function api(t, deps) {
    const { app, port } = await startServer({ deps });
    t.after(() => app.close());
    return (p, headers = {}) => request(port, { path: p, headers: { host: `127.0.0.1:${port}`, ...headers } });
}

function seed(repo) {
    repo.upsertMessages([
        ...Array.from({ length: 12 }, (_, i) => msg(i + 1, "+36301234567", { text: i === 3 ? "Invoice for the café" : `chat ${i}` })),
        msg(50, "+36301234567@wa", { channel: "whatsapp", providerMessageKey: "w1", text: "whatsapp hello", tsMs: NOW - 500 }),
        msg(60, "bela@example.com", { channel: "email", providerMessageKey: "e1", subject: "Invoice 42", text: "Invoice 42\n\nsee attached", tsMs: NOW - 100, attachments: [{ name: "a.pdf", mimeType: "application/pdf", bytes: 10 }], meta: { isSummary: true, recipients: ["me@example.com"], accountLabel: "A" } }),
        msg(61, "group:chat1", { providerMessageKey: "g1", text: "group talk", tsMs: NOW - 90, meta: { isGroup: true, sender: "+36309999999" } }),
    ]);
}

test("responses validate against the published schemas", async (t) => {
    const { repo, read } = setup();
    seed(repo);
    const get = await api(t, { read });
    const list = (await get("/api/contacts")).json;
    isList(list);
    isContact((await get(`/api/contacts/${list.items[0].id}`)).json);
    isThread((await get(`/api/contacts/${list.items[0].id}/messages`)).json);
    isSearch((await get("/api/search?q=invoice")).json);
    isError((await get("/api/contacts/nope")).json);
    isError((await get("/api/search?q=a")).json);
});

test("contact list: newest activity first, per-channel counts, handles with labels, total", async (t) => {
    const { repo, read } = setup();
    seed(repo);
    const get = await api(t, { read });
    const r = (await get("/api/contacts")).json;
    assert.deepEqual(r.items.map((i) => i.displayName), ["group:chat1", "bela@example.com", "+36301234567@wa", "+36301234567"]);
    assert.equal(r.total, 4);
    assert.equal(r.hasMore, false);
    assert.equal(r.nextCursor, null);
    const bela = r.items[1];
    assert.deepEqual([bela.lastChannel, bela.countTotal, bela.counts, bela.lastFromMe], ["email", 1, { imessage: 0, email: 1, whatsapp: 0 }, true]);
    assert.deepEqual(bela.handles, [{ value: "bela@example.com", label: "bela@example.com", kind: "email" }]);
    assert.equal(r.items[2].handles[0].label, "+36 30 123 4567 (WhatsApp)");
    assert.ok(r.items.every((i) => i.lastPreview.length <= 140));
});

test("contact list: filters, search by name and handle, wildcard escaping, empty contacts, merged contacts hidden", async (t) => {
    const { repo, read, identity, db } = setup();
    seed(repo);
    identity.importContacts([{ externalId: "C1", displayName: "Anna K", handles: [{ handle_norm: "+36301234567", kind: "phone" }, { handle_norm: "+36301234567@wa", kind: "whatsapp" }] }, { externalId: "C2", displayName: "Never Wrote", handles: [{ handle_norm: "+36300000009", kind: "phone" }] }]);
    const get = await api(t, { read });
    const names = async (qs) => (await get(`/api/contacts?${qs}`)).json.items.map((i) => i.displayName);
    assert.deepEqual(await names("channel=whatsapp"), ["Anna K"]);
    assert.deepEqual(await names("channel=email"), ["bela@example.com"]);
    assert.deepEqual(await names("q=anna"), ["Anna K"]);
    assert.deepEqual(await names("q=3630123"), ["Anna K"], "search matches handle values");
    assert.deepEqual(await names("q=100%25"), [], "LIKE wildcards are literal");
    assert.ok(!(await names("")).includes("Never Wrote"), "contacts without messages are hidden by default");
    const all = (await get("/api/contacts?includeEmpty=true")).json;
    assert.ok(all.items.some((i) => i.displayName === "Never Wrote" && i.lastTs === null && i.countTotal === 0 && i.lastChannel === null));
    assert.equal(all.items.at(-1).displayName, "Never Wrote", "empty contacts sort last");
    isList(all);
    // merged-away contacts disappear from the list
    const b = owner(db, "bela@example.com");
    const a = owner(db, "+36301234567");
    identity.merge(b, a);
    assert.ok(!(await names("")).includes("bela@example.com"));
});

test("contact list: cursor pagination is complete and duplicate-free; bad cursors and parameters are rejected", async (t) => {
    const { repo, read } = setup();
    repo.upsertMessages(Array.from({ length: 95 }, (_, i) => msg(i, `+1212555${String(1000 + i)}`, { providerMessageKey: `p${i}`, tsMs: NOW - Math.floor(i / 4) * 1000 })));
    const get = await api(t, { read });
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
        const r = (await get(`/api/contacts?limit=20${cursor ? `&cursor=${cursor}` : ""}`)).json;
        isList(r);
        seen.push(...r.items.map((i) => i.id));
        cursor = r.nextCursor;
        pages++;
        assert.equal(r.total, 95);
    } while (cursor);
    assert.deepEqual([seen.length, new Set(seen).size, pages], [95, 95, 5]);
    for (const [url, code] of [["/api/contacts?limit=101", "invalid_request"], ["/api/contacts?limit=0", "invalid_request"], ["/api/contacts?limit=x", "invalid_request"], ["/api/contacts?channel=fax", "invalid_request"], ["/api/contacts?cursor=garbage", "invalid_cursor"], ["/api/contacts?bogus=1", "invalid_request"], [`/api/contacts?cursor=${Buffer.from('{"ts":"x","id":1}').toString("base64url")}`, "invalid_cursor"]]) {
        const r = await get(url);
        assert.deepEqual([r.status, r.json.error.code], [400, code], url);
    }
});

test("contact detail: handles, counts, merged and unknown contacts", async (t) => {
    const { repo, read, identity, db } = setup();
    seed(repo);
    const get = await api(t, { read });
    const a = owner(db, "+36301234567");
    const c = (await get(`/api/contacts/${a}`)).json;
    isContact(c);
    assert.deepEqual([c.countTotal, c.counts.imessage, c.handles[0].kind], [12, 12, "phone"]);
    const wa = owner(db, "+36301234567@wa");
    identity.merge(wa, a);
    const merged = await get(`/api/contacts/${wa}`);
    assert.deepEqual([merged.status, merged.json.error.code, merged.json.error.details], [404, "contact_not_found", { mergedInto: a }]);
    const merged2 = await get(`/api/contacts/${wa}/messages`);
    assert.deepEqual(merged2.json.error.details, { mergedInto: a });
    const unknown = await get("/api/contacts/nope");
    assert.deepEqual([unknown.status, unknown.json.error.details], [404, undefined]);
    assert.equal((await get(`/api/contacts/${a}?x=1`)).status, 400);
});

test("thread: merged contact interleaves channels newest first, with summary, attachment and sender details", async (t) => {
    const { repo, read, identity, db } = setup();
    seed(repo);
    const get = await api(t, { read });
    const a = owner(db, "+36301234567");
    identity.merge(owner(db, "+36301234567@wa"), a);
    identity.merge(owner(db, "bela@example.com"), a);
    const r = (await get(`/api/contacts/${a}/messages?limit=100`)).json;
    isThread(r);
    assert.equal(r.items.length, 14);
    const ts = r.items.map((m) => m.ts);
    assert.deepEqual(ts, [...ts].sort().reverse(), "newest first");
    assert.deepEqual([...new Set(r.items.map((m) => m.channel))].sort(), ["email", "imessage", "whatsapp"]);
    const mail = r.items.find((m) => m.channel === "email");
    assert.deepEqual([mail.isSummary, mail.subject, mail.attachments[0].name], [true, "Invoice 42", "a.pdf"]);
    assert.equal(r.items.find((m) => m.channel === "whatsapp").isSummary, undefined);
    const only = (await get(`/api/contacts/${a}/messages?channel=email&limit=100`)).json;
    assert.deepEqual(only.items.map((m) => m.channel), ["email"]);
    const group = (await get(`/api/contacts/${owner(db, "group:chat1")}/messages`)).json.items[0];
    assert.equal(group.sender, "+36309999999");
    // unmerge gives the threads back separately
    const log = db.prepare("SELECT id FROM merge_log WHERE action='merge' ORDER BY ts_ms DESC, rowid DESC").all();
    for (const l of log) identity.unmerge(l.id);
    assert.equal((await get(`/api/contacts/${a}/messages?limit=100`)).json.items.length, 12);
});

test("thread: pagination never duplicates or skips, even while new messages arrive", async (t) => {
    const { repo, read, db } = setup();
    repo.upsertMessages(Array.from({ length: 60 }, (_, i) => msg(i + 100, "+36301234567", { providerMessageKey: `a${i}`, tsMs: NOW - Math.floor(i / 3) * 1000 })));
    const a = owner(db, "+36301234567");
    const get = await api(t, { read });
    const original = new Set(db.prepare("SELECT id FROM messages").all().map((r) => r.id));
    const seen = [];
    let cursor = null;
    let n = 0;
    do {
        const r = (await get(`/api/contacts/${a}/messages?limit=7${cursor ? `&before=${cursor}` : ""}`)).json;
        isThread(r);
        seen.push(...r.items.map((m) => m.id));
        cursor = r.nextCursor;
        repo.upsertMessages([msg(1000 + n, "+36301234567", { providerMessageKey: `new${n}`, tsMs: NOW + (n + 1) * 1000 })]); // newer message lands between pages
        n++;
    } while (cursor);
    assert.equal(new Set(seen).size, seen.length, "no duplicates");
    for (const id of original) assert.ok(seen.includes(id), `skipped ${id}`);
    assert.ok(seen.every((id) => original.has(id)), "new newer messages do not leak into older pages");
    assert.deepEqual((await get(`/api/contacts/${a}/messages?before=bad`)).json.error.code, "invalid_cursor");
    assert.equal((await get(`/api/contacts/${a}/messages?limit=101`)).status, 400);
});

test("search: ranking, snippets, filters, pagination, short and hostile queries", async (t) => {
    const { repo, read, db } = setup();
    seed(repo);
    repo.upsertMessages([msg(70, "+36301234567", { providerMessageKey: "s1", text: "unrelated", subject: "Project plan", tsMs: NOW - 20 }), msg(71, "+36301234567", { providerMessageKey: "s2", text: "project project plan details", tsMs: NOW - 10 })]);
    const get = await api(t, { read });
    const inv = (await get("/api/search?q=invoice")).json;
    isSearch(inv);
    assert.equal(inv.items.length, 2);
    assert.equal(inv.items[0].contactName, "bela@example.com", "a subject match outranks a body-only match");
    assert.ok(inv.items[0].snippet.includes("\u0001") && inv.items[0].snippet.includes("\u0002"));
    assert.ok(inv.items.every((h) => h.snippet.length <= 170));
    assert.equal((await get("/api/search?q=cafe")).json.items.length, 1, "diacritics-insensitive");
    assert.equal((await get("/api/search?q=invoice&channel=email")).json.items.length, 1);
    const a = owner(db, "+36301234567");
    assert.equal((await get(`/api/search?q=invoice&contactId=${a}`)).json.items.length, 1);
    assert.equal((await get("/api/search?q=invoice&contactId=nope")).json.items.length, 0);
    assert.deepEqual((await get("/api/search?q=a")).json.error.code, "query_too_short");
    assert.deepEqual((await get("/api/search")).json.error.code, "invalid_request");
    assert.equal((await get(`/api/search?q=${"x".repeat(201)}`)).status, 400);
    for (const evil of ['" OR 1=1 --', "AND OR NOT", "**", "a\"b", "NEAR(", "text:foo", "%25%25"]) {
        const r = await get(`/api/search?q=${encodeURIComponent(evil)}`);
        assert.ok([200, 400].includes(r.status), evil);
        if (r.status === 200) isSearch(r.json);
    }
    // pagination: one page at a time, no duplicates, complete
    repo.upsertMessages(Array.from({ length: 45 }, (_, i) => msg(200 + i, "+36301234567", { providerMessageKey: `q${i}`, text: `pagination needle ${i}`, tsMs: NOW - 5000 - i * 1000 })));
    const ids = [];
    let cursor = null;
    do {
        const r = (await get(`/api/search?q=needle&limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).json;
        isSearch(r);
        ids.push(...r.items.map((h) => h.messageId));
        cursor = r.nextCursor;
    } while (cursor);
    assert.deepEqual([ids.length, new Set(ids).size], [45, 45]);
    assert.equal((await get("/api/search?q=needle&cursor=garbage")).json.error.code, "invalid_cursor");
});

test("limitSnippet keeps highlights balanced", () => {
    assert.equal(limitSnippet("short"), "short");
    const long = `${"a".repeat(150)}\u0001highlighted words that run past the limit\u0002 tail`;
    const cut = limitSnippet(long);
    assert.ok(cut.length <= 162);
    assert.equal(cut.split("\u0001").length, cut.split("\u0002").length);
});

test("caching: first pages revalidate with ETag, everything else is no-store", async (t) => {
    const { repo, read, db } = setup();
    seed(repo);
    const get = await api(t, { read });
    const first = await get("/api/contacts");
    assert.match(first.headers.etag, /^W\/"[0-9a-f]{20}"$/);
    assert.equal(first.headers["cache-control"], "private, max-age=0, must-revalidate");
    const again = await get("/api/contacts", { "if-none-match": first.headers.etag });
    assert.deepEqual([again.status, again.text], [304, ""]);
    const changed = await get("/api/contacts", { "if-none-match": 'W/"stale"' });
    assert.equal(changed.status, 200);
    repo.upsertMessages([msg(900, "+36301234567", { providerMessageKey: "late" })]);
    assert.equal((await get("/api/contacts", { "if-none-match": first.headers.etag })).status, 200, "a changed list no longer matches the old tag");
    const a = owner(db, "+36301234567");
    const thread = await get(`/api/contacts/${a}/messages`);
    assert.ok(thread.headers.etag);
    assert.equal((await get(`/api/contacts/${a}/messages`, { "if-none-match": thread.headers.etag })).status, 304);
    const paged = await get(`/api/contacts/${a}/messages?limit=2`);
    const next = await get(`/api/contacts/${a}/messages?limit=2&before=${paged.json.nextCursor}`);
    assert.equal(next.headers.etag, undefined);
    assert.equal(next.headers["cache-control"], "no-store");
    for (const url of [`/api/contacts/${a}`, "/api/search?q=invoice", "/api/contacts/nope", "/api/health"]) assert.equal((await get(url)).headers["cache-control"], "no-store", url);
});

test("performance budgets and query plans on a 100k-message corpus (3x tolerance)", { timeout: 120000 }, async (t) => {
    const { repo, read, db } = setup();
    const rng = makeRng(5);
    const words = ["alpha", "invoice", "meeting", "dinner", "photo", "ticket", "report", "lunch", "birthday", "project"];
    const people = Array.from({ length: 2000 }, (_, i) => `+1212555${String(1000 + i)}`);
    for (let b = 0; b < 20; b++) {
        const batch = [];
        for (let i = 0; i < 5000; i++) {
            const n = b * 5000 + i;
            batch.push(msg(n, people[rng.int(people.length)], { providerMessageKey: `p${n}`, tsMs: NOW - n * 1000, channel: n % 3 ? "imessage" : "email", text: `${words[n % 10]} ${words[(n * 7) % 10]} note ${n}` }));
        }
        repo.upsertMessages(batch);
    }
    const get = await api(t, { read });
    const timed = async (url) => { const s = performance.now(); const r = await get(url); assert.equal(r.status, 200, url); return [performance.now() - s, r]; };
    const busiest = db.prepare("SELECT contact_id c FROM contact_summary ORDER BY count_total DESC LIMIT 1").get().c;
    await timed("/api/contacts?limit=50");
    const [list, listRes] = await timed("/api/contacts?limit=50");
    const [thread] = await timed(`/api/contacts/${busiest}/messages?limit=50`);
    const [search] = await timed("/api/search?q=invoice%20meeting");
    console.log(`read perf (100k messages, includes HTTP): list ${list.toFixed(1)} ms, thread ${thread.toFixed(1)} ms, search ${search.toFixed(1)} ms; list payload ${listRes.text.length} bytes`);
    assert.ok(list < 90, `list ${list}`);
    assert.ok(thread < 60, `thread ${thread}`);
    assert.ok(search < 240, `search ${search}`);
    assert.ok(listRes.text.length < 100 * 1024, "payload under 100 KB");
    const plan = (sql, ...p) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p).map((r) => r.detail).join(" | ");
    assert.match(plan("SELECT c.id FROM contacts c JOIN contact_summary s ON s.contact_id = c.id WHERE c.hidden = 0 ORDER BY s.last_ts_ms DESC, s.contact_id DESC LIMIT 51"), /contact_summary_last/);
    assert.match(plan("SELECT * FROM messages WHERE handle_norm IN (?) ORDER BY ts_ms DESC, id DESC LIMIT 51", "x"), /messages_handle_ts/);
});

test("merge then read: the merged thread has everything, unmerge separates it again", async (t) => {
    const { repo, read, identity, db } = setup();
    seed(repo);
    const get = await api(t, { read });
    const a = owner(db, "+36301234567");
    const b = owner(db, "bela@example.com");
    const before = (await get(`/api/contacts/${a}/messages?limit=100`)).json.items.length;
    const m = identity.merge(b, a);
    assert.equal((await get(`/api/contacts/${a}/messages?limit=100`)).json.items.length, before + 1);
    assert.equal((await get(`/api/contacts/${b}/messages`)).status, 404);
    identity.unmerge(m.mergeLogId);
    assert.equal((await get(`/api/contacts/${a}/messages?limit=100`)).json.items.length, before);
    assert.equal((await get(`/api/contacts/${b}/messages`)).json.items.length, 1);
});
