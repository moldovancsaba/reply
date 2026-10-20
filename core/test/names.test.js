import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { namesOf, toNormalized } from "../src/connectors/whatsapp.js";
import { toImport } from "../src/connectors/contacts.js";
import { createIdentity } from "../src/identity/service.js";
import { createReadService } from "../src/read/service.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";

const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);
const msg = (n, handle, extra = {}) => ({ channel: "whatsapp", account: "", providerMessageKey: `w${n}`, threadKey: "t", handle_norm: handle, isFromMe: false, tsMs: NOW - n * 1000, text: `t${n}`, attachments: [], ...extra });
function setup() {
    const { db } = openDb(mkdtempSync(path.join(os.tmpdir(), "rc-names-")));
    const repo = createRepo(db, { now: () => NOW });
    return { db, repo, identity: createIdentity({ db, repo }), read: createReadService({ db }) };
}
const owner = (db, h) => db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = ?").get(h).c;

test("namesOf: chat names without direction marks, only for chats with a usable name", () => {
    const out = namesOf([
        { j: "120363407760105150@g.us", n: "SEYU DATA" },
        { j: "36301234567@s.whatsapp.net", n: "‪Anna Kovacs‬" },
        { j: "5562066571432@lid", n: "  " },
        { j: "status@broadcast", n: "x" },
        { j: "120363407760105151@g.us", n: null },
    ], "HU");
    assert.deepEqual(out.map((x) => x.displayName), ["SEYU DATA", "Anna Kovacs"]);
    assert.ok(out[0].handle_norm.startsWith("group:"));
});

test("a group chat is named after its subject; a later rename follows; an address-book name is never overridden", () => {
    const { db, repo, identity } = setup();
    repo.upsertMessages([msg(1, "group:120363407760105150@g.us"), msg(2, "+36301234567@wa")]);
    const group = owner(db, "group:120363407760105150@g.us");
    assert.equal(db.prepare("SELECT display_name n FROM contacts WHERE id = ?").get(group).n, "group:120363407760105150@g.us");
    assert.equal(identity.applyNames([{ handle_norm: "group:120363407760105150@g.us", displayName: "SEYU DATA" }]), 1);
    assert.equal(db.prepare("SELECT display_name n FROM contacts WHERE id = ?").get(group).n, "SEYU DATA");
    assert.equal(identity.applyNames([{ handle_norm: "group:120363407760105150@g.us", displayName: "SEYU DATA" }]), 0, "unchanged: nothing to do");
    assert.equal(identity.applyNames([{ handle_norm: "group:120363407760105150@g.us", displayName: "SEYU DATA 2" }]), 1);
    // an address-book contact keeps its name
    identity.importContacts([toImport({ contactId: "ab1", displayName: "Anna Kovacs", phones: ["+36 30 123 4567"], emails: [] }, "HU").person]);
    assert.equal(identity.applyNames([{ handle_norm: "+36301234567@wa", displayName: "annie (push name)" }]), 0);
    assert.equal(db.prepare("SELECT display_name n FROM contacts WHERE id = ?").get(owner(db, "+36301234567@wa")).n, "Anna Kovacs");
    assert.equal(identity.applyNames([{ handle_norm: "unknown@wa", displayName: "x" }]), 0);
});

test("group messages carry the sender's name (contact name, else the formatted number)", () => {
    const { db, repo, identity, read } = setup();
    const g = "group:1@g.us";
    repo.upsertMessages([msg(1, g, { meta: { isGroup: true, sender: "+36301234567@wa" } }), msg(2, g, { meta: { isGroup: true, sender: "+36309999999@wa" } }), msg(3, g, { isFromMe: true })]);
    identity.importContacts([toImport({ contactId: "ab1", displayName: "Anna Kovacs", phones: ["+36 30 123 4567"], emails: [] }, "HU").person]);
    const items = read.getThread(owner(db, g), { limit: 10 }).items;
    const byId = Object.fromEntries(items.map((m) => [m.text, m]));
    assert.equal(byId.t1.senderName, "Anna Kovacs");
    assert.equal(byId.t2.senderName, "+36 30 999 9999 (WhatsApp)");
    assert.equal(byId.t3.senderName, undefined);
});

test("toNormalized still works without session names (regression)", () => {
    assert.ok(toNormalized({ Z_PK: 1, ZTEXT: "hi", ZMESSAGEDATE: 1, ZISFROMME: 0, ZSESSIONJID: "36301234567@s.whatsapp.net", ZMESSAGETYPE: 0 }, "HU").message);
});
