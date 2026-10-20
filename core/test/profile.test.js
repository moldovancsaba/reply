import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import { detailsOf, toImport } from "../src/connectors/contacts.js";
import { createIdentity } from "../src/identity/service.js";
import { exportUserState, importUserState } from "../src/ops/userstate.js";
import { createProfile } from "../src/profile/service.js";
import { createReadService } from "../src/read/service.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { request, startServer } from "./helpers.js";

const schemaDoc = JSON.parse(readFileSync(new URL("../schema/api-read.json", import.meta.url), "utf8"));
const ajv = new Ajv({ strict: false });
ajv.addFormat("date-time", true);
ajv.addSchema(schemaDoc);
const isProfile = (doc) => { const v = ajv.getSchema(`${schemaDoc.$id}#/definitions/Profile`); assert.ok(v(doc), JSON.stringify([v.errors, doc]).slice(0, 600)); };

const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);
const DAY = 86_400_000;
const msg = (n, handle, extra = {}) => ({ channel: "imessage", account: "", providerMessageKey: `m${n}`, threadKey: "t", handle_norm: handle, isFromMe: n % 2 === 0, tsMs: NOW - n * DAY, text: `t${n}`, attachments: [], ...extra });

function setup() {
    const home = mkdtempSync(path.join(os.tmpdir(), "rc-prof-"));
    const { db } = openDb(home);
    const repo = createRepo(db, { now: () => NOW });
    const identity = createIdentity({ db, repo });
    const profile = createProfile({ db, now: () => NOW });
    const read = createReadService({ db });
    return { home, db, repo, identity, profile, read };
}
const owner = (db, h) => db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = ?").get(h).c;

test("helper schema accepts the new address-book fields and still rejects unknown ones", () => {
    const doc = JSON.parse(readFileSync(new URL("../helper/schema/v1.json", import.meta.url), "utf8"));
    const ajv = new Ajv({ strict: false });
    const v = ajv.compile(doc);
    const base = { type: "contact", schemaVersion: 1, contactId: "1", displayName: "A", phones: [], emails: [] };
    assert.ok(v({ ...base, organization: "Org", jobTitle: "CTO", birthday: "1985-03-09", urls: ["https://x.io"], addresses: ["1 Main St"] }), JSON.stringify(v.errors));
    assert.ok(v({ ...base, birthday: "--12-24" }));
    assert.equal(v({ ...base, birthday: "yesterday" }), false);
    assert.equal(v({ ...base, favouriteColour: "red" }), false);
});

test("detailsOf keeps only what is there, trimmed and bounded", () => {
    assert.deepEqual(detailsOf({ organization: " Acme ", jobTitle: "", urls: ["https://a.io", " ", 5], addresses: [], nickname: undefined }), { organization: "Acme", urls: ["https://a.io"] });
    assert.deepEqual(detailsOf({}), {});
    assert.equal(detailsOf({ organization: "x".repeat(900) }).organization.length, 300);
    assert.equal(detailsOf({ urls: Array.from({ length: 50 }, (_, i) => `https://e${i}.io`) }).urls.length, 20);
});

test("an address-book import stores the details, and a change in them (same name and handles) is picked up", () => {
    const { db, repo, identity, profile } = setup();
    repo.upsertMessages([msg(1, "+36301234567")]);
    const rec = { contactId: "ab1", displayName: "Anna Kovacs", phones: ["+36 30 123 4567"], emails: [], organization: "Acme", jobTitle: "CFO" };
    identity.importContacts([toImport(rec, "HU").person]);
    const id = owner(db, "+36301234567");
    assert.deepEqual(profile.get(id).card, { organization: "Acme", jobTitle: "CFO" });
    identity.importContacts([toImport({ ...rec, jobTitle: "CEO", birthday: "--03-09" }, "HU").person]);
    assert.deepEqual(profile.get(id).card, { organization: "Acme", jobTitle: "CEO", birthday: "--03-09" });
    identity.importContacts([toImport({ ...rec, organization: undefined, jobTitle: undefined }, "HU").person]);
    assert.deepEqual(profile.get(id).card, {}, "details removed in the address book disappear here too");
});

