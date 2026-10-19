import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createAppleMailConnector, toNormalized } from "../src/connectors/apple-mail.js";
import { createRunner } from "../src/connectors/runner.js";
import { defaultHelperPath } from "../src/helper/index.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { buildFixtures } from "./fixtures/build.js";
import { memoryLogger } from "./helpers.js";

const skip = existsSync(defaultHelperPath()) ? false : "helper not built: run helper/build.sh";
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "rc-mail-"));
let fx;
let root;
test.before(async () => { root = tmp(); fx = await buildFixtures({ seed: 42, out: path.join(root, "fx") }); });
test.after(() => rmSync(root, { recursive: true, force: true }));

function pipeline(mailRoot, { pageLimit = 500, logger } = {}) {
    const home = tmp();
    const { db } = openDb(home);
    const repo = createRepo(db);
    const runner = createRunner({ db, repo, pageLimit, logger, sleep: async () => {} });
    const connector = createAppleMailConnector({ config: { mailRoot, defaultRegion: "HU" }, logger });
    return { db, repo, runner, connector };
}

const rec = (over = {}) => ({ type: "message", schemaVersion: 1, source: "mail", providerMessageKey: "<a@x>", account: "ACC-1", threadKey: "c1", counterpartHandle: "anna@example.com", isFromMe: false, tsMs: 1760000000000, subject: "Hello", text: "Body text", attachments: [], sender: "anna@example.com", to: ["me@example.com"], mailboxKind: "inbox", accountLabel: "ACC-1", ...over });

test("toNormalized: received, sent, subject and summary combinations, exclusions, no counterpart", () => {
    const m = toNormalized(rec(), "HU").message;
    assert.deepEqual([m.channel, m.account, m.handle_norm, m.subject, m.text, m.isFromMe], ["email", "ACC-1", "anna@example.com", "Hello", "Hello\n\nBody text", false]);
    assert.deepEqual(m.meta, { isSummary: true, recipients: ["me@example.com"], accountLabel: "ACC-1" });
    assert.ok(!("mailbox" in m.meta), "the mailbox is not stored");
    assert.equal(toNormalized(rec({ subject: undefined }), "HU").message.text, "Body text");
    assert.equal(toNormalized(rec({ text: "" }), "HU").message.text, "Hello", "html-only mail keeps the subject");
    assert.equal(toNormalized(rec({ subject: undefined, text: "" }), "HU").message.text, "");
    assert.equal(toNormalized(rec({ counterpartHandle: "Anna@Example.COM" }), "HU").message.handle_norm, "anna@example.com");
    for (const kind of ["drafts", "junk", "trash"]) assert.deepEqual(toNormalized(rec({ mailboxKind: kind }), "HU"), { skip: "excluded" });
    for (const kind of ["inbox", "sent", "archive", "other"]) assert.ok(toNormalized(rec({ mailboxKind: kind }), "HU").message);
    assert.deepEqual(toNormalized(rec({ isFromMe: true, counterpartHandle: "", to: [] }), "HU"), { skip: "no_counterpart" });
});

test("fixture import maps direction, counterpart, recipients and exclusions", { skip }, async () => {
    const { db, runner, connector } = pipeline(fx.mail);
    const res = await runner.start(connector, "").done;
    assert.equal(res.outcome, "ok");
    const src = new Database(fx.mailIndex, { readonly: true });
    const expected = src.prepare(`SELECT COUNT(*) n FROM messages m JOIN mailboxes b ON b.ROWID = m.mailbox
        WHERE m.deleted = 0 AND b.url NOT LIKE '%/Drafts' AND b.url NOT LIKE '%/Junk' AND b.url NOT LIKE '%/Deleted%'`).get().n;
    assert.equal(res.inserted, expected);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE channel = 'email'").get().n, expected);
    assert.ok(expected > 100 && expected < 200);

    const rows = db.prepare("SELECT * FROM messages").all().map((r) => ({ ...r, meta: JSON.parse(r.meta_json) }));
    assert.ok(rows.every((r) => r.meta.isSummary === true), "every email row is flagged as a summary");
    assert.deepEqual([...new Set(rows.map((r) => r.account))].sort(), ["ACC-0001", "ACC-0002", "ACC-0003"]);
    const sent = rows.filter((r) => r.is_from_me);
    assert.ok(sent.length > 0 && rows.some((r) => !r.is_from_me));
    for (const r of sent) assert.equal(r.handle_norm, r.meta.recipients[0], "sent mail: counterpart is the first recipient");
    for (const r of rows.filter((x) => !x.is_from_me)) assert.ok(!["me@example.com", "work@example.org", "icloud-me@example.net"].includes(r.handle_norm), "received mail: counterpart is the sender");
    assert.ok(rows.some((r) => r.meta.recipients.length === 20), "20-recipient mail kept in one row");
    assert.ok(rows.every((r) => r.handle_norm === r.handle_norm.toLowerCase()));
    assert.ok(rows.some((r) => r.subject === null), "mail without a subject");
    assert.ok(rows.some((r) => r.subject && !r.text.includes("\n\n")), "html-only mail keeps only the subject");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE text LIKE '%Re: %' AND subject IS NULL").get().n, 0);
    // searchable by subject and body
    const subj = rows.find((r) => r.subject).subject.split(" ").at(-1).replace(/\W/g, "");
    assert.ok(createRepo(db).search({ q: subj }).length > 0);
    src.close();
});

