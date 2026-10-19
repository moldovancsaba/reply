import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { EventEmitter } from "node:events";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { accountsCli, EXIT, readSecret } from "../src/cli/accounts.js";
import { createImapConnector, toNormalized } from "../src/connectors/imap.js";
import { createRunner } from "../src/connectors/runner.js";
import { addAccount, accountId, FILE, hasAccounts, loadAccounts, removeAccount, validate } from "../src/imap/accounts.js";
import { imapErrorCode } from "../src/imap/client.js";
import { createMemoryKeychain, createKeychain, SERVICE } from "../src/imap/keychain.js";
import { htmlToText } from "../src/imap/text.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { memoryLogger } from "./helpers.js";

const require = createRequire(import.meta.url);
const hoodiecrow = require("hoodiecrow-imap");
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "rc-imap-"));
const PASS = "s3cret-app-password";

const certDir = tmp();
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(certDir, "key.pem"), "-out", path.join(certDir, "cert.pem"), "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
const TLS = { key: readFileSync(path.join(certDir, "key.pem")), cert: readFileSync(path.join(certDir, "cert.pem")) };
const trust = { rejectUnauthorized: false }; // the test server's certificate is self-signed; the default (verify) is tested separately
test.after(() => rmSync(certDir, { recursive: true, force: true }));

const mail = ({ n, from = "Anna <anna@example.com>", to = "me@example.com", subject = `Hello ${n}`, body = `Body ${n}`, html, id = `<m${n}@example.com>`, minutes = n }) => [
    id ? `Message-ID: ${id}` : null, `From: ${from}`, `To: ${to}`, subject ? `Subject: ${subject}` : null, `Date: ${new Date(Date.UTC(2026, 9, 19, 7, minutes)).toUTCString()}`,
    html ? "Content-Type: text/html; charset=utf-8" : "Content-Type: text/plain; charset=utf-8", "", html ?? body, "",
].filter((l) => l !== null).join("\r\n");

// An IMAP server over implicit TLS (hoodiecrow behind a tls front) that also records every command it receives.
async function startServer({ inbox = [], sent = [], uidvalidity = 1, user = "me@example.com", pass = PASS } = {}) {
    const storage = { INBOX: { uidvalidity, messages: inbox.map((raw) => ({ raw })) }, "": { separator: "/", folders: { "[Gmail]": { flags: ["\\Noselect"], folders: { "Sent Mail": { "special-use": "\\Sent", uidvalidity, messages: sent.map((raw) => ({ raw })) } } } } } };
    const hood = hoodiecrow({ storage, plugins: ["SPECIAL-USE"], id: { name: "test" } });
    hood.server.users = { [user]: { password: pass } };
    hood.users = { [user]: { password: pass } };
    const commands = [];
    const front = tls.createServer(TLS, (sock) => {
        sock.on("data", (d) => { for (const line of d.toString().split("\r\n")) if (line) commands.push(line.replace(/^\S+\s+/, "")); });
        hood.server.emit("connection", sock);
    });
    await new Promise((r) => front.listen(0, "127.0.0.1", r));
    return { port: front.address().port, commands, close: () => new Promise((r) => { front.close(r); front.closeAllConnections?.(); }), hood };
}

function env({ server, keychain = createMemoryKeychain(), password = PASS, tlsOpts = trust, limit = 500, logger } = {}) {
    const home = tmp();
    const { db } = openDb(home);
    const repo = createRepo(db);
    const runner = createRunner({ db, repo, pageLimit: limit, logger, sleep: async () => {} });
    const account = { id: accountId("me@example.com", "localhost"), host: "localhost", port: server.port, user: "me@example.com", label: "Test", selfAddresses: ["me@example.com"], boxes: { inbox: "INBOX", sent: "[Gmail]/Sent Mail" } };
    addAccount(home, account);
    if (password) keychain.set(account.id, password);
    const connector = createImapConnector({ config: { home, defaultRegion: "HU" }, logger, keychain, tls: tlsOpts, timeouts: { connection: 3000, greeting: 3000, socket: 5000 } });
    return { home, db, repo, runner, connector, keychain, account };
}