test("profile: facts come from the messages, per channel, with handles and when", () => {
    const { db, repo, identity, profile } = setup();
    repo.upsertMessages([msg(1, "+36301234567"), msg(2, "+36301234567"), msg(3, "+36301234567", { channel: "email", handle_norm: "anna@example.com" }), msg(40, "+36301234567")]);
    const id = owner(db, "+36301234567");
    identity.merge(owner(db, "anna@example.com"), id);
    const p = profile.get(id);
    assert.equal(p.stats.total, 4);
    assert.equal(p.stats.sent, 2); // n = 2 and 40
    assert.equal(p.stats.byChannel.imessage.total, 3);
    assert.equal(p.stats.byChannel.email.total, 1);
    assert.equal(p.stats.byChannel.whatsapp.total, 0);
    assert.equal(p.stats.firstTs, new Date(NOW - 40 * DAY).toISOString());
    assert.equal(p.stats.lastTs, new Date(NOW - 1 * DAY).toISOString());
    assert.equal(p.stats.last30Days, 3);
    assert.equal(p.stats.lastReceivedTs, new Date(NOW - 1 * DAY).toISOString());
    assert.equal(p.stats.lastSentTs, new Date(NOW - 2 * DAY).toISOString());
    assert.deepEqual(p.handles.map((h) => [h.value, h.messages, h.kind]), [["+36301234567", 3, "phone"], ["anna@example.com", 1, "email"]]);
});

test("profile fields: validated, trimmed, partial updates keep the rest, empty clears", () => {
    const { db, repo, profile } = setup();
    repo.upsertMessages([msg(1, "+36301234567")]);
    const id = owner(db, "+36301234567");
    assert.deepEqual(profile.get(id).profile, { profession: "", company: "", relationship: "", linkedinUrl: "", intro: "", updatedAt: null });
    const r = profile.setProfile(id, { profession: " Designer ", company: "Acme", linkedinUrl: "https://www.linkedin.com/in/anna" });
    assert.equal(r.profession, "Designer");
    assert.equal(profile.setProfile(id, { intro: "Met at the fair" }).company, "Acme", "a partial update keeps other fields");
    assert.equal(profile.setProfile(id, { company: "" }).company, "");
    for (const bad of [{ nope: 1 }, { profession: 5 }, { profession: "x".repeat(201) }, { linkedinUrl: "javascript:alert(1)" }, { linkedinUrl: "not a url" }, [], null]) assert.throws(() => profile.setProfile(id, bad), (e) => e.status === 400, JSON.stringify(bad));
    assert.throws(() => profile.setProfile("nope", {}), (e) => e.status === 404);
});

test("notes: add, list newest first, delete, limits", () => {
    const { db, repo, profile } = setup();
    repo.upsertMessages([msg(1, "+36301234567")]);
    const id = owner(db, "+36301234567");
    const a = profile.addNote(id, { text: " first " });
    let t = NOW;
    const p2 = createProfile({ db, now: () => ++t + 1000 });
    const b = p2.addNote(id, { text: "second" });
    assert.equal(a.text, "first");
    assert.deepEqual(profile.get(id).notes.map((n) => n.text), ["second", "first"]);
    assert.deepEqual(profile.deleteNote(id, a.id), { deleted: true });
    assert.deepEqual(profile.get(id).notes.map((n) => n.id), [b.id]);
    assert.throws(() => profile.deleteNote(id, a.id), (e) => e.status === 404 && e.code === "note_not_found");
    for (const bad of [{}, { text: "  " }, { text: 5 }, { text: "x".repeat(4001) }, { text: "ok", extra: 1 }]) assert.throws(() => profile.addNote(id, bad), (e) => e.status === 400);
    for (let i = 0; i < 199; i++) profile.addNote(id, { text: `n${i}` });
    assert.throws(() => profile.addNote(id, { text: "one too many" }), (e) => e.status === 409 && e.code === "too_many_notes");
});

test("a person merged away has no profile (404 with mergedInto) and the kept person lists who was merged in", () => {
    const { db, repo, identity, profile } = setup();
    repo.upsertMessages([msg(1, "+36301234567"), msg(2, "anna@example.com", { channel: "email" })]);
    const a = owner(db, "+36301234567");
    const b = owner(db, "anna@example.com");
    identity.merge(b, a);
    assert.deepEqual(profile.get(a).mergedFrom, ["anna@example.com"]);
    assert.throws(() => profile.get(b), (e) => e.status === 404 && e.details.mergedInto === a);
    assert.equal(profile.get(a).handles.length, 2);
});

test("what the user wrote follows the handles when an automatic contact is replaced by an address-book contact", () => {
    const { db, repo, identity, profile } = setup();
    repo.upsertMessages([msg(1, "+36301234567")]);
    const auto = owner(db, "+36301234567");
    profile.addNote(auto, { text: "Prefers email" });
    profile.setProfile(auto, { profession: "Designer" });
    identity.importContacts([toImport({ contactId: "ab1", displayName: "Anna Kovacs", phones: ["+36 30 123 4567"], emails: [] }, "HU").person]);
    const kept = owner(db, "+36301234567");
    assert.notEqual(kept, auto, "the auto contact was replaced");
    const p = profile.get(kept);
    assert.deepEqual(p.notes.map((n) => n.text), ["Prefers email"]);
    assert.equal(p.profile.profession, "Designer");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM contact_notes WHERE contact_id = ?").get(auto).n, 0);
});

