import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NUDGE } from "../src/send/drivers.js";
import { createUploads, cleanName } from "../src/send/uploads.js";
import { classify, createAppleScriptDrivers, createFakeDrivers, scriptArgs, SCRIPTS, SendError } from "../src/send/drivers.js";
import { createHandoff } from "../src/handoff/service.js";
import { createSender } from "../src/send/service.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { memoryLogger, request, startServer } from "./helpers.js";

const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);
const msg = (n, handle, extra = {}) => ({ channel: "imessage", account: "", providerMessageKey: `m${n}`, threadKey: "t", handle_norm: handle, isFromMe: false, tsMs: NOW - n * 1000, text: `t${n}`, attachments: [], ...extra });
const CID = (n) => `client-id-${String(n).padStart(4, "0")}`;

function setup({ drivers, enabled = true, clock, confirmers, nudges, confirmMs = 3000, withUploads = false } = {}) {
    const home = mkdtempSync(path.join(os.tmpdir(), "rc-send-"));
    const { db } = openDb(home);
    const repo = createRepo(db, { now: () => NOW });
    repo.upsertMessages([msg(1, "+36301234567"), msg(2, "anna@example.com", { channel: "email" }), msg(3, "+36301234567@wa", { channel: "whatsapp" }), msg(4, "group:1@g.us", { channel: "whatsapp" })]);
    const handoffs = createHandoff({ db, now: () => NOW });
    const sent = [];
    const fake = Object.fromEntries(["imessage", "email", "whatsapp"].map((c) => [c, async (m) => { sent.push({ channel: c, ...m }); }]));
    const { logger, lines } = memoryLogger();
    const sentHooks = [];
    const uploads = withUploads ? createUploads({ home, now: clock ?? (() => NOW) }) : undefined;
    const sender = createSender({ db, handoffs, drivers: drivers ?? fake, uploads, confirmers, nudges, sleep: async () => {}, confirmMs, enabled, now: clock ?? (() => NOW), onSent: (c) => sentHooks.push(c), logger });
    const id = (h) => db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = ?").get(h).c;
    return { home, db, handoffs, sender, uploads, sent, sentHooks, lines, id };
}

test("a message goes to the contact's own handle on the chosen channel, and is audited without content", async () => {
    const s = setup();
    const r = await s.sender.send({ contactId: s.id("+36301234567"), channel: "imessage", text: "See you at 6", clientId: CID(1) });
    assert.equal(r.status, "sent");
    assert.deepEqual(s.sent, [{ channel: "imessage", handle: "+36301234567", text: "See you at 6", subject: undefined, attachments: [] }]);
    assert.deepEqual(s.sentHooks, ["imessage"]);
    const row = s.db.prepare("SELECT * FROM sends").get();
    assert.deepEqual([row.status, row.channel, row.handle_kind, row.text_length, row.error_code], ["sent", "imessage", "phone", 12, null]);
    assert.doesNotMatch(JSON.stringify(row), /See you|301234567/);
    assert.doesNotMatch(s.lines.join("\n"), /See you|301234567|example\.com/);
    await s.sender.send({ contactId: s.id("anna@example.com"), channel: "email", subject: "Hello", text: "Body", clientId: CID(2) });
    assert.deepEqual(s.sent.at(-1), { channel: "email", handle: "anna@example.com", text: "Body", subject: "Hello", attachments: [] });
});