const parsed = async (raw) => simpleParser(raw);
const ACCT = { account: { id: "me@example.com@imap.example.com", user: "me@example.com", selfAddresses: ["alias@example.com"], label: "Work" }, box: "INBOX", kind: "inbox", uid: 5 };

test("toNormalized: received, sent, html-only, missing ids, aliases, no counterpart, long text", async () => {
    const r = toNormalized(await parsed(mail({ n: 1 })), ACCT, "HU").message;
    assert.deepEqual([r.channel, r.account, r.providerMessageKey, r.handle_norm, r.isFromMe, r.subject, r.text, r.threadKey], ["email", ACCT.account.id, "<m1@example.com>", "anna@example.com", false, "Hello 1", "Body 1", "<m1@example.com>"]);
    assert.deepEqual(r.meta, { isSummary: false, recipients: ["me@example.com"], accountLabel: "Work" });
    const sent = toNormalized(await parsed(mail({ n: 2, from: "me@example.com", to: "Bela <bela@example.com>, c@example.com" })), { ...ACCT, kind: "sent" }, "HU").message;
    assert.deepEqual([sent.isFromMe, sent.handle_norm, sent.meta.recipients], [true, "bela@example.com", ["bela@example.com", "c@example.com"]]);
    assert.equal(toNormalized(await parsed(mail({ n: 3, from: "Alias <ALIAS@example.com>", to: "x@example.com" })), ACCT, "HU").message.isFromMe, true, "mail from one of my own addresses is mine even in the inbox");
    const html = toNormalized(await parsed(mail({ n: 4, html: "<p>Hi <b>there</b></p><p>second&nbsp;line &amp; more</p>" })), ACCT, "HU").message;
    assert.equal(html.text, "Hi there\n\nsecond line & more", "mailparser derives the text part from html");
    const noId = toNormalized(await parsed(mail({ n: 5, id: null, subject: null })), ACCT, "HU").message;
    assert.deepEqual([noId.providerMessageKey, noId.subject, noId.threadKey], ["uid:INBOX:5", undefined, "uid:INBOX:5"]);
    assert.deepEqual(toNormalized(await parsed(mail({ n: 6, from: "undisclosed", to: "me@example.com" }).replace(/^From: .*$/m, "From: ")), ACCT, "HU"), { skip: "no_counterpart" });
    const big = toNormalized(await parsed(mail({ n: 7, body: "x".repeat(400_000) })), ACCT, "HU").message;
    assert.equal(big.text.length, 256 * 1024, "full text, capped at 256 KB");
    assert.equal(toNormalized(await parsed(mail({ n: 8 }).replace(/^Date: .*\r\n/m, "")), ACCT, "HU").message.tsMs, 0, "a mail without a date is quarantined by storage, not guessed");
});

test("htmlToText strips markup, scripts and entities without fetching anything", () => {
    assert.equal(htmlToText("<style>p{}</style><script>alert(1)</script><p>A &lt;b&gt; &#65; &#x41;</p>"), "A <b> A &#x41;");
    assert.equal(htmlToText("<div>one</div><div>two</div><br><br><br>three"), "one\ntwo\n\nthree");
    assert.equal(htmlToText(null), "");
    assert.equal(htmlToText('<img src="http://tracker.example/x.gif"> text'), "text");
});