test("a second run inserts nothing and paging in small pages gives the same database", { skip }, async () => {
    const big = pipeline(fx.mail);
    await big.runner.start(big.connector, "").done;
    const again = await big.runner.start(big.connector, "").done;
    assert.deepEqual([again.inserted, again.updated], [0, 0]);
    const small = pipeline(fx.mail, { pageLimit: 17 });
    const r = await small.runner.start(small.connector, "").done;
    assert.ok(r.pages >= 8);
    const dump = (db) => JSON.stringify(db.prepare("SELECT id, handle_norm, subject, text, ts_ms, is_from_me, meta_json FROM messages ORDER BY id").all());
    assert.equal(dump(small.db), dump(big.db));
});

test("the same message in two mailboxes is stored once and never changes afterwards", { skip }, async () => {
    const copy = path.join(tmp(), "Mail");
    cpSync(fx.mail, copy, { recursive: true });
    const db = new Database(path.join(copy, "V10", "MailData", "Envelope Index"));
    const archive = Number(db.prepare("INSERT INTO mailboxes (url) VALUES ('imap://ACC-0001/%5BGmail%5D/All%20Mail')").run().lastInsertRowid);
    const inbox = db.prepare("SELECT m.* FROM messages m JOIN mailboxes b ON b.ROWID = m.mailbox WHERE b.url = 'imap://ACC-0001/INBOX' AND m.deleted = 0 LIMIT 1").get();
    const p = pipeline(copy);
    await p.runner.start(p.connector, "").done;
    const before = p.db.prepare("SELECT COUNT(*) n FROM messages").get().n;
    const metaBefore = p.db.prepare("SELECT meta_json FROM messages WHERE provider_message_key = ?").get(inbox.global_message_id).meta_json;
    db.prepare(`INSERT INTO messages (global_message_id, document_id, conversation_id, date_sent, date_received, mailbox, sender, subject, summary, deleted)
        VALUES (?, 'dup', ?, ?, ?, ?, ?, ?, ?, 0)`).run(inbox.global_message_id, inbox.conversation_id, inbox.date_sent, inbox.date_received, archive, inbox.sender, inbox.subject, inbox.summary);
    const dupId = db.prepare("SELECT MAX(ROWID) id FROM messages").get().id;
    for (const r of db.prepare("SELECT address, type, position FROM recipients WHERE message = ?").all(inbox.ROWID)) db.prepare("INSERT INTO recipients (message, address, type, position) VALUES (?, ?, ?, ?)").run(dupId, r.address, r.type, r.position);
    db.close();
    const res = await p.runner.start(p.connector, "").done;
    assert.deepEqual([res.inserted, res.updated, res.skipped], [0, 0, 1], "the All Mail copy is a no-op");
    assert.equal(p.db.prepare("SELECT COUNT(*) n FROM messages").get().n, before);
    assert.equal(p.db.prepare("SELECT meta_json FROM messages WHERE provider_message_key = ?").get(inbox.global_message_id).meta_json, metaBefore);
});

test("preflight reports each blocked cause with its code and hint", { skip }, async () => {
    const ok = await createAppleMailConnector({ config: { mailRoot: fx.mail } }).preflight();
    assert.deepEqual(ok, { ok: true });
    const missing = await createAppleMailConnector({ config: { mailRoot: "/nonexistent/Mail" } }).preflight();
    assert.deepEqual(missing, { ok: false, code: "source_missing", hint: "Add an account in the Mail app, then recheck." });
    const empty = tmp();
    assert.equal((await createAppleMailConnector({ config: { mailRoot: empty } }).preflight()).code, "source_missing", "a Mail folder with no accounts");
    const locked = path.join(tmp(), "Mail");
    cpSync(fx.mail, locked, { recursive: true });
    chmodSync(locked, 0o000);
    const denied = await createAppleMailConnector({ config: { mailRoot: locked } }).preflight();
    chmodSync(locked, 0o755);
    assert.deepEqual([denied.ok, denied.code], [false, "permission_denied"]);
    const odd = path.join(tmp(), "Mail");
    cpSync(fx.mail, odd, { recursive: true });
    const d = new Database(path.join(odd, "V10", "MailData", "Envelope Index"));
    d.exec("DROP TABLE recipients");
    d.close();
    assert.equal((await createAppleMailConnector({ config: { mailRoot: odd } }).preflight()).code, "schema_unsupported");
    assert.equal((await createAppleMailConnector({ config: { mailRoot: fx.mail }, helper: "/nonexistent/helper" }).preflight()).code, "helper_unavailable");
});

test("blocked sources write nothing and set the blocked state", { skip }, async () => {
    const p = pipeline("/nonexistent/Mail");
    const res = await p.runner.start(p.connector, "").done;
    assert.deepEqual([res.outcome, res.errorCode], ["blocked", "source_missing"]);
    assert.equal(p.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 0);
    assert.equal(p.repo.getSyncState("apple-mail", "").state, "blocked");
});

test("logs carry counts only: no address, subject or text", { skip }, async () => {
    const { logger, lines } = memoryLogger();
    const p = pipeline(fx.mail, { logger });
    await p.runner.start(p.connector, "").done;
    const out = lines.join("");
    assert.ok(out.includes("connector.apple-mail page"));
    for (const secret of ["@example.", "Re: ", "ACC-000", "Schedule", "meeting"]) assert.ok(!out.toLowerCase().includes(secret.toLowerCase()), `leaked ${secret}`);
});