test("validation: recipient must be the contact's, text must be real, nothing is sent on a rejected request", async () => {
    const s = setup();
    const id = s.id("+36301234567");
    const bad = async (body, status, code) => assert.rejects(() => s.sender.send({ contactId: id, channel: "imessage", text: "hi", clientId: CID(9), ...body }), (e) => e.status === status && e.code === code, JSON.stringify(body));
    await bad({ text: "   " }, 400, "text_empty");
    await bad({ text: 5 }, 400, "invalid_request");
    await bad({ text: "x".repeat(4001) }, 413, "text_too_long");
    await bad({ clientId: "x" }, 400, "invalid_request");
    await bad({ clientId: undefined }, 400, "invalid_request");
    await bad({ channel: "fax" }, 400, "invalid_request");
    await bad({ handle: "+999" }, 422, "handle_not_owned");
    await bad({ subject: "x".repeat(301) }, 400, "invalid_request");
    await bad({ contactId: "nope" }, 404, "contact_not_found");
    await bad({ channel: "email" }, 422, "no_handle_for_channel");
    assert.equal(s.sent.length, 0);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM sends").get().n, 0, "rejected requests leave no audit row");
});

test("a group chat can never be a recipient", async () => {
    const s = setup();
    const group = s.id("group:1@g.us");
    await assert.rejects(() => s.sender.send({ contactId: group, channel: "whatsapp", text: "hi", clientId: CID(3) }), (e) => e.status === 422 && e.code === "no_handle_for_channel");
    assert.equal(s.sent.length, 0);
});

test("the same clientId never sends twice; a failed or unknown attempt is not silently repeated", async () => {
    let calls = 0;
    let mode = "ok";
    const driver = async () => { calls++; if (mode === "fail") throw new SendError("send_failed", "no"); if (mode === "unknown") throw new SendError("send_timeout", "maybe", { unknownOutcome: true }); };
    const s = setup({ drivers: { imessage: driver, email: driver, whatsapp: driver } });
    const id = s.id("+36301234567");
    const body = (n) => ({ contactId: id, channel: "imessage", text: "hi", clientId: CID(n) });
    await s.sender.send(body(1));
    const again = await s.sender.send(body(1));
    assert.equal(again.replayed, true);
    assert.equal(calls, 1);
    mode = "fail";
    await assert.rejects(() => s.sender.send(body(2)), (e) => e.code === "send_failed");
    await assert.rejects(() => s.sender.send(body(2)), (e) => e.status === 409 && e.code === "already_attempted" && e.details.status === "failed");
    mode = "unknown";
    await assert.rejects(() => s.sender.send(body(3)), (e) => e.status === 504 && e.code === "send_timeout");
    await assert.rejects(() => s.sender.send(body(3)), (e) => e.code === "already_attempted" && /may already have been sent/.test(e.message));
    assert.equal(calls, 3);
    assert.deepEqual(s.db.prepare("SELECT status FROM sends ORDER BY ts_ms, rowid").all().map((r) => r.status), ["sent", "failed", "unknown"]);
});

test("one at a time, and at most 10 a minute", async () => {
    let release;
    const slow = () => new Promise((r) => { release = r; });
    const s = setup({ drivers: { imessage: slow, email: slow, whatsapp: slow } });
    const id = s.id("+36301234567");
    const first = s.sender.send({ contactId: id, channel: "imessage", text: "a", clientId: CID(1) });
    await assert.rejects(() => s.sender.send({ contactId: id, channel: "imessage", text: "b", clientId: CID(2) }), (e) => e.status === 429 && e.retryable);
    await assert.rejects(() => s.sender.send({ contactId: id, channel: "imessage", text: "a", clientId: CID(1) }), (e) => e.status === 409 && e.code === "send_in_progress");
    release();
    await first;
    const s2 = setup();
    const id2 = s2.id("+36301234567");
    for (let i = 0; i < 10; i++) await s2.sender.send({ contactId: id2, channel: "imessage", text: `m${i}`, clientId: CID(100 + i) });
    await assert.rejects(() => s2.sender.send({ contactId: id2, channel: "imessage", text: "11th", clientId: CID(200) }), (e) => e.status === 429 && e.code === "send_rate_limited");
    assert.equal(s2.sent.length, 10);
    let t = NOW;
    const s3 = setup({ clock: () => t });
    for (let i = 0; i < 10; i++) await s3.sender.send({ contactId: s3.id("+36301234567"), channel: "imessage", text: "x", clientId: CID(300 + i) });
    t += 61_000;
    await s3.sender.send({ contactId: s3.id("+36301234567"), channel: "imessage", text: "later", clientId: CID(400) });
    assert.equal(s3.sent.length, 11, "the window slides");
});