test("accounts file: private, atomic, secret-free; TLS-only ports; defaults", () => {
    const home = tmp();
    assert.deepEqual(loadAccounts(home), []);
    assert.equal(hasAccounts(home), false);
    const a = { id: "me@example.com@imap.example.com", host: "imap.example.com", port: 993, user: "me@example.com", label: "Work", selfAddresses: ["me@example.com"], boxes: { inbox: "INBOX", sent: null } };
    addAccount(home, a);
    assert.equal(statSync(path.join(home, FILE)).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(home), [FILE], "no temp file left behind");
    assert.deepEqual(loadAccounts(home), [a]);
    assert.equal(hasAccounts(home), true);
    addAccount(home, { ...a, label: "Renamed" });
    assert.equal(loadAccounts(home).length, 1, "adding the same id replaces it");
    assert.equal(removeAccount(home, a.id), true);
    assert.equal(removeAccount(home, a.id), false);
    for (const bad of [{ ...a, port: 143 }, { ...a, port: 0 }, { ...a, host: "bad host!" }, { ...a, user: " " }, { ...a, label: 5 }, null]) assert.throws(() => validate(bad), (e) => e.code === "invalid_account");
    assert.throws(() => validate({ ...a, port: 143 }), /plaintext/);
    writeFileSync(path.join(home, FILE), "{not json");
    assert.throws(() => loadAccounts(home), (e) => e.code === "accounts_unreadable");
    assert.equal(hasAccounts(home), false);
    assert.equal(accountId(" Me@Example.COM ", " IMAP.Example.com "), "me@example.com@imap.example.com");
});

test("config: IMAP joins the default connectors once an account exists", () => {
    const home = tmp();
    assert.deepEqual(loadConfig({ REPLY_CORE_HOME: home }).connectors, ["imessage", "contacts", "apple-mail"]);
    addAccount(home, { id: "x@y", host: "y", port: 993, user: "x", label: "", selfAddresses: [], boxes: { inbox: "INBOX", sent: null } });
    assert.deepEqual(loadConfig({ REPLY_CORE_HOME: home }).connectors, ["imessage", "contacts", "apple-mail", "imap"]);
    assert.deepEqual(loadConfig({ REPLY_CORE_HOME: home, REPLY_CORE_CONNECTORS: "none" }).connectors, []);
});

test("error codes: auth, network, timeout, TLS, throttling", () => {
    assert.equal(imapErrorCode({ authenticationFailed: true }), "auth_failed");
    for (const code of ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "EHOSTUNREACH"]) assert.equal(imapErrorCode({ code }), "network_unavailable");
    assert.equal(imapErrorCode({ code: "ETIMEDOUT" }), "timeout");
    assert.equal(imapErrorCode({ message: "Command timeout" }), "timeout");
    assert.equal(imapErrorCode({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }), "network_unavailable");
    assert.equal(imapErrorCode({ responseText: "NO [UNAVAILABLE] Too many connections" }), "network_unavailable");
    assert.equal(imapErrorCode(new Error("boom")), "internal");
});

test("CLI add-imap: verifies the login, finds the sent folder, stores the secret in the keychain only, never in the file", async () => {
    const server = await startServer();
    const home = tmp();
    const keychain = createMemoryKeychain();
    const out = [];
    const err = [];
    const io = { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, stdin: Object.assign(new EventEmitter(), { isTTY: false, resume() {}, pause() {}, setEncoding() {} }) };
    const run = (args, text = `${PASS}\n`) => { const p = accountsCli(args, { home, keychain, tls: trust, timeouts: { connection: 3000, greeting: 3000 }, ...io }); setImmediate(() => { if (text !== null) io.stdin.emit("data", text); io.stdin.emit("end"); }); return p; };
    const code = await run(["add-imap", "--host", "localhost", "--port", String(server.port), "--user", "me@example.com", "--label", "Work", "--password-stdin"]);
    assert.equal(code, EXIT.ok, err.join(""));
    assert.match(out.join(""), /added me@example\.com@localhost \(sent folder: \[Gmail\]\/Sent Mail\)/);
    const [saved] = loadAccounts(home);
    assert.deepEqual([saved.host, saved.port, saved.user, saved.label, saved.boxes], ["localhost", server.port, "me@example.com", "Work", { inbox: "INBOX", sent: "[Gmail]/Sent Mail" }]);
    assert.equal(await keychain.get(saved.id), PASS);
    assert.ok(!readFileSync(path.join(home, FILE), "utf8").includes(PASS), "no secret in the accounts file");
    assert.ok(!out.join("").includes(PASS) && !err.join("").includes(PASS));

    // list and remove
    out.length = 0;
    assert.equal(await accountsCli(["list"], { home, keychain, ...io }), EXIT.ok);
    assert.equal(out.join(""), `me@example.com@localhost\tlocalhost:${server.port}\tWork\n`);
    assert.equal(await accountsCli(["remove", saved.id], { home, keychain, ...io }), EXIT.ok);
    assert.deepEqual([await keychain.get(saved.id), loadAccounts(home)], [null, []]);
    assert.equal(await accountsCli(["remove", "nope@x"], { home, keychain, ...io }), EXIT.ok);
    await server.close();
});

