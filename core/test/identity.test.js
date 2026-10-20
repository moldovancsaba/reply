import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../src/config.js";
import { formatHandle, normalizeHandle } from "../src/identity/normalize.js";
import { createIdentity } from "../src/identity/service.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { makeRng } from "./fixtures/rng.js";
import { request, startServer } from "./helpers.js";

const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);
const msg = (n, handle, extra = {}) => ({ channel: "imessage", account: "", providerMessageKey: `m${n}`, threadKey: "t", handle_norm: handle, isFromMe: false, tsMs: NOW - n * 1000, text: `t${n}`, attachments: [], ...extra });

function setup() {
    const home = mkdtempSync(path.join(os.tmpdir(), "rc-id-"));
    const { db } = openDb(home);
    const repo = createRepo(db, { now: () => NOW });
    let t = NOW;
    const identity = createIdentity({ db, repo, now: () => ++t });
    return { home, db, repo, identity };
}
const contactOf = (db, handle) => db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = ?").get(handle)?.c;
const snapshot = (db) => JSON.stringify({
    links: db.prepare("SELECT handle_norm, contact_id, link_origin FROM contact_handles ORDER BY handle_norm").all(),
    contacts: db.prepare("SELECT id, display_name, origin, hidden, merged_into FROM contacts ORDER BY id").all(),
    summary: db.prepare("SELECT * FROM contact_summary ORDER BY contact_id").all(),
});

// value, hint, region, expected handle_norm (null = rejected)
const TABLE = [
    // phones, default region HU
    ["+36 30 123 4567", undefined, "HU", "+36301234567"], ["+36-30-123-4567", undefined, "HU", "+36301234567"], ["+36 (30) 123 4567", undefined, "HU", "+36301234567"],
    ["06 30 123 4567", undefined, "HU", "+36301234567"], ["06301234567", undefined, "HU", "+36301234567"], ["30 123 4567", undefined, "HU", "+36301234567"],
    ["0036301234567", undefined, "HU", "+36301234567"], ["tel:+36301234567", undefined, "HU", "+36301234567"], ["TEL:+36301234567", undefined, "HU", "+36301234567"],
    ["+36301234567", "phone", "HU", "+36301234567"], ["  +36 30 123 4567  ", undefined, "HU", "+36301234567"], ["+36 30 123 4567 ext. 12", undefined, "HU", "+36301234567"],
    ["+36 30 123 4567 x12", undefined, "HU", "+36301234567"], ["36301234567", undefined, "HU", "+36301234567"],
    // other regions
    ["(212) 555-0100", undefined, "US", "+12125550100"], ["212-555-0100", undefined, "US", "+12125550100"], ["1-212-555-0100", undefined, "US", "+12125550100"],
    ["+1 212 555 0100", undefined, "HU", "+12125550100"], ["+12125550100", undefined, "HU", "+12125550100"], ["12125550100", undefined, "HU", "+12125550100"],
    ["+44 20 7946 0958", undefined, "HU", "+442079460958"], ["020 7946 0958", undefined, "GB", "+442079460958"], ["+49 30 901820", undefined, "HU", "+4930901820"],
    ["+33 1 23 45 67 89", undefined, "HU", "+33123456789"], ["+43 1 58058", undefined, "HU", "+43158058"],
    // invalid phones
    ["abc", "phone", "HU", null], ["12", "phone", "HU", null], ["", undefined, "HU", null], ["   ", undefined, "HU", null], [null, undefined, "HU", null], [undefined, undefined, "HU", null],
    ["+", "phone", "HU", null], ["0", "phone", "HU", null], ["+36", "phone", "HU", null],
    // emails
    ["Anna@Example.COM", undefined, "HU", "anna@example.com"], ["anna@example.com", "email", "HU", "anna@example.com"], [" mailto:Bob@Example.org ", undefined, "HU", "bob@example.org"],
    ["MAILTO:bob@example.org", undefined, "HU", "bob@example.org"], ["mailto:bob@example.org?subject=Hi%20there", undefined, "HU", "bob@example.org"],
    ["first.last+tag@gmail.com", undefined, "HU", "first.last+tag@gmail.com"], ["First.Last@Gmail.com", undefined, "HU", "first.last@gmail.com"],
    ["a.b.c@sub.example.co.uk", undefined, "HU", "a.b.c@sub.example.co.uk"], ["émile@example.com", undefined, "HU", "émile@example.com"],
    ["émile@example.com", undefined, "HU", "émile@example.com"], // NFC
    ["a@b", undefined, "HU", null], ["not an email", "email", "HU", null], ["@example.com", undefined, "HU", null], ["a b@example.com", undefined, "HU", null],
    // whatsapp
    ["36301234567@s.whatsapp.net", undefined, "HU", "+36301234567@wa"], ["36301234567@c.us", undefined, "HU", "+36301234567@wa"], ["+36301234567", "whatsapp", "HU", "+36301234567@wa"],
    ["+36301234567@wa", undefined, "HU", "+36301234567@wa"], ["12125550100@s.whatsapp.net", undefined, "HU", "+12125550100@wa"], ["120363000000000001@g.us", undefined, "HU", "group:120363000000000001@g.us"],
    ["98765@lid", undefined, "HU", "other:98765@lid"],
    // groups and other
    ["group:abc", undefined, "HU", "group:abc"], ["GROUP:ABC", undefined, "HU", "group:ABC"], ["group:", undefined, "HU", null], ["other:Foo Bar", undefined, "HU", "other:foo bar"],
    ["chat123", undefined, "HU", "other:chat123"], ["other:", undefined, "HU", null],
];