test("sending can be turned off: capability says so and nothing is sent", async () => {
    const s = setup({ enabled: false });
    assert.equal(s.sender.capability("imessage").available, false);
    assert.match(s.sender.capability("imessage").reason, /turned off/);
    await assert.rejects(() => s.sender.send({ contactId: s.id("+36301234567"), channel: "imessage", text: "hi", clientId: CID(1) }), (e) => e.status === 403 && e.code === "sending_disabled");
    assert.equal(setup().sender.capability("whatsapp").available, true);
});

test("AppleScript drivers: text and recipient travel as arguments, never inside the script", () => {
    const hostile = 'x" & (do shell script "touch /tmp/pwned") & "';
    assert.deepEqual(scriptArgs.imessage({ handle: "+36301234567", text: hostile }), ["+36301234567", hostile]);
    assert.deepEqual(scriptArgs.email({ handle: "a@b.co", subject: 'S"', text: hostile }), ["a@b.co", 'S"', hostile]);
    const [url] = scriptArgs.whatsapp({ handle: "+36301234567", text: "a b&c\nd" });
    assert.equal(url, "whatsapp://send?phone=36301234567&text=a%20b%26c%0Ad");
    for (const lines of Object.values(SCRIPTS)) {
        const src = lines.join("\n");
        assert.match(src, /on run argv/);
        assert.doesNotMatch(src, /touch|pwned|shell script/);
    }
    assert.match(SCRIPTS.imessage.join("\n"), /service type = SMS/, "falls back to SMS when the person is not on iMessage");
    assert.match(SCRIPTS.whatsapp.join("\n"), /did not come to the front/, "never presses Return unless WhatsApp is in front");
});

test("AppleScript drivers run osascript with the lines and the arguments, and classify its errors", async () => {
    const calls = [];
    const ok = createAppleScriptDrivers({ run: async (lines, args) => { calls.push({ lines, args }); return {}; } });
    await ok.imessage({ handle: "+36301234567", text: "hi" });
    assert.deepEqual(calls[0].args, ["+36301234567", "hi"]);
    assert.ok(calls[0].lines.length > 5);
    const failing = (stderr, timedOut = false) => createAppleScriptDrivers({ run: async () => ({ error: new Error("x"), stderr, timedOut }) });
    const cases = [
        ["imessage", "execution error: Not authorized to send Apple events to Messages. (-1743)", "automation_denied"],
        ["whatsapp", "System Events got an error: osascript is not allowed to send keystrokes. (1002)", "accessibility_denied"],
        ["whatsapp", "execution error: WhatsApp did not come to the front (9001)", "whatsapp_not_ready"],
        ["imessage", "execution error: Messages got an error: Can’t get buddy \"+1\" of service. (-1728)", "recipient_not_found"],
        ["email", "execution error: Application isn’t running. (-600)", "app_not_running"],
        ["email", "something else", "send_failed"],
    ];
    for (const [channel, stderr, code] of cases) await assert.rejects(() => failing(stderr)[channel]({ handle: "h", text: "t" }), (e) => e.code === code, code);
    await assert.rejects(() => failing("", true).imessage({ handle: "h", text: "t" }), (e) => e.code === "send_timeout" && e.unknownOutcome === true);
    const denied = classify("(-1743)", "imessage");
    assert.equal(denied.recovery[0].deepLink, "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation");
    assert.match(classify("(1002)", "whatsapp").recovery[0].deepLink, /Privacy_Accessibility/);
});

