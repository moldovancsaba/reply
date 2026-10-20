import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { classify, createAppleScriptDrivers, createFakeDrivers, scriptArgs, SCRIPTS, SendError } from "../src/send/drivers.js";
import { createHandoff } from "../src/handoff/service.js";
import { createSender } from "../src/send/service.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { memoryLogger, request, startServer } from "./helpers.js";

const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);
const msg = (n, handle, extra = {}) => ({ channel: "imessage", account: "", providerMessageKey: `m${n}`, threadKey: "t", handle_norm: handle, isFromMe: false, tsMs: NOW - n * 1000, text: `t${n}`, attachments: [], ...extra });
const CID = (n) => `client-id-${String(n).padStart(4, "0")}`;

function setup({ drivers, enabled = true, clock } = {}) {
    const home = mkdtempSync(path.join(os.tmpdir(), "rc-send-"));
    const { db } = openDb(home);
    const repo = createRepo(db, { now: () => NOW });
    repo.upsertMessages([msg(1, "+36301234567"), msg(2, "anna@example.com", { channel: "email" }), msg(3, "+36301234567@wa", { channel: "whatsapp" }), msg(4, "group:1@g.us", { channel: "whatsapp" })]);
    const handoffs = createHandoff({ db, now: () => NOW });
    const sent = [];
    const fake = Object.fromEntries(["imessage", "email", "whatsapp"].map((c) => [c, async (m) => { sent.push({ channel: c, ...m }); }]));
    const { logger, lines } = memoryLogger();
    const sentHooks = [];
    const sender = createSender({ db, handoffs, drivers: drivers ?? fake, enabled, now: clock ?? (() => NOW), onSent: (c) => sentHooks.push(c), logger });
    const id = (h) => db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = ?").get(h).c;
    return { home, db, handoffs, sender, sent, sentHooks, lines, id };
}

test("a message goes to the contact's own handle on the chosen channel, and is audited without content", async () => {
    const s = setup();
    const r = await s.sender.send({ contactId: s.id("+36301234567"), channel: "imessage", text: "See you at 6", clientId: CID(1) });
    assert.equal(r.status, "sent");
    assert.deepEqual(s.sent, [{ channel: "imessage", handle: "+36301234567", text: "See you at 6", subject: undefined }]);
    assert.deepEqual(s.sentHooks, ["imessage"]);
    const row = s.db.prepare("SELECT * FROM sends").get();
    assert.deepEqual([row.status, row.channel, row.handle_kind, row.text_length, row.error_code], ["sent", "imessage", "phone", 12, null]);
    assert.doesNotMatch(JSON.stringify(row), /See you|301234567/);
    assert.doesNotMatch(s.lines.join("\n"), /See you|301234567|example\.com/);
    await s.sender.send({ contactId: s.id("anna@example.com"), channel: "email", subject: "Hello", text: "Body", clientId: CID(2) });
    assert.deepEqual(s.sent.at(-1), { channel: "email", handle: "anna@example.com", text: "Body", subject: "Hello" });
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
});

test("the fake driver (tests only) records instead of sending", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "rc-fake-"));
    await createFakeDrivers(home).email({ handle: "a@b.co", subject: "S", text: "T" });
    assert.deepEqual(JSON.parse(readFileSync(path.join(home, "sent-fake.jsonl"), "utf8")), { channel: "email", handle: "a@b.co", subject: "S", text: "T" });
});