test(`handle normalization table (${TABLE.length} cases)`, () => {
    assert.ok(TABLE.length >= 60);
    for (const [raw, hint, region, expected] of TABLE) {
        const got = normalizeHandle(raw, hint, region);
        assert.equal(got?.handle_norm ?? null, expected, `${JSON.stringify(raw)} hint=${hint} region=${region}`);
    }
});

test("kinds are assigned consistently and formatting is human readable", () => {
    assert.equal(normalizeHandle("+36301234567").kind, "phone");
    assert.equal(normalizeHandle("a@example.com").kind, "email");
    assert.equal(normalizeHandle("36301234567@s.whatsapp.net").kind, "whatsapp");
    assert.equal(normalizeHandle("group:x").kind, "other");
    assert.equal(formatHandle("+36301234567"), "+36 30 123 4567");
    assert.equal(formatHandle("+36301234567@wa"), "+36 30 123 4567 (WhatsApp)");
    assert.equal(formatHandle("a@example.com"), "a@example.com");
    assert.equal(formatHandle("group:abc"), "abc");
});

test("normalization is idempotent: normalizing a normalized handle changes nothing", () => {
    for (const [raw, , region, expected] of TABLE) {
        if (!expected) continue;
        assert.equal(normalizeHandle(expected, undefined, region)?.handle_norm, expected, `${expected} (from ${JSON.stringify(raw)})`);
    }
});

test("normalization is fast once cached", () => {
    normalizeHandle("+36 30 123 4567");
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) normalizeHandle("+36 30 123 4567");
    assert.ok((performance.now() - t0) / 100_000 < 0.05, "under 50 microseconds per call");
});

test("default region is configurable and validated", () => {
    assert.equal(loadConfig({}).defaultRegion, "HU");
    assert.equal(loadConfig({ REPLY_CORE_DEFAULT_REGION: "us" }).defaultRegion, "US");
    assert.throws(() => loadConfig({ REPLY_CORE_DEFAULT_REGION: "ZZZ" }), /REPLY_CORE_DEFAULT_REGION/);
});

function seed(repo) {
    repo.upsertMessages([
        msg(1, "+36301234567", { text: "from anna phone" }),
        msg(2, "+36301234567@wa", { channel: "whatsapp", providerMessageKey: "w1", text: "from anna wa", tsMs: NOW - 500 }),
        msg(3, "bela@example.com", { channel: "email", providerMessageKey: "e1", subject: "Hi", text: "mail body", tsMs: NOW - 100 }),
    ]);
}