test("CLI add-imap failures leave nothing behind: wrong password, untrusted certificate, unreachable, keychain refused, bad usage", async () => {
    const server = await startServer();
    const keychain = createMemoryKeychain();
    const fresh = () => { const out = []; const err = []; const stdin = Object.assign(new EventEmitter(), { isTTY: false, resume() {}, pause() {}, setEncoding() {} }); return { out, err, stdin, io: { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, stdin } }; };
    const go = async (args, { text = `${PASS}\n`, kc = keychain, tlsOpts = trust } = {}) => { const home = tmp(); const f = fresh(); const p = accountsCli(args, { home, keychain: kc, tls: tlsOpts, timeouts: { connection: 2000, greeting: 2000 }, ...f.io }); setImmediate(() => { if (text !== null) f.stdin.emit("data", text); f.stdin.emit("end"); }); const code = await p; return { code, err: f.err.join(""), home }; };
    const base = ["add-imap", "--host", "localhost", "--port", String(server.port), "--user", "me@example.com", "--password-stdin"];

    const wrong = await go(base, { text: "wrong\n" });
    assert.equal(wrong.code, EXIT.auth);
    assert.match(wrong.err, /refused the login.*app password/);
    assert.ok(!wrong.err.includes("wrong"), "the password is never echoed");
    const untrusted = await go(base, { tlsOpts: {} });
    assert.equal(untrusted.code, EXIT.network);
    assert.match(untrusted.err, /certificate is not trusted/);
    const gone = await go(["add-imap", "--host", "localhost", "--port", "1", "--user", "me@example.com", "--password-stdin"]);
    assert.equal(gone.code, EXIT.network);
    assert.match(gone.err, /could not reach localhost:1/);
    const refusedKc = { ...createMemoryKeychain(), set: async () => { throw Object.assign(new Error("locked"), { code: "permission_denied" }); } };
    const kc = await go(base, { kc: refusedKc });
    assert.equal(kc.code, EXIT.keychain);
    assert.match(kc.err, /could not save the password in the keychain/);
    for (const r of [wrong, untrusted, gone, kc]) assert.deepEqual(loadAccounts(r.home), [], "no account is recorded after a failure");
    assert.equal(keychain.size(), 0);

    for (const [args, text, re] of [[["add-imap", "--user", "u"], "x\n", /--host and --user are required/], [["add-imap", "--host", "h", "--user", "u", "--port", "143"], "x\n", /plaintext/], [["add-imap", "--host", "h", "--user", "u", "--password", "pw"], "x\n", /unknown option --password/], [["add-imap", "--host", "h", "--user", "u", "--password-stdin"], "", /no password given/], [["add-imap", "--host"], "x\n", /needs a value/], [["remove"], null, /needs one account id/], [["add-imap", "extra", "--host", "h", "--user", "u"], "x\n", /unexpected argument/]]) {
        const r = await go(args, { text });
        assert.equal(r.code, EXIT.usage, args.join(" "));
        assert.match(r.err, re);
    }
    assert.equal((await go(["frobnicate"], { text: null })).code, EXIT.usage);
    await server.close();
});

