import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import { buildUrl, createHandoff, handleKindsFor, MAX_TEXT } from "../src/handoff/service.js";
import { createIdentity } from "../src/identity/service.js";
import { createReadService } from "../src/read/service.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { memoryLogger, request, startServer } from "./helpers.js";

const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);
const msg = (n, handle, extra = {}) => ({ channel: "imessage", account: "", providerMessageKey: `m${n}`, threadKey: "t", handle_norm: handle, isFromMe: false, tsMs: NOW - n * 1000, text: `t${n}`, attachments: [], ...extra });

function setup() {
    const home = mkdtempSync(path.join(os.tmpdir(), "rc-ho-"));
    const { db } = openDb(home);
    const repo = createRepo(db, { now: () => NOW });
    const identity = createIdentity({ db, repo });
    const handoffs = createHandoff({ db, now: () => NOW });
    return { db, repo, identity, handoffs };
}
const owner = (db, h) => db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = ?").get(h).c;

// one person, three handles linked through the address book
function anna(s) {
    s.repo.upsertMessages([msg(1, "+36301234567"), msg(2, "+36301234567@wa", { channel: "whatsapp", providerMessageKey: "w1" }), msg(3, "anna@example.com", { channel: "email", providerMessageKey: "e1" })]);
    s.identity.importContacts([{ externalId: "C1", displayName: "Anna K", handles: [{ handle_norm: "+36301234567", kind: "phone" }, { handle_norm: "+36301234567@wa", kind: "whatsapp" }, { handle_norm: "anna@example.com", kind: "email" }] }]);
    return owner(s.db, "+36301234567");
}

const NASTY = ["Hello", "line one\nline two\r\nline three", "😀 émoji ünïcode 日本語", "a&b=c#d%e", `quotes "double" and 'single'`, "100% sure + more?", "path/with/slashes and \\ backslash", "   leading and trailing   ", "<script>alert(1)</script>", "tab\tseparated", "https://example.com/?a=1&b=2", "= & ? # / + ; : @ $ , !"];

function decode(channel, url) {
    if (channel === "imessage") {
        const m = /^sms:([^&]+)&body=(.*)$/s.exec(url);
        return { to: decodeURIComponent(m[1]), text: decodeURIComponent(m[2]) };
    }
    const u = new URL(url);
    if (channel === "email") return { to: decodeURIComponent(u.pathname), text: u.searchParams.get("body"), subject: u.searchParams.get("subject") };
    return { to: u.pathname.slice(1), text: u.searchParams.get("text") };
}

test("every channel's link decodes back to the exact text, whatever characters it holds", () => {
    for (const text of NASTY) {
        assert.equal(decode("imessage", buildUrl("imessage", "+36301234567", text)).text, text, `imessage ${JSON.stringify(text)}`);
        assert.equal(decode("whatsapp", buildUrl("whatsapp", "+36301234567@wa", text)).text, text, `whatsapp ${JSON.stringify(text)}`);
        const mail = decode("email", buildUrl("email", "anna+tag@example.com", text, "Re: a&b"));
        assert.deepEqual([mail.to, mail.text, mail.subject], ["anna+tag@example.com", text, "Re: a&b"]);
    }
    assert.equal(decode("whatsapp", buildUrl("whatsapp", "+36301234567@wa", "x")).to, "36301234567", "wa.me takes digits only");
    assert.equal(buildUrl("imessage", "+36301234567", ""), "sms:%2B36301234567", "no body when there is no text");
    assert.equal(buildUrl("email", "a@example.com", "hi"), "mailto:a%40example.com?body=hi", "no subject parameter when there is none");
    assert.equal(buildUrl("email", "a@example.com", ""), "mailto:a%40example.com");
    assert.throws(() => buildUrl("fax", "x", "y"));
});