test("merge moves handles and messages, rebuilds summaries, hides the source and records the audit entry", () => {
    const { db, repo, identity } = setup();
    seed(repo);
    const a = contactOf(db, "+36301234567");
    const wa = contactOf(db, "+36301234567@wa");
    assert.notEqual(a, wa, "different handles are different contacts until merged explicitly");
    const r = identity.merge(wa, a);
    assert.deepEqual([r.movedHandles, r.movedMessages, r.targetContactId], [["+36301234567@wa"], 1, a]);
    assert.match(r.mergeLogId, /^m_/);
    assert.equal(contactOf(db, "+36301234567@wa"), a);
    assert.equal(db.prepare("SELECT link_origin FROM contact_handles WHERE handle_norm='+36301234567@wa'").get().link_origin, "manual_merge");
    const s = db.prepare("SELECT * FROM contact_summary WHERE contact_id = ?").get(a);
    assert.equal(s.count_total, 2);
    assert.deepEqual(JSON.parse(s.counts_json), { imessage: 1, email: 0, whatsapp: 1 });
    assert.equal(s.last_channel, "whatsapp");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM contact_summary WHERE contact_id = ?").get(wa).n, 0);
    const hidden = db.prepare("SELECT hidden, merged_into FROM contacts WHERE id = ?").get(wa);
    assert.deepEqual([hidden.hidden, hidden.merged_into], [1, a]);
    const log = db.prepare("SELECT * FROM merge_log WHERE id = ?").get(r.mergeLogId);
    assert.deepEqual([log.action, log.from_contact_id, log.to_contact_id], ["merge", wa, a]);
    assert.deepEqual(JSON.parse(log.handles_json), [{ handle_norm: "+36301234567@wa", prior_origin: "auto" }]);
    assert.ok(!log.handles_json.includes("from anna"), "audit never holds message content");
});

test("merge then unmerge restores the database exactly (apart from the audit rows)", () => {
    const { db, repo, identity } = setup();
    seed(repo);
    const before = snapshot(db);
    const a = contactOf(db, "+36301234567");
    const wa = contactOf(db, "+36301234567@wa");
    const m = identity.merge(wa, a);
    assert.notEqual(snapshot(db), before);
    const u = identity.unmerge(m.mergeLogId);
    assert.deepEqual([u.restoredContactId, u.restoredHandles], [wa, ["+36301234567@wa"]]);
    assert.equal(snapshot(db), before);
    const logs = db.prepare("SELECT action, reverted_by FROM merge_log ORDER BY ts_ms").all();
    assert.deepEqual(logs.map((l) => l.action), ["merge", "unmerge"]);
    assert.ok(logs[0].reverted_by);
});

test("error codes: self, unknown, already merged, double unmerge, unknown log", () => {
    const { db, repo, identity } = setup();
    seed(repo);
    const a = contactOf(db, "+36301234567");
    const b = contactOf(db, "bela@example.com");
    const code = (fn) => { try { fn(); } catch (e) { return [e.status, e.code]; } return null; };
    assert.deepEqual(code(() => identity.merge(a, a)), [400, "cannot_merge_self"]);
    assert.deepEqual(code(() => identity.merge("nope", a)), [404, "contact_not_found"]);
    assert.deepEqual(code(() => identity.merge(a, "nope")), [404, "contact_not_found"]);
    const m = identity.merge(b, a);
    assert.deepEqual(code(() => identity.merge(b, a)), [404, "contact_not_found"], "a merged-away source no longer exists");
    assert.deepEqual(code(() => identity.merge(a, b)), [404, "contact_not_found"], "nor can it be a target");
    identity.unmerge(m.mergeLogId);
    assert.deepEqual(code(() => identity.unmerge(m.mergeLogId)), [409, "merge_already_reverted"]);
    assert.deepEqual(code(() => identity.unmerge("m_nope")), [404, "merge_not_found"]);
});