test("HTTP: send, strict body, replay, error envelope with recovery steps, no content in logs", async (t) => {
    const s = setup({ drivers: { imessage: async () => {}, email: async () => { throw classify("(-1743)", "email"); }, whatsapp: async () => {} } });
    const { app, port, lines } = await startServer({ deps: { sender: s.sender } });
    t.after(() => app.close());
    const post = (body, p = "/api/send") => request(port, { method: "POST", path: p, headers: { host: `127.0.0.1:${port}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const ok = await post({ contactId: s.id("+36301234567"), channel: "imessage", text: "SECRET-TEXT", clientId: CID(1) });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.status, "sent");
    assert.equal(ok.headers["cache-control"], "no-store");
    assert.equal((await post({ contactId: s.id("+36301234567"), channel: "imessage", text: "SECRET-TEXT", clientId: CID(1) })).json.replayed, true);
    const extra = await post({ contactId: s.id("+36301234567"), channel: "imessage", text: "x", clientId: CID(2), nope: 1 });
    assert.equal(extra.status, 400);
    const denied = await post({ contactId: s.id("anna@example.com"), channel: "email", text: "SECRET-TEXT", clientId: CID(3) });
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error.code, "automation_denied");
    assert.equal(denied.json.error.details.recovery.length, 2);
    assert.doesNotMatch(lines.join("\n"), /SECRET-TEXT/);
    const noApp = await post({}, "/api/send/consent");
    assert.equal(noApp.status, 501);
    assert.equal(noApp.json.error.code, "consent_unavailable");
    assert.equal((await post({ kind: "contacts" }, "/api/consent")).json.error.code, "consent_unavailable");
    assert.equal((await post({ kind: "nope" }, "/api/consent")).status, 400);
});

test("WhatsApp: it is sent only once the message shows up in that chat; the wrong chat and a silent database are said out loud", async () => {
    const wa = (s) => s.id("+36301234567@wa");
    const status = (s) => s.db.prepare("SELECT status, error_code FROM sends").get();
    const polls = [];
    let confirmed = setup({ confirmers: { whatsapp: async (m) => { polls.push(m); return polls.length < 3 ? "none" : "chat"; } } });
    const ok = await confirmed.sender.send({ contactId: wa(confirmed), channel: "whatsapp", text: "hi", clientId: CID(1) });
    assert.deepEqual([ok.status, ok.confirmed, polls.length], ["sent", true, 3]);
    assert.equal(polls[0].handle, "+36301234567@wa");
    assert.deepEqual([...new Set(polls[0].chatIds)], ["36301234567"], "the ids this person's chat may carry");
    assert.equal(polls[0].text, "hi");
    confirmed.db.prepare("INSERT INTO handles (handle_norm, kind, first_seen_ms, last_seen_ms) VALUES ('other:4323000111222@lid','other',1,1)").run();
    confirmed.db.prepare("INSERT INTO contact_handles (handle_norm, contact_id, link_origin, linked_ms) VALUES ('other:4323000111222@lid', ?, 'manual_merge', 1)").run(wa(confirmed));
    polls.length = 0;
    await confirmed.sender.send({ contactId: wa(confirmed), channel: "whatsapp", text: "again", clientId: CID(9) });
    assert.ok(polls[0].chatIds.includes("4323000111222"), "a lid id of the contact is offered to the look-up");

    const wrong = setup({ confirmers: { whatsapp: async () => "other" } });
    await assert.rejects(() => wrong.sender.send({ contactId: wa(wrong), channel: "whatsapp", text: "hi", clientId: CID(2) }), (e) => e.status === 502 && e.code === "whatsapp_wrong_chat");
    assert.deepEqual(status(wrong), { status: "failed", error_code: "whatsapp_wrong_chat" });

    let n = 0;
    const silent = setup({ confirmers: { whatsapp: async () => { n++; return "none"; } } });
    await assert.rejects(() => silent.sender.send({ contactId: wa(silent), channel: "whatsapp", text: "hi", clientId: CID(3) }), (e) => e.status === 504 && e.code === "send_unconfirmed");
    assert.deepEqual(status(silent), { status: "unknown", error_code: "unconfirmed" });
    assert.equal(n, 4, "looks now and once a second for 3 s");
    await assert.rejects(() => silent.sender.send({ contactId: wa(silent), channel: "whatsapp", text: "hi", clientId: CID(3) }), (e) => e.code === "already_attempted");

    const blind = setup({ confirmers: { whatsapp: async () => "unavailable" } });
    const r = await blind.sender.send({ contactId: wa(blind), channel: "whatsapp", text: "hi", clientId: CID(4) });
    assert.deepEqual([r.status, r.confirmed], ["sent", false]);
    assert.match(r.note, /could not be confirmed/);

    const mail = setup({ confirmers: { whatsapp: async () => { throw new Error("must not be asked for other channels"); } } });
    assert.equal((await mail.sender.send({ contactId: mail.id("+36301234567"), channel: "imessage", text: "hi", clientId: CID(5) })).confirmed, undefined);
});

test("WhatsApp: no database to look in means 'sent' is never claimed; a lost Return is pressed once more after 5 s", async () => {
    const none = setup();
    const r = await none.sender.send({ contactId: none.id("+36301234567@wa"), channel: "whatsapp", text: "hi", clientId: CID(1) });
    assert.deepEqual([r.status, r.confirmed], ["sent", false]);
    assert.match(r.note, /could not be confirmed/);
    assert.equal((await none.sender.send({ contactId: none.id("+36301234567"), channel: "imessage", text: "hi", clientId: CID(2) })).note, "Sent through Messages.");

    let nudged = 0;
    let polls = 0;
    const s = setup({ confirmMs: 15_000, nudges: { whatsapp: async () => { nudged++; } }, confirmers: { whatsapp: async () => (++polls > 7 ? "chat" : "none") } });
    const ok = await s.sender.send({ contactId: s.id("+36301234567@wa"), channel: "whatsapp", text: "hi", clientId: CID(3) });
    assert.deepEqual([ok.confirmed, nudged], [true, 1]);
    const early = setup({ confirmMs: 15_000, nudges: { whatsapp: async () => { nudged++; } }, confirmers: { whatsapp: async () => "chat" } });
    await early.sender.send({ contactId: early.id("+36301234567@wa"), channel: "whatsapp", text: "hi", clientId: CID(4) });
    assert.equal(nudged, 1, "no second Return when the message is already there");
});

test("the WhatsApp script checks the focus again right before it presses Return", () => {
    const src = SCRIPTS.whatsapp.join("\n");
    assert.ok(src.indexOf("lost the focus") < src.indexOf("key code 36"), "Return is the key code, pressed only after the focus check");
    assert.doesNotMatch(src, /keystroke return/);
    assert.equal(classify("execution error: WhatsApp lost the focus (9002)", "whatsapp").code, "whatsapp_not_ready");
});

test("the fake driver (tests only) records instead of sending", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "rc-fake-"));
    await createFakeDrivers(home).email({ handle: "a@b.co", subject: "S", text: "T" });
    assert.deepEqual(JSON.parse(readFileSync(path.join(home, "sent-fake.jsonl"), "utf8")), { channel: "email", handle: "a@b.co", subject: "S", text: "T" });
});

test("attachments: uploaded by id, sent on iMessage and Mail only, kept until sent, never reachable by path", async () => {
    const s = setup({ withUploads: true });
    assert.equal(cleanName("../../etc/passwd"), "passwd");
    assert.equal(cleanName("..\\x\\a\u0000b.png"), "ab.png");
    assert.equal(cleanName(".hidden"), "hidden");
    assert.equal(cleanName(""), "file");
    const a = s.uploads.add("../photo.jpg", Buffer.from("JPEGDATA"));
    const b = s.uploads.add("doc.pdf", Buffer.from("PDF"));
    assert.deepEqual([a.name, a.size], ["photo.jpg", 8]);
    assert.equal(statSync(path.join(s.home, "outbox")).mode & 0o077, 0, "owner only");
    const anna = s.id("+36301234567");

    // text may be empty when there is a file
    const r = await s.sender.send({ contactId: anna, channel: "imessage", text: "", attachmentIds: [a.id, b.id], clientId: CID(1) });
    assert.equal(r.status, "sent");
    assert.deepEqual(s.sent[0].attachments.map((x) => [x.name, x.size]), [["photo.jpg", 8], ["doc.pdf", 3]]);
    assert.ok(path.resolve(s.sent[0].attachments[0].path).startsWith(path.join(s.home, "outbox")));
    assert.equal(s.uploads.count(), 0, "released after a successful send");
    assert.equal(s.db.prepare("SELECT text_length n FROM sends").get().n, 0);

    // not on WhatsApp; unknown ids, bad lists and size limits are refused before anything is sent
    const c = s.uploads.add("c.txt", Buffer.from("x"));
    const code = async (body) => { try { await s.sender.send({ contactId: anna, text: "hi", ...body }); } catch (e) { return [e.status, e.code]; } return null; };
    assert.deepEqual(await code({ contactId: s.id("+36301234567@wa"), channel: "whatsapp", attachmentIds: [c.id], clientId: CID(2) }), [422, "attachments_not_supported"]);
    assert.deepEqual(await code({ channel: "imessage", attachmentIds: ["u_nope"], clientId: CID(3) }), [422, "attachment_not_found"]);
    assert.deepEqual(await code({ channel: "imessage", attachmentIds: [c.id, c.id], clientId: CID(4) }), [400, "invalid_request"]);
    assert.deepEqual(await code({ channel: "imessage", attachmentIds: "x", clientId: CID(5) }), [400, "invalid_request"]);
    assert.deepEqual(await code({ channel: "imessage", attachmentIds: Array.from({ length: 6 }, (_, i) => `u_${i}`), clientId: CID(6) }), [413, "too_many_attachments"]);
    assert.deepEqual(await code({ channel: "imessage", text: "  ", attachmentIds: [], clientId: CID(7) }), [400, "text_empty"]);
    assert.equal(s.sent.length, 1);
    assert.equal(s.uploads.count(), 1, "a refused send keeps the file");
    assert.throws(() => s.uploads.add("big", Buffer.alloc(20 * 1024 * 1024 + 1)), { code: "file_too_large" });
    assert.throws(() => s.uploads.add("empty", Buffer.alloc(0)), { code: "invalid_request" });
    const big = [1, 2].map((i) => s.uploads.add(`b${i}`, Buffer.alloc(13 * 1024 * 1024)));
    assert.throws(() => s.uploads.resolve(big.map((x) => x.id)), { code: "attachments_too_large" });
});

test("attachments: a failed send keeps the files for the retry; files expire after an hour and a restart clears them", async () => {
    let t = NOW;
    const fail = async () => { throw classify("(-1743)", "email"); };
    const s = setup({ withUploads: true, clock: () => t, drivers: { imessage: fail, email: fail, whatsapp: fail } });
    const a = s.uploads.add("a.txt", Buffer.from("x"));
    await assert.rejects(() => s.sender.send({ contactId: s.id("anna@example.com"), channel: "email", text: "hi", attachmentIds: [a.id], clientId: CID(1) }), { code: "automation_denied" });
    assert.equal(s.uploads.count(), 1);
    t += 61 * 60_000;
    await assert.rejects(() => s.sender.send({ contactId: s.id("anna@example.com"), channel: "email", text: "hi", attachmentIds: [a.id], clientId: CID(2) }), { code: "attachment_not_found" });
    const left = s.uploads.add("b.txt", Buffer.from("y"));
    assert.ok(existsSync(path.join(s.home, "outbox", left.id)));
    createUploads({ home: s.home });
    assert.equal(existsSync(path.join(s.home, "outbox")), false, "whatever a crash left behind is removed on start");
});

test("attachments: script arguments carry the file paths; a plain failure with files may be a partial send", async () => {
    const att = [{ path: "/o/u_1/a b.png", name: "a b.png", size: 1 }];
    assert.deepEqual(scriptArgs.imessage({ handle: "+3630", text: "hi", attachments: att }), ["+3630", "hi", "/o/u_1/a b.png"]);
    assert.deepEqual(scriptArgs.email({ handle: "a@b.co", subject: "S", text: "hi", attachments: att }), ["a@b.co", "S", "hi", "/o/u_1/a b.png"]);
    assert.deepEqual(scriptArgs.imessage({ handle: "+3630", text: "hi" }), ["+3630", "hi"]);
    for (const ch of ["imessage", "email"]) assert.doesNotMatch(SCRIPTS[ch].join("\n"), /\/o\/|u_1/);
    const drivers = createAppleScriptDrivers({ run: async () => ({ error: new Error("x"), stderr: "execution error: Messages got an error: something odd (-10000)" }) });
    await assert.rejects(() => drivers.imessage({ handle: "+3630", text: "hi", attachments: att }), (e) => e.code === "send_failed_partial" && e.unknownOutcome === true);
    await assert.rejects(() => drivers.imessage({ handle: "+3630", text: "hi" }), (e) => e.code === "send_failed" && !e.unknownOutcome);
});

test("HTTP uploads: raw bytes in, an id out; strict query; delete; the message names the id", async (t) => {
    const s = setup({ withUploads: true });
    const { app, port } = await startServer({ deps: { sender: s.sender, uploads: s.uploads } });
    t.after(() => app.close());
    const h = { host: `127.0.0.1:${port}` };
    const up = (q, body, type = "application/octet-stream") => request(port, { method: "POST", path: `/api/uploads${q}`, headers: { ...h, "content-type": type, "content-length": Buffer.byteLength(body ?? "") }, body });
    const ok = await up("?name=hello%20world.txt", "hello");
    assert.deepEqual([ok.status, ok.json.name, ok.json.size, ok.headers["cache-control"]], [201, "hello world.txt", 5, "no-store"]);
    assert.equal((await up("?name=a&x=1", "hello")).status, 400);
    assert.equal((await up("?name=a", "{}", "application/json")).status, 415, "JSON is not a file");
    assert.equal((await up("?name=a", "", "application/octet-stream")).status, 400, "empty");
    const sent = await request(port, { method: "POST", path: "/api/send", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ contactId: s.id("anna@example.com"), channel: "email", subject: "S", text: "see file", attachmentIds: [ok.json.id], clientId: CID(1) }) });
    assert.equal(sent.status, 200);
    assert.equal(s.sent[0].attachments[0].name, "hello world.txt");
    const two = await up("?name=b.txt", "b");
    assert.equal((await request(port, { method: "DELETE", path: `/api/uploads/${two.json.id}`, headers: h })).json.removed, true);
    assert.equal(s.uploads.count(), 0);
    const foreign = await request(port, { method: "POST", path: "/api/uploads?name=a", headers: { ...h, origin: "http://evil.example", "content-type": "application/octet-stream" }, body: "x" });
    assert.equal(foreign.status, 403);
});

test("Mail and WhatsApp give the focus back to the app you were in, and a refusal to do so never fails the send", () => {
    for (const [name, lines] of [["email", SCRIPTS.email], ["whatsapp", SCRIPTS.whatsapp], ["nudge", NUDGE]]) {
        const src = lines.join("\n");
        assert.match(src, /bundle identifier of first application process whose frontmost/, `${name} remembers the front app`);
        assert.match(src, /tell application id frontId to activate/, `${name} restores it`);
        assert.ok(src.indexOf("bundle identifier") < src.indexOf("activate"), name);
        // both lines sit inside try ... end try
        for (const needle of ["bundle identifier", "activate"]) {
            const i = src.indexOf(needle);
            assert.ok(src.lastIndexOf("try", i) > src.lastIndexOf("end try", i), `${name}: ${needle} is inside try`);
        }
    }
    assert.doesNotMatch(SCRIPTS.imessage.join("\n"), /frontId/, "Messages sends in the background, nothing to restore");
});