test("channels: which handles can receive on which channel", () => {
    const s = setup();
    const id = anna(s);
    const ch = s.handoffs.channelsFor(id);
    assert.deepEqual(ch.map((c) => c.channel), ["imessage", "email", "whatsapp"]);
    assert.deepEqual(ch[0].handles.map((h) => h.value), ["+36301234567", "anna@example.com"], "iMessage reaches phones and addresses");
    assert.deepEqual(ch[1].handles.map((h) => h.value), ["anna@example.com"]);
    assert.deepEqual(ch[2].handles.map((h) => [h.value, h.label]), [["+36301234567@wa", "+36 30 123 4567 (WhatsApp)"]]);
    assert.deepEqual(handleKindsFor.whatsapp, ["whatsapp"]);
    // a group chat or an opaque id has no way to receive a reply
    s.repo.upsertMessages([msg(9, "group:chat1", { providerMessageKey: "g1" }), msg(10, "other:thing", { providerMessageKey: "o1" })]);
    assert.deepEqual(s.handoffs.channelsFor(owner(s.db, "group:chat1")), []);
    assert.deepEqual(s.handoffs.channelsFor(owner(s.db, "other:thing")), []);
});

test("the default handle is the one used in the most recent message on that channel", () => {
    const s = setup();
    s.repo.upsertMessages([msg(1, "+36301234567"), msg(5, "+36309999999", { providerMessageKey: "n", tsMs: NOW - 100 })]);
    const a = owner(s.db, "+36301234567");
    const b = owner(s.db, "+36309999999");
    s.identity.merge(b, a);
    const handles = s.handoffs.channelsFor(a)[0].handles;
    assert.deepEqual(handles.map((h) => [h.value, h.default]), [["+36301234567", false], ["+36309999999", true]], "the number written most recently");
    assert.equal(s.handoffs.handoff({ contactId: a, channel: "imessage", text: "hi" }).handleLabel, "+36 30 999 9999");
    assert.equal(s.handoffs.handoff({ contactId: a, channel: "imessage", handle: "+36301234567", text: "hi" }).handleLabel, "+36 30 123 4567", "an explicit choice wins");
});

test("handoff builds the link, picks open_url, and answers with the sentence the UI shows", () => {
    const s = setup();
    const id = anna(s);
    const wa = s.handoffs.handoff({ contactId: id, channel: "whatsapp", text: "See you at 6" });
    assert.deepEqual(wa, { handoffId: wa.handoffId, action: "open_url", url: "https://wa.me/36301234567?text=See%20you%20at%206", channel: "whatsapp", handleLabel: "+36 30 123 4567 (WhatsApp)", note: "Opens WhatsApp with your text. Reply Core does not send it." });
    assert.match(wa.handoffId, /^h_/);
    const mail = s.handoffs.handoff({ contactId: id, channel: "email", text: "Body", subject: "Hi there" });
    assert.equal(mail.url, "mailto:anna%40example.com?subject=Hi%20there&body=Body");
    assert.equal(mail.note, "Opens Mail with your text. Reply Core does not send it.");
    assert.equal(s.handoffs.handoff({ contactId: id, channel: "imessage", text: "yo" }).url, "sms:%2B36301234567&body=yo");
});

test("long text becomes copy_and_open with a body-less link", () => {
    const s = setup();
    const id = anna(s);
    const edge = s.handoffs.handoff({ contactId: id, channel: "email", text: "a".repeat(MAX_TEXT) });
    assert.equal(edge.action, "open_url", "1,500 plain characters still fit a link");
    const over = s.handoffs.handoff({ contactId: id, channel: "email", text: "a".repeat(MAX_TEXT + 1) });
    assert.deepEqual([over.action, over.url], ["copy_and_open", "mailto:anna%40example.com"]);
    const emoji = s.handoffs.handoff({ contactId: id, channel: "whatsapp", text: "😀".repeat(400) });
    assert.deepEqual([emoji.action, emoji.url], ["copy_and_open", "https://wa.me/36301234567"], "encoded length counts, not characters");
    assert.equal(s.handoffs.handoff({ contactId: id, channel: "imessage", text: "x".repeat(10_000) }).action, "copy_and_open");
});