test("a chain of merges must be undone in reverse; the conflict lists the blocking handles", () => {
    const { db, repo, identity } = setup();
    seed(repo);
    const a = contactOf(db, "+36301234567");
    const wa = contactOf(db, "+36301234567@wa");
    const b = contactOf(db, "bela@example.com");
    const m1 = identity.merge(wa, a);
    const m2 = identity.merge(a, b);
    try { identity.unmerge(m1.mergeLogId); assert.fail("expected a conflict"); } catch (e) {
        assert.deepEqual([e.status, e.code], [409, "handle_conflict"]);
        assert.deepEqual(e.details.handles, ["+36301234567@wa"]);
    }
    identity.unmerge(m2.mergeLogId);
    identity.unmerge(m1.mergeLogId);
    for (const h of ["+36301234567", "+36301234567@wa", "bela@example.com"]) assert.ok(contactOf(db, h));
    assert.equal(new Set(["+36301234567", "+36301234567@wa", "bela@example.com"].map((h) => contactOf(db, h))).size, 3);
});

test("messages that arrive on a moved handle follow it through merge and unmerge", () => {
    const { db, repo, identity } = setup();
    seed(repo);
    const a = contactOf(db, "+36301234567");
    const wa = contactOf(db, "+36301234567@wa");
    const m = identity.merge(wa, a);
    repo.upsertMessages([msg(9, "+36301234567@wa", { channel: "whatsapp", providerMessageKey: "w9", tsMs: NOW - 10 })]);
    assert.equal(db.prepare("SELECT count_total n FROM contact_summary WHERE contact_id = ?").get(a).n, 3);
    identity.unmerge(m.mergeLogId);
    assert.equal(db.prepare("SELECT count_total n FROM contact_summary WHERE contact_id = ?").get(wa).n, 2, "restored contact owns both whatsapp messages");
    assert.equal(db.prepare("SELECT count_total n FROM contact_summary WHERE contact_id = ?").get(a).n, 1);
});

test("history lists merges and unmerges with names and counts", () => {
    const { db, repo, identity } = setup();
    seed(repo);
    const a = contactOf(db, "+36301234567");
    const wa = contactOf(db, "+36301234567@wa");
    const m = identity.merge(wa, a);
    identity.unmerge(m.mergeLogId);
    const h = identity.history(a);
    assert.deepEqual(h.map((x) => x.action), ["unmerge", "merge"]);
    assert.equal(h[0].fromName, "+36301234567@wa");
    assert.equal(h[1].handlesCount, 1);
    assert.ok(h[1].revertedBy && !h[0].revertedBy);
    assert.throws(() => identity.history("nope"), (e) => e.code === "contact_not_found");
});

test("address-book import links handles, retires auto contacts, protects manual merges, reports conflicts, and is idempotent", () => {
    const { db, repo, identity } = setup();
    seed(repo);
    const autoAnna = contactOf(db, "+36301234567");
    const people = [
        { externalId: "CN1", displayName: "Anna K", handles: [{ handle_norm: "+36301234567", kind: "phone" }, { handle_norm: "+36301234567@wa", kind: "whatsapp" }, { handle_norm: "anna@example.com", kind: "email" }] },
        { externalId: "CN2", displayName: "Landline Bela", handles: [{ handle_norm: "+3611111111", kind: "phone" }] },
        { externalId: "CN3", displayName: "Landline Cili", handles: [{ handle_norm: "+3611111111", kind: "phone" }] },
    ];
    const r = identity.importContacts(people);
    assert.deepEqual([r.created, r.updated, r.linked], [3, 0, 4]);
    assert.deepEqual(r.conflicts.map((c) => [c.handle_norm, c.skippedExternalId]), [["+3611111111", "CN3"]]);
    const anna = db.prepare("SELECT * FROM contacts WHERE external_id = 'CN1'").get();
    assert.equal(anna.display_name, "Anna K");
    assert.equal(contactOf(db, "+36301234567"), anna.id);
    assert.equal(contactOf(db, "+36301234567@wa"), anna.id, "the address book links the whatsapp twin");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM contacts WHERE id = ?").get(autoAnna).n, 0, "the empty auto contact is retired");
    assert.equal(db.prepare("SELECT count_total n FROM contact_summary WHERE contact_id = ?").get(anna.id).n, 2);
    const after = snapshot(db);
    assert.deepEqual(identity.importContacts(people).created, 0);
    assert.equal(snapshot(db), after, "importing the same list twice changes nothing");

    // a manual merge survives a later import that claims the handle
    const bela = contactOf(db, "bela@example.com");
    identity.merge(bela, anna.id);
    const r2 = identity.importContacts([{ externalId: "CN9", displayName: "Other Bela", handles: [{ handle_norm: "bela@example.com", kind: "email" }] }]);
    assert.equal(r2.protectedByMerge, 1);
    assert.equal(contactOf(db, "bela@example.com"), anna.id);
    identity.importContacts([{ externalId: "CN1", displayName: "Anna Kovacs", handles: [] }]);
    assert.equal(db.prepare("SELECT display_name n FROM contacts WHERE external_id = 'CN1'").get().n, "Anna Kovacs", "a renamed person is updated");
});