test("notes and profile fields survive a rebuild through the user-state export, even before the messages are back", () => {
    const a = setup();
    a.repo.upsertMessages([msg(1, "+36301234567")]);
    const id = owner(a.db, "+36301234567");
    a.profile.addNote(id, { text: "Keep me" });
    a.profile.setProfile(id, { relationship: "Client" });
    const state = exportUserState(a.db, NOW);
    assert.equal(state.notes.length, 1);
    assert.equal(state.profiles.length, 1);
    const b = setup();
    const r = importUserState(b.db, b.identity, JSON.parse(JSON.stringify(state)));
    assert.equal(r.notes, 1);
    assert.equal(r.profiles, 1);
    const id2 = owner(b.db, "+36301234567");
    assert.deepEqual(b.profile.get(id2).notes.map((n) => n.text), ["Keep me"]);
    assert.equal(b.profile.get(id2).profile.relationship, "Client");
    assert.equal(importUserState(b.db, b.identity, state).notes, 0, "importing twice does not duplicate notes");
    // the messages arrive later and land on the same contact
    b.repo.upsertMessages([msg(1, "+36301234567")]);
    assert.equal(owner(b.db, "+36301234567"), id2);
});

test("HTTP: profile read, edit, notes; uniform errors; no logging of what the user wrote", async (t) => {
    const s = setup();
    s.repo.upsertMessages([msg(1, "+36301234567")]);
    const id = owner(s.db, "+36301234567");
    const { app, port, lines } = await startServer({ deps: { read: s.read, identity: s.identity, profile: s.profile } });
    t.after(() => app.close());
    const call = (method, p, body) => request(port, { method, path: p, headers: { host: `127.0.0.1:${port}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const got = await call("GET", `/api/contacts/${id}/profile`);
    assert.equal(got.status, 200);
    isProfile(got.json);
    assert.equal(got.json.stats.total, 1);
    assert.equal(got.headers["cache-control"], "no-store");
    const put = await call("PUT", `/api/contacts/${id}/profile`, { company: "SECRET-COMPANY-NAME" });
    assert.equal(put.status, 200);
    assert.equal(put.json.company, "SECRET-COMPANY-NAME");
    const note = await call("POST", `/api/contacts/${id}/notes`, { text: "SECRET-NOTE-TEXT" });
    assert.equal(note.status, 201);
    assert.equal((await call("GET", `/api/contacts/${id}/profile`)).json.notes[0].text, "SECRET-NOTE-TEXT");
    assert.equal((await call("DELETE", `/api/contacts/${id}/notes/${note.json.id}`)).status, 200);
    const bad = await call("PUT", `/api/contacts/${id}/profile`, { nope: 1 });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "invalid_request");
    assert.equal((await call("GET", "/api/contacts/unknown/profile")).status, 404);
    assert.equal((await call("GET", `/api/contacts/${id}/profile?x=1`)).status, 400);
    assert.doesNotMatch(lines.join("\n"), /SECRET-/);
});

test("unread: messages received since you last saw the conversation, nothing for what was there before the baseline", () => {
    const { db, read } = setup();
    const repo = createRepo(db); // the real clock: this test needs messages newer than the migration
    assert.ok(Number(db.prepare("SELECT value FROM app_settings WHERE key = 'unread_baseline_ms'").get().value) > 0, "the migration recorded a baseline");
    const base = Date.now() - 60_000; // pretend the baseline was a minute ago
    db.prepare("UPDATE app_settings SET value = ? WHERE key = 'unread_baseline_ms'").run(String(base));
    repo.upsertMessages([msg(1, "+36301234567"), msg(2, "+36301234567")]); // NOW is in the past: before the baseline
    const id = owner(db, "+36301234567");
    assert.equal(read.listContacts({ limit: 10 }).items[0].unread, 0);
    const later = (n, extra = {}) => ({ ...msg(n, "+36301234567", extra), tsMs: base + 10_000 + n * 10 });
    repo.upsertMessages([later(10, { isFromMe: false }), later(11, { isFromMe: false }), later(12, { isFromMe: true })]);
    assert.equal(read.listContacts({ limit: 10 }).items.find((i) => i.id === id).unread, 2, "only received messages count");
    assert.deepEqual(read.markRead(id), { unread: 0 });
    assert.equal(read.listContacts({ limit: 10 }).items.find((i) => i.id === id).unread, 0);
    repo.upsertMessages([{ ...later(20, { isFromMe: false }), tsMs: Date.now() + 1 }]);
    assert.equal(read.listContacts({ limit: 10 }).items.find((i) => i.id === id).unread, 1, "new after reading");
    assert.throws(() => read.markRead("nope"), (e) => e.status === 404);
});