test("the password prompt is hidden, handles backspace and cancel", async () => {
    const make = () => Object.assign(new EventEmitter(), { isTTY: true, raw: false, setRawMode(v) { this.raw = v; }, resume() {}, pause() {}, setEncoding() {} });
    const written = [];
    const stdin = make();
    const p = readSecret({ stdin, stderr: { write: (s) => written.push(s) }, prompt: "Password: " });
    assert.equal(stdin.raw, true, "raw mode: nothing is echoed by the terminal");
    for (const ch of ["a", "b", "x", "\u007f", "c", "\r"]) stdin.emit("data", ch);
    assert.equal(await p, "abc");
    assert.equal(stdin.raw, false);
    assert.deepEqual(written, ["Password: ", "\n"], "only the prompt and a newline are ever written");
    const s2 = make();
    const p2 = readSecret({ stdin: s2, stderr: { write() {} } });
    s2.emit("data", "ab\u0003");
    await assert.rejects(p2, /cancelled/);
});

test("connector imports inbox and sent mail with full text, direction, Message-ID keys; idempotent; reads only new mail afterwards", async () => {
    const server = await startServer({
        inbox: [mail({ n: 1 }), mail({ n: 2, html: "<p>HTML <b>only</b></p>" }), mail({ n: 3, id: null, subject: null, body: "no id" })],
        sent: [mail({ n: 4, from: "me@example.com", to: "Bela <bela@example.com>", subject: "Re: hi" })],
    });
    const e = env({ server });
    const run = await e.runner.start(e.connector, e.account.id).done;
    assert.equal(run.outcome, "ok", JSON.stringify(run));
    assert.equal(run.inserted, 4);
    const rows = e.db.prepare("SELECT * FROM messages ORDER BY ts_ms").all().map((r) => ({ ...r, meta: JSON.parse(r.meta_json) }));
    assert.deepEqual(rows.map((r) => [r.provider_message_key, r.handle_norm, r.is_from_me, r.account]), [
        ["<m1@example.com>", "anna@example.com", 0, e.account.id], ["<m2@example.com>", "anna@example.com", 0, e.account.id], [rows[2].provider_message_key, "anna@example.com", 0, e.account.id], ["<m4@example.com>", "bela@example.com", 1, e.account.id]]);
    assert.match(rows[2].provider_message_key, /^uid:INBOX:3$/);
    assert.equal(rows[1].text, "HTML only");
    assert.equal(rows[0].text, "Body 1");
    assert.ok(rows.every((r) => r.meta.isSummary === false && r.meta.accountLabel === "Test"));
    assert.equal(rows[3].subject, "Re: hi");

    const again = await e.runner.start(e.connector, e.account.id).done;
    assert.deepEqual([again.inserted, again.updated, again.outcome], [0, 0, "ok"], "nothing new: the n:* quirk (last message always returned) is filtered");
    const cursor = JSON.parse(e.repo.getSyncState("imap", e.account.id).cursor_json);
    assert.deepEqual(Object.keys(cursor).sort(), ["INBOX", "[Gmail]/Sent Mail"]);
    assert.deepEqual(cursor.INBOX, { uidValidity: 1, lastUid: 3 });

    // a new message arrives through a separate session
    const other = new ImapFlow({ host: "localhost", port: server.port, secure: true, tls: trust, auth: { user: "me@example.com", pass: PASS }, logger: false });
    await other.connect();
    await other.append("INBOX", mail({ n: 5 }));
    await other.logout();
    const third = await e.runner.start(e.connector, e.account.id).done;
    assert.deepEqual([third.inserted, third.pages], [1, 1]);
    assert.equal(e.db.prepare("SELECT text FROM messages WHERE provider_message_key = '<m5@example.com>'").get().text, "Body 5");
    await server.close();
});