test("resetToAuto undoes manual merges: address-book people get their handles back, others become auto contacts", () => {
    const { db, repo, identity } = setup();
    seed(repo);
    identity.importContacts([{ externalId: "CN1", displayName: "Anna K", handles: [{ handle_norm: "+36301234567", kind: "phone" }] }]);
    const anna = contactOf(db, "+36301234567");
    const wa = contactOf(db, "+36301234567@wa");
    const bela = contactOf(db, "bela@example.com");
    identity.merge(wa, anna);
    identity.merge(anna, bela); // address-book person merged away into an auto contact
    const r = identity.resetToAuto();
    assert.equal(r.relinked, 2, "the two handles that were moved by merges");
    assert.equal(contactOf(db, "+36301234567"), anna, "address-book handle returns to its person");
    assert.equal(db.prepare("SELECT link_origin FROM contact_handles WHERE handle_norm = '+36301234567'").get().link_origin, "apple_contacts");
    assert.equal(db.prepare("SELECT hidden FROM contacts WHERE id = ?").get(anna).hidden, 0);
    const owners = ["+36301234567", "+36301234567@wa", "bela@example.com"].map((h) => contactOf(db, h));
    assert.equal(new Set(owners).size, 3);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages").get().n, 3, "messages untouched");
    assert.ok(db.prepare("SELECT COUNT(*) n FROM merge_log").get().n >= 2, "log kept");
});

test("property: random merge/unmerge sequences keep every handle owned by exactly one contact with correct summaries", () => {
    const { db, repo, identity } = setup();
    const rng = makeRng(99);
    const handles = Array.from({ length: 30 }, (_, i) => `+1212555${String(1000 + i)}`);
    repo.upsertMessages(handles.flatMap((h, i) => Array.from({ length: 1 + (i % 4) }, (_, k) => msg(i * 10 + k, h, { channel: ["imessage", "whatsapp", "email"][k % 3], providerMessageKey: `p${i}-${k}` }))));
    const total = db.prepare("SELECT COUNT(*) n FROM messages").get().n;
    const active = () => db.prepare("SELECT id FROM contacts WHERE merged_into IS NULL").all().map((r) => r.id);
    const stack = [];
    const check = () => {
        assert.equal(db.prepare("SELECT COUNT(*) n FROM handles h WHERE NOT EXISTS (SELECT 1 FROM contact_handles c WHERE c.handle_norm = h.handle_norm)").get().n, 0);
        assert.equal(db.prepare("SELECT COUNT(*) n FROM contact_handles c WHERE NOT EXISTS (SELECT 1 FROM contacts x WHERE x.id = c.contact_id AND x.merged_into IS NULL)").get().n, 0, "handles only belong to active contacts");
        assert.equal(db.prepare("SELECT COALESCE(SUM(count_total),0) n FROM contact_summary").get().n, total, "summaries account for every message");
        for (const s of db.prepare("SELECT * FROM contact_summary").all()) {
            const real = db.prepare("SELECT COUNT(*) n FROM messages m JOIN contact_handles h ON h.handle_norm = m.handle_norm WHERE h.contact_id = ?").get(s.contact_id).n;
            assert.equal(s.count_total, real);
        }
    };
    check();
    for (let i = 0; i < 120; i++) {
        if (stack.length && rng() < 0.4) { identity.unmerge(stack.pop()); }
        else {
            const ids = active();
            if (ids.length < 2) continue;
            const src = rng.pick(ids);
            const dst = rng.pick(ids.filter((x) => x !== src));
            stack.push(identity.merge(src, dst).mergeLogId);
        }
        check();
    }
    while (stack.length) { identity.unmerge(stack.pop()); check(); }
    assert.equal(active().length, 30, "everything undone gives back 30 contacts");
});