test("every error is specific", () => {
    const s = setup();
    const id = anna(s);
    s.repo.upsertMessages([msg(20, "+19999999999", { providerMessageKey: "other" })]);
    const other = owner(s.db, "+19999999999");
    const err = (input) => { try { s.handoffs.handoff(input); } catch (e) { return [e.status, e.code, e.details]; } return null; };
    assert.deepEqual(err({ contactId: "nope", channel: "email", text: "x" }), [404, "contact_not_found", undefined]);
    assert.deepEqual(err({ contactId: id, channel: "fax", text: "x" }), [400, "invalid_request", undefined]);
    assert.deepEqual(err({ contactId: id, channel: "email", text: 5 }), [400, "invalid_request", undefined]);
    assert.deepEqual(err({ contactId: id, channel: "email", text: "   \n " }), [400, "text_empty", undefined]);
    assert.deepEqual(err({ contactId: id, channel: "email", text: "x".repeat(10_001) }), [413, "text_too_long", undefined]);
    assert.deepEqual(err({ contactId: id, channel: "email", text: "x", subject: "s".repeat(301) }), [400, "invalid_request", undefined]);
    assert.deepEqual(err({ contactId: other, channel: "whatsapp", text: "x" }), [422, "no_handle_for_channel", { availableChannels: ["imessage"] }]);
    assert.deepEqual(err({ contactId: id, channel: "email", handle: "+36301234567", text: "x" }), [422, "handle_not_owned", undefined], "right contact, wrong kind of address");
    assert.deepEqual(err({ contactId: id, channel: "imessage", handle: "+19999999999", text: "x" }), [422, "handle_not_owned", undefined], "another contact's number is refused");
    // a contact merged away is gone, with a hint
    s.identity.merge(other, id);
    assert.deepEqual(err({ contactId: other, channel: "imessage", text: "x" }), [404, "contact_not_found", { mergedInto: id }]);
});

test("the audit row holds the length only, never the text or the address", () => {
    const s = setup();
    const id = anna(s);
    s.handoffs.handoff({ contactId: id, channel: "email", text: "top secret words", subject: "secret subject" });
    const rows = s.db.prepare("SELECT * FROM handoffs").all();
    assert.deepEqual(rows.map((r) => [r.contact_id, r.channel, r.handle_kind, r.text_length, r.ts_ms]), [[id, "email", "email", 16, NOW]]);
    const dump = JSON.stringify(rows);
    for (const secret of ["secret", "anna@example.com", "36301234567"]) assert.ok(!dump.includes(secret), secret);
});

test("HTTP: success, strict body, logs without text or address", async (t) => {
    const s = setup();
    const id = anna(s);
    const { logger, lines } = memoryLogger();
    void logger;
    const { app, port, lines: srvLines } = await startServer({ deps: { handoffs: s.handoffs } });
    t.after(() => app.close());
    const post = (body) => request(port, { method: "POST", path: "/api/handoff", headers: { host: `127.0.0.1:${port}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const ok = await post({ contactId: id, channel: "whatsapp", text: "private message text" });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.action, "open_url");
    assert.equal((await post({ contactId: id, channel: "whatsapp", text: "x", bogus: 1 })).status, 400);
    assert.equal((await post({ channel: "whatsapp", text: "x" })).json.error.code, "invalid_request");
    assert.equal((await post({ contactId: id, channel: "whatsapp", text: "x", handle: 5 })).status, 400);
    const empty = await request(port, { method: "POST", path: "/api/handoff", headers: { host: `127.0.0.1:${port}` } });
    assert.equal(empty.status, 400);
    const bad = await post({ contactId: id, channel: "fax", text: "x" });
    assert.deepEqual([bad.status, bad.json.error.code], [400, "invalid_request"]);
    const tooMany = await post({ contactId: "nope", channel: "email", text: "x" });
    assert.equal(tooMany.status, 404);
    const log = [...lines, ...srvLines].join("");
    assert.ok(log.includes('"msg":"handoff"'));
    for (const secret of ["private message text", "36301234567", "anna@example.com"]) assert.ok(!log.includes(secret), `leaked ${secret}`);
    assert.match(log, /"textLength":20/);
});

test("the contact detail exposes replyChannels in the documented shape", () => {
    const s = setup();
    const id = anna(s);
    const read = createReadService({ db: s.db, replyChannels: (x) => s.handoffs.channelsFor(x) });
    const doc = JSON.parse(readFileSync(new URL("../schema/api-read.json", import.meta.url), "utf8"));
    const ajv = new Ajv({ strict: false });
    ajv.addSchema(doc);
    const c = read.getContact(id);
    const v = ajv.getSchema(`${doc.$id}#/definitions/Contact`);
    assert.ok(v(c), JSON.stringify(v.errors));
    assert.deepEqual(c.replyChannels.map((x) => x.channel), ["imessage", "email", "whatsapp"]);
    assert.ok(c.replyChannels.every((x) => x.handles.filter((h) => h.default).length === 1));
});
