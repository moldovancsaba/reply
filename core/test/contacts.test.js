import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createContactsConnector, toImport } from "../src/connectors/contacts.js";
import { createRunner } from "../src/connectors/runner.js";
import { sha256File } from "../src/helper/index.js";
import { createIdentity } from "../src/identity/service.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { buildFixtures } from "./fixtures/build.js";
import { memoryLogger } from "./helpers.js";

const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "rc-ct-"));
let fx;
let root;
test.before(async () => { root = tmp(); fx = await buildFixtures({ seed: 42, out: path.join(root, "fx") }); });
test.after(() => rmSync(root, { recursive: true, force: true }));

// helper stub: `doctor` reports a chosen contacts state, `contacts` prints a file of records and a cursor line
function stub({ file, doctor = "ok", exit = 0 }) {
    const dir = tmp();
    const bin = path.join(dir, "helper");
    writeFileSync(bin, `#!/bin/sh
if [ "$1" = "doctor" ]; then echo '{"contacts":"${doctor}","imessage":"skipped","mail":"skipped"}'; exit 0; fi
if [ "$1" = "contacts" ]; then
  if [ ${exit} -ne 0 ]; then echo "reply-core-helper: permission_denied: no" >&2; exit ${exit}; fi
  cat "${file}"; echo '{"type":"cursor","schemaVersion":1,"source":"contacts","cursor":{"offset":0},"exported":0,"more":false}'; exit 0
fi
exit 2
`);
    chmodSync(bin, 0o755);
    writeFileSync(`${bin}.sha256`, sha256File(bin));
    return bin;
}

function pipeline(helper, { messages = [] } = {}) {
    const home = tmp();
    const { db } = openDb(home);
    const repo = createRepo(db, { now: () => NOW });
    let t = NOW;
    const identity = createIdentity({ db, repo, now: () => ++t });
    if (messages.length) repo.upsertMessages(messages);
    const results = [];
    const runner = createRunner({ db, repo, sleep: async () => {}, onContacts: (people) => { const r = identity.importContacts(people); results.push(r); return r; } });
    const connector = createContactsConnector({ config: { defaultRegion: "HU" }, helper });
    return { db, repo, identity, runner, connector, results };
}

const snapshot = (db) => JSON.stringify({
    contacts: db.prepare("SELECT id, display_name, origin, external_id, fingerprint FROM contacts ORDER BY id").all(),
    links: db.prepare("SELECT handle_norm, contact_id, link_origin FROM contact_handles ORDER BY handle_norm").all(),
});

test("toImport: phones get a WhatsApp twin, emails are normalized, bad handles are counted, no handles means skipped", () => {
    const r = toImport({ contactId: "C1", displayName: "Anna", phones: ["+36 30 123 4567", "garbage"], emails: ["Anna@Example.COM", "nope"] }, "HU");
    assert.deepEqual(r.person.handles.map((h) => h.handle_norm).sort(), ["+36301234567", "+36301234567@wa", "anna@example.com"]);
    assert.deepEqual(r.person.handles.map((h) => h.kind).sort(), ["email", "phone", "whatsapp"]);
    assert.equal(r.skippedHandles, 2);
    assert.equal(r.person.fingerprint.length, 32);
    assert.deepEqual(toImport({ contactId: "C2", displayName: "Nobody", phones: [], emails: [] }, "HU"), { skip: "no_handles", skippedHandles: 0 });
    const same = toImport({ contactId: "C1", displayName: "Anna", phones: ["+36301234567"], emails: ["anna@example.com"] }, "HU");
    assert.equal(same.person.fingerprint, r.person.fingerprint, "formatting differences do not change the fingerprint");
    assert.notEqual(toImport({ contactId: "C1", displayName: "Anna B", phones: ["+36301234567"], emails: ["anna@example.com"] }, "HU").person.fingerprint, same.person.fingerprint);
    assert.equal(toImport({ contactId: "C3", displayName: "", phones: ["+36301234567"], emails: [] }, "HU").person.displayName, "+36301234567", "no name falls back to the first handle");
});