test("merge and unmerge stay fast with 50,000 messages", () => {
    const { db, repo, identity } = setup();
    const batch = [];
    for (let i = 0; i < 50_000; i++) batch.push(msg(i, i % 2 ? "+12125550001" : "+12125550002", { providerMessageKey: `b${i}` }));
    for (let i = 0; i < batch.length; i += 5000) repo.upsertMessages(batch.slice(i, i + 5000));
    const a = contactOf(db, "+12125550001");
    const b = contactOf(db, "+12125550002");
    let t = performance.now();
    const m = identity.merge(b, a);
    const mergeMs = performance.now() - t;
    t = performance.now();
    identity.unmerge(m.mergeLogId);
    const unmergeMs = performance.now() - t;
    assert.ok(mergeMs < 600 && unmergeMs < 600, `merge ${Math.round(mergeMs)} ms, unmerge ${Math.round(unmergeMs)} ms (budget 200 ms, 3x tolerance)`);
    assert.equal(m.movedMessages, 25_000);
});

test("HTTP: merge, unmerge, history and error envelopes", async (t) => {
    const { db, repo, identity } = setup();
    seed(repo);
    const { app, port } = await startServer({ deps: { identity } });
    t.after(() => app.close());
    const post = (p, body) => request(port, { method: "POST", path: p, headers: { host: `127.0.0.1:${port}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const get = (p) => request(port, { path: p, headers: { host: `127.0.0.1:${port}` } });
    const a = contactOf(db, "+36301234567");
    const wa = contactOf(db, "+36301234567@wa");
    const bela = contactOf(db, "bela@example.com");

    const dup = await get(`/api/contacts/${a}/duplicates`);
    assert.deepEqual(dup.json.items.map((d) => [d.id, d.reason]), [[wa, "same_number"]]);
    assert.equal((await post(`/api/contacts/${a}/duplicates/dismiss`, { otherContactId: wa, x: 1 })).status, 400);
    assert.equal((await post(`/api/contacts/${a}/duplicates/dismiss`, { otherContactId: wa })).status, 200);
    assert.deepEqual((await get(`/api/contacts/${a}/duplicates`)).json.items, []);
    assert.equal((await get("/api/contacts/nope/duplicates")).status, 404);
    assert.equal((await post(`/api/contacts/${a}/merge`, {})).status, 400);
    assert.equal((await post(`/api/contacts/${a}/merge`, { sourceContactId: wa, extra: 1 })).status, 400);
    assert.equal((await post(`/api/contacts/${a}/merge`, { sourceContactId: a })).json.error.code, "cannot_merge_self");
    const ok = await post(`/api/contacts/${a}/merge`, { sourceContactId: wa });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.json.movedHandles, ok.json.movedMessages, ok.json.targetContactId], [["+36301234567@wa"], 1, a]);
    const hist = await get(`/api/contacts/${a}/merges`);
    assert.equal(hist.json.items[0].action, "merge");
    assert.equal((await get("/api/contacts/nope/merges")).status, 404);
    const m2 = await post(`/api/contacts/${bela}/merge`, { sourceContactId: a });
    const conflict = await post(`/api/contacts/${a}/unmerge`, { mergeLogId: ok.json.mergeLogId });
    assert.deepEqual([conflict.status, conflict.json.error.code, conflict.json.error.details.handles], [409, "handle_conflict", ["+36301234567@wa"]]);
    assert.equal((await post(`/api/contacts/${bela}/unmerge`, { mergeLogId: m2.json.mergeLogId })).status, 200);
    const un = await post(`/api/contacts/${a}/unmerge`, { mergeLogId: ok.json.mergeLogId });
    assert.deepEqual([un.status, un.json.restoredContactId, un.json.restoredHandles], [200, wa, ["+36301234567@wa"]]);
    assert.equal((await post(`/api/contacts/${a}/unmerge`, { mergeLogId: ok.json.mergeLogId })).json.error.code, "merge_already_reverted");
    assert.equal((await post(`/api/contacts/${a}/unmerge`, {})).status, 400);
});

test("identity-reset.js --to-auto runs against a stopped database", () => {
    const { home, db, repo, identity } = setup();
    seed(repo);
    identity.merge(contactOf(db, "+36301234567@wa"), contactOf(db, "+36301234567"));
    db.close();
    const r = spawnSync(process.execPath, ["scripts/identity-reset.js", "--to-auto"], { env: { ...process.env, REPLY_CORE_HOME: home }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /relinked 1 handle/);
    assert.equal(spawnSync(process.execPath, ["scripts/identity-reset.js"], { encoding: "utf8" }).status, 2);
});

test("no code path links handles by name, domain or number similarity", () => {
    const walk = (d) => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
    for (const f of walk(path.resolve("src")).filter((x) => x.endsWith(".js"))) {
        const src = readFileSync(f, "utf8");
        assert.ok(!/levenshtein|similarity|fuzzy|soundex|jaro|didYouMean/i.test(src), `${f} looks like it matches by similarity`);
    }
    // the only writers of link_origin = 'manual_merge' are the explicit merge path
    const svc = readFileSync(path.resolve("src/identity/service.js"), "utf8");
    assert.equal((svc.match(/"manual_merge"/g) ?? []).length, 1);
});

test("duplicate suggestions: same number as phone and WhatsApp, same name written alike; proposals only, dismissals remembered", () => {
    const { db, repo, identity } = setup();
    seed(repo);
    identity.importContacts([
        { externalId: "CN1", displayName: "Éva  Kovács", handles: [{ handle_norm: "eva@example.com", kind: "email" }] },
        { externalId: "CN2", displayName: "eva kovacs", handles: [{ handle_norm: "+3611111111", kind: "phone" }] },
        { externalId: "CN3", displayName: "Eva Nagy", handles: [{ handle_norm: "+3622222222", kind: "phone" }] },
    ]);
    const before = snapshot(db);
    const phone = contactOf(db, "+36301234567");
    const wa = contactOf(db, "+36301234567@wa");
    assert.deepEqual(identity.duplicatesOf(phone).map((d) => [d.id, d.reason]), [[wa, "same_number"]]);
    assert.deepEqual(identity.duplicatesOf(wa).map((d) => [d.id, d.reason]), [[phone, "same_number"]]);
    assert.equal(identity.duplicatesOf(phone)[0].countTotal, 1);
    const eva = contactOf(db, "eva@example.com");
    const eva2 = contactOf(db, "+3611111111");
    assert.deepEqual(identity.duplicatesOf(eva).map((d) => [d.id, d.reason]), [[eva2, "same_name"]], "Eva Nagy is a different name");
    assert.deepEqual(identity.duplicatesOf(contactOf(db, "bela@example.com")), [], "an address-named contact never matches by name");
    assert.equal(snapshot(db), before, "suggesting changes nothing");
    identity.dismissDuplicate(eva2, eva);
    assert.deepEqual(identity.duplicatesOf(eva), []);
    assert.deepEqual(identity.duplicatesOf(eva2), []);
    assert.equal(identity.duplicatesOf(phone).length, 1, "other pairs are unaffected");
    identity.merge(wa, phone);
    assert.deepEqual(identity.duplicatesOf(phone), [], "a merged contact is no longer suggested");
    assert.throws(() => identity.duplicatesOf("nope"), { code: "contact_not_found" });
});