test("paging across both mailboxes with a small limit gives the same result", async () => {
    const inbox = Array.from({ length: 7 }, (_, i) => mail({ n: i + 1 }));
    const sent = Array.from({ length: 4 }, (_, i) => mail({ n: i + 20, from: "me@example.com", to: "bela@example.com" }));
    const server = await startServer({ inbox, sent });
    const big = env({ server });
    await big.runner.start(big.connector, big.account.id).done;
    const small = env({ server, limit: 3 });
    const r = await small.runner.start(small.connector, small.account.id).done;
    assert.ok(r.pages >= 4, `${r.pages} pages`);
    const dump = (db) => JSON.stringify(db.prepare("SELECT provider_message_key, handle_norm, is_from_me, text FROM messages ORDER BY provider_message_key").all());
    assert.equal(dump(small.db), dump(big.db));
    assert.equal(small.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 11);
    await server.close();
});

test("a renumbered mailbox (new UIDVALIDITY) is read again without duplicating anything", async () => {
    const msgs = [mail({ n: 1 }), mail({ n: 2 })];
    const first = await startServer({ inbox: msgs, uidvalidity: 1 });
    const e = env({ server: first });
    await e.runner.start(e.connector, e.account.id).done;
    await first.close();
    const second = await startServer({ inbox: [...msgs, mail({ n: 3 })], uidvalidity: 77 });
    addAccount(e.home, { ...e.account, port: second.port });
    const run = await e.runner.start(e.connector, e.account.id).done;
    assert.deepEqual([run.outcome, run.inserted], ["ok", 1], "only the genuinely new message is added; the others are the same Message-IDs");
    assert.equal(JSON.parse(e.repo.getSyncState("imap", e.account.id).cursor_json).INBOX.uidValidity, 77);
    assert.equal(e.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 3);
    await second.close();
});

test("failures are classified: wrong or missing password (blocked), untrusted certificate and dead server (retry, then error)", async () => {
    const server = await startServer({ inbox: [mail({ n: 1 })] });
    const badPw = env({ server, password: "not-the-password" });
    const a = await badPw.runner.start(badPw.connector, badPw.account.id).done;
    assert.deepEqual([a.outcome, a.errorCode, badPw.repo.getSyncState("imap", badPw.account.id).state], ["blocked", "auth_failed", "blocked"]);
    const none = env({ server, password: null });
    const pre = await none.connector.preflight();
    assert.deepEqual([pre.ok, pre.code], [false, "auth_failed"]);
    assert.match(pre.hint, /app password/);
    assert.equal((await none.runner.start(none.connector, none.account.id).done).errorCode, "auth_failed");

    const strict = env({ server, tlsOpts: {} });
    const t = await strict.runner.start(strict.connector, strict.account.id).done;
    assert.deepEqual([t.outcome, t.errorCode, t.attempts], ["error", "network_unavailable", 4], "an untrusted certificate is refused (retried up to the limit, never accepted)");
    assert.equal(strict.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 0);
    await server.close();
    const dead = env({ server });
    const d = await dead.runner.start(dead.connector, dead.account.id).done;
    assert.deepEqual([d.outcome, d.errorCode], ["error", "network_unavailable"]);

    const removed = createImapConnector({ config: { home: tmp() }, keychain: createMemoryKeychain() });
    await assert.rejects(removed.fetch("ghost@x", {}, { limit: 10 }), (e) => e.code === "source_missing");
});