test("fixture address book: every person with a handle is imported, edge cases behave", async () => {
    const p = pipeline(stub({ file: fx.contacts }));
    const run = await p.runner.start(p.connector, "").done;
    assert.equal(run.outcome, "ok");
    assert.equal(p.repo.getSyncState("contacts", "").messages_total, 32, "people imported");
    const names = p.db.prepare("SELECT display_name n, external_id e FROM contacts").all();
    assert.equal(names.filter((c) => c.n === "Same Name").length, 2, "two people with one name stay two contacts");
    assert.ok(!names.some((c) => c.e === "CNID-EDGE-NOHANDLE"), "a person with no handles is not imported");
    assert.ok(names.some((c) => c.n === "山田 太郎"));
    assert.ok(names.some((c) => c.n === "Example Org Ltd"));
    const multi = p.db.prepare("SELECT id FROM contacts WHERE external_id = 'CNID-EDGE-MULTI'").get().id;
    const handles = p.db.prepare("SELECT handle_norm h FROM contact_handles WHERE contact_id = ?").all(multi).map((r) => r.h).sort();
    assert.deepEqual(handles, ["+12125559001", "+12125559001@wa", "+12125559002", "+12125559002@wa", "+12125559003", "+12125559003@wa", "multi1@example.com", "multi2@example.org"]);
    const r = p.results[0];
    assert.equal(r.created, 32);
    assert.deepEqual(r.conflicts.map((c) => c.skippedExternalId).sort(), ["CNID-EDGE-SHARED-B", "CNID-EDGE-SHARED-B"], "the shared landline and its WhatsApp twin are reported, not re-linked");
    const owner = p.db.prepare("SELECT c.external_id e FROM contact_handles h JOIN contacts c ON c.id = h.contact_id WHERE h.handle_norm = '+12125559041'").get().e;
    assert.equal(owner, "CNID-EDGE-SHARED-A", "the first person keeps it");
});

test("importing the same address book again changes nothing", async () => {
    const p = pipeline(stub({ file: fx.contacts }));
    await p.runner.start(p.connector, "").done;
    const before = snapshot(p.db);
    await p.runner.start(p.connector, "").done;
    assert.equal(snapshot(p.db), before);
    assert.deepEqual([p.results[1].created, p.results[1].unchanged, p.results[1].linked], [0, 32, 0]);
});