test("the connector only reads: no STORE, EXPUNGE, APPEND, COPY, MOVE, DELETE or SELECT is ever sent, and TLS is always on", async () => {
    const server = await startServer({ inbox: [mail({ n: 1 }), mail({ n: 2 })], sent: [mail({ n: 3, from: "me@example.com", to: "b@example.com" })] });
    const e = env({ server });
    await e.runner.start(e.connector, e.account.id).done;
    const verbs = new Set(server.commands.map((c) => (c.startsWith("UID ") ? c.split(" ")[1] : c.split(" ")[0]).toUpperCase()));
    for (const forbidden of ["STORE", "EXPUNGE", "APPEND", "COPY", "MOVE", "DELETE", "SELECT", "CREATE", "RENAME"]) assert.ok(!verbs.has(forbidden), `sent ${forbidden}: ${[...verbs]}`);
    assert.ok(verbs.has("EXAMINE") && verbs.has("FETCH"));
    // plaintext is never offered: a TLS-only server is the only kind reachable, and port 143 cannot even be configured
    assert.throws(() => validate({ host: "h", port: 143, user: "u", label: "" }), /plaintext/);
    await server.close();
});

test("secrets never reach the database, logs or sync state; logs carry counts only", async () => {
    const { logger, lines } = memoryLogger();
    const server = await startServer({ inbox: [mail({ n: 1, subject: "Private subject", body: "Private body" })] });
    const e = env({ server, logger });
    await e.runner.start(e.connector, e.account.id).done;
    const everything = [lines.join(""), JSON.stringify(e.db.prepare("SELECT * FROM sync_state").all()), JSON.stringify(e.db.prepare("SELECT * FROM sync_runs").all()), readFileSync(path.join(e.home, FILE), "utf8")].join("\n");
    assert.ok(!everything.includes(PASS), "no password anywhere");
    const log = lines.join("");
    assert.ok(log.includes("connector.imap page"));
    for (const secret of ["Private subject", "Private body", "anna@example.com", "me@example.com"]) assert.ok(!log.includes(secret), `leaked ${secret}`);
    await server.close();
});

test("keychain wrapper talks to the helper with secrets on stdin and never in arguments", async () => {
    const dir = tmp();
    const bin = path.join(dir, "helper");
    const calls = path.join(dir, "calls");
    writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${calls}"\nif [ "$2" = "set" ] || [ "$1" = "keychain" -a "$2" = "set" ]; then cat >> "${calls}.stdin"; exit 0; fi\nif [ "$2" = "get" ]; then if [ "$6" = "missing@x" ]; then echo "reply-core-helper: source_missing: none" >&2; exit 11; fi; echo '{"type":"secret","schemaVersion":1,"secret":"from-keychain"}'; exit 0; fi\nexit 0\n`);
    execFileSync("chmod", ["755", bin]);
    const { sha256File } = await import("../src/helper/index.js");
    writeFileSync(`${bin}.sha256`, sha256File(bin));
    const kc = createKeychain({ helper: bin });
    await kc.set("me@x", PASS);
    assert.equal(await kc.get("me@x"), "from-keychain");
    assert.equal(await kc.get("missing@x"), null, "no saved password is null, not an error");
    await kc.delete("me@x");
    const args = readFileSync(calls, "utf8");
    assert.ok(!args.includes(PASS), "the secret is not in any argument");
    assert.equal(readFileSync(`${calls}.stdin`, "utf8"), `${PASS}\n`);
    assert.match(args, new RegExp(`keychain set --service ${SERVICE.replace(".", "\\.")} --account me@x`));
});

test("real macOS keychain round trip through the helper (opt-in: REPLY_CORE_TEST_KEYCHAIN=1)", { skip: process.env.REPLY_CORE_TEST_KEYCHAIN !== "1" || !existsSync(new URL("../helper/bin/reply-core-helper", import.meta.url).pathname) }, async () => {
  const kc = createKeychain();
  const account = `test-${process.pid}@example.invalid`;
  try {
    await kc.set(account, "round-trip-secret");
    assert.equal(await kc.get(account), "round-trip-secret");
    await kc.set(account, "replaced");
    assert.equal(await kc.get(account), "replaced");
  } finally {
    await kc.delete(account);
  }
  assert.equal(await kc.get(account), null);
});