test("a changed person is updated; a renamed person keeps the same contact", async () => {
    const file = path.join(tmp(), "c.ndjson");
    const lines = readFileSync(fx.contacts, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const p = pipeline(stub({ file }));
    await p.runner.start(p.connector, "").done;
    const id = p.db.prepare("SELECT id FROM contacts WHERE external_id = 'CNID-0001'").get().id;
    const edited = lines.map((l) => (l.contactId === "CNID-0001" ? { ...l, displayName: "Renamed Person", phones: [...l.phones, "+12125558888"] } : l));
    writeFileSync(file, edited.map((l) => JSON.stringify(l)).join("\n") + "\n");
    await p.runner.start(p.connector, "").done;
    assert.equal(p.db.prepare("SELECT id FROM contacts WHERE external_id = 'CNID-0001'").get().id, id);
    assert.equal(p.db.prepare("SELECT display_name n FROM contacts WHERE id = ?").get(id).n, "Renamed Person");
    assert.equal(p.db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = '+12125558888'").get().c, id);
    assert.equal(p.results[1].updated, 1);
    assert.equal(p.results[1].unchanged, 31);
});

test("existing conversations are grouped under the person's name, including WhatsApp, and auto contacts are retired", async () => {
    const msg = (n, h, extra = {}) => ({ channel: "imessage", account: "", providerMessageKey: `k${n}`, threadKey: "t", handle_norm: h, isFromMe: false, tsMs: NOW - n * 1000, text: `t${n}`, attachments: [], ...extra });
    const p = pipeline(stub({ file: fx.contacts }), { messages: [msg(1, "+12125550100"), msg(2, "+12125550100@wa", { channel: "whatsapp", providerMessageKey: "w1" }), msg(3, "+19999999999")] });
    assert.equal(p.db.prepare("SELECT COUNT(*) n FROM contacts").get().n, 3);
    await p.runner.start(p.connector, "").done;
    const person = p.db.prepare("SELECT id, display_name n FROM contacts WHERE external_id = 'CNID-0000'").get();
    const s = p.db.prepare("SELECT count_total t, counts_json c FROM contact_summary WHERE contact_id = ?").get(person.id);
    assert.equal(s.t, 2);
    assert.deepEqual(JSON.parse(s.c), { imessage: 1, email: 0, whatsapp: 1 });
    assert.equal(p.db.prepare("SELECT COUNT(*) n FROM contacts WHERE origin = 'auto'").get().n, 1, "only the unknown number stays an auto contact");
    assert.notEqual(person.n, "+12125550100");
});

test("a manual merge made before an import survives it", async () => {
    const msg = (n, h) => ({ channel: "email", account: "", providerMessageKey: `k${n}`, threadKey: "t", handle_norm: h, isFromMe: false, tsMs: NOW - n * 1000, text: `t${n}`, attachments: [] });
    const p = pipeline(stub({ file: fx.contacts }), { messages: [msg(1, "someone@example.com"), msg(2, "other@example.com")] });
    const a = p.db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = 'someone@example.com'").get().c;
    const b = p.db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = 'other@example.com'").get().c;
    p.identity.merge(b, a);
    const file = path.join(tmp(), "c.ndjson");
    writeFileSync(file, JSON.stringify({ type: "contact", schemaVersion: 1, contactId: "CNX", displayName: "Claims It", phones: [], emails: ["other@example.com"] }) + "\n");
    const p2 = { ...p, connector: createContactsConnector({ config: {}, helper: stub({ file }) }) };
    await p2.runner.start(p2.connector, "").done;
    assert.equal(p.db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = 'other@example.com'").get().c, a);
    assert.equal(p.results.at(-1).protectedByMerge, 1);
});

test("preflight: consent still to be asked is fine, denial blocks with a hint, a missing helper blocks", async () => {
    assert.deepEqual(await createContactsConnector({ helper: stub({ file: fx.contacts, doctor: "ok" }) }).preflight(), { ok: true });
    assert.deepEqual(await createContactsConnector({ helper: stub({ file: fx.contacts, doctor: "needs_consent" }) }).preflight(), { ok: true });
    const denied = await createContactsConnector({ helper: stub({ file: fx.contacts, doctor: "permission_denied" }) }).preflight();
    assert.deepEqual([denied.ok, denied.code], [false, "permission_denied"]);
    assert.match(denied.hint, /Contacts/);
    const none = await createContactsConnector({ helper: "/nonexistent/helper" }).preflight();
    assert.deepEqual([none.ok, none.code], [false, "helper_unavailable"]);
});

test("a refused consent prompt (helper exit 10) blocks the connector and imports nothing", async () => {
    const p = pipeline(stub({ file: fx.contacts, exit: 10 }));
    const run = await p.runner.start(p.connector, "").done;
    assert.deepEqual([run.outcome, run.errorCode], ["blocked", "permission_denied"]);
    assert.equal(p.db.prepare("SELECT COUNT(*) n FROM contacts").get().n, 0);
});

test("5,000 people import quickly and an unchanged re-run is cheap", { timeout: 60000 }, async () => {
    const file = path.join(tmp(), "big.ndjson");
    const lines = Array.from({ length: 5000 }, (_, i) => JSON.stringify({ type: "contact", schemaVersion: 1, contactId: `B${i}`, displayName: `Person ${i}`, phones: [`+1212555${String(1000 + i).padStart(4, "0")}`.slice(0, 12)], emails: [`p${i}@example.com`] }));
    writeFileSync(file, lines.join("\n") + "\n");
    const p = pipeline(stub({ file }));
    let t = performance.now();
    const first = await p.runner.start(p.connector, "").done;
    const firstMs = performance.now() - t;
    assert.equal(first.outcome, "ok");
    assert.equal(p.db.prepare("SELECT COUNT(*) n FROM contacts").get().n, 5000);
    t = performance.now();
    await p.runner.start(p.connector, "").done;
    const secondMs = performance.now() - t;
    assert.ok(firstMs < 4000 * 3, `first import ${Math.round(firstMs)} ms (budget 4 s with 3x tolerance)`);
    assert.ok(secondMs < 300 * 3, `unchanged re-run ${Math.round(secondMs)} ms (budget 300 ms with 3x tolerance)`);
    console.log(`contacts perf: first ${Math.round(firstMs)} ms, unchanged ${Math.round(secondMs)} ms`);
});

test("logs carry counts only: no name, number or address ever reaches the log", async () => {
    const { logger, lines } = memoryLogger();
    const home = tmp();
    const { db } = openDb(home);
    const repo = createRepo(db);
    const identity = createIdentity({ db, repo });
    const runner = createRunner({ db, repo, logger, sleep: async () => {}, onContacts: (p) => identity.importContacts(p) });
    const connector = createContactsConnector({ config: {}, logger, helper: stub({ file: fx.contacts }) });
    await runner.start(connector, "").done;
    const out = lines.join("");
    assert.ok(out.includes("connector.contacts page"));
    for (const secret of ["Anna", "Kovacs", "Multi Handle", "山田", "+12125550", "@example.", "CNID-"]) assert.ok(!out.includes(secret), `leaked ${secret}`);
});
