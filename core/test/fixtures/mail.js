import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { makePeople, randomTs, sentence } from "./people.js";

const SCHEMA = `
CREATE TABLE mailboxes (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT);
CREATE TABLE addresses (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT, comment TEXT);
CREATE TABLE subjects (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT);
CREATE TABLE summaries (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, summary TEXT);
CREATE TABLE messages (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT, global_message_id TEXT, document_id TEXT, conversation_id TEXT,
  date_sent INTEGER, date_received INTEGER, mailbox INTEGER, sender INTEGER, subject INTEGER, summary INTEGER, deleted INTEGER DEFAULT 0
);
CREATE TABLE recipients (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, message INTEGER, address INTEGER, type INTEGER, position INTEGER);
`;

// Three accounts, each with inbox/sent plus drafts, junk and trash (which connectors must exclude).
export function buildMail(rng, n, outRoot) {
    const dir = path.join(outRoot, "V10", "MailData");
    mkdirSync(dir, { recursive: true });
    const db = new Database(path.join(dir, "Envelope Index"));
    db.exec(SCHEMA);
    const people = makePeople(rng, 25);
    const accounts = [
        { id: "ACC-0001", self: "me@example.com", kind: "imap" },
        { id: "ACC-0002", self: "work@example.org", kind: "imap" },
        { id: "ACC-0003", self: "icloud-me@example.net", kind: "imap" },
    ];
    const mb = db.prepare("INSERT INTO mailboxes (url) VALUES (?)");
    const boxes = {};
    for (const a of accounts) {
        boxes[a.id] = {
            inbox: Number(mb.run(`imap://${a.id}/INBOX`).lastInsertRowid),
            sent: Number(mb.run(`imap://${a.id}/Sent%20Messages`).lastInsertRowid),
            drafts: Number(mb.run(`imap://${a.id}/Drafts`).lastInsertRowid),
            junk: Number(mb.run(`imap://${a.id}/Junk`).lastInsertRowid),
            trash: Number(mb.run(`imap://${a.id}/Deleted%20Messages`).lastInsertRowid),
        };
    }
    const addr = new Map();
    const addrId = (a) => {
        if (!addr.has(a)) addr.set(a, Number(db.prepare("INSERT INTO addresses (address, comment) VALUES (?, '')").run(a).lastInsertRowid));
        return addr.get(a);
    };
    const subj = db.prepare("INSERT INTO subjects (subject) VALUES (?)");
    const summ = db.prepare("INSERT INTO summaries (summary) VALUES (?)");
    const msg = db.prepare(`INSERT INTO messages (global_message_id, document_id, conversation_id, date_sent, date_received, mailbox, sender, subject, summary, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const rcpt = db.prepare("INSERT INTO recipients (message, address, type, position) VALUES (?, ?, ?, ?)");

    db.transaction(() => {
        const times = Array.from({ length: n }, () => randomTs(rng)).sort((a, b) => a - b);
        times.forEach((ts, i) => {
            const acc = accounts[i % accounts.length];
            const p = rng.pick(people);
            const roll = rng();
            const manyRecipients = i % 29 === 7; // always a sent mail so the 20-recipient case is guaranteed
            const sent = manyRecipients || roll < 0.35;
            const box = manyRecipients ? boxes[acc.id].sent : roll > 0.97 ? boxes[acc.id].drafts : roll > 0.94 ? boxes[acc.id].junk : roll > 0.92 ? boxes[acc.id].trash : sent ? boxes[acc.id].sent : boxes[acc.id].inbox;
            const noSubject = i % 11 === 3;
            const htmlOnly = i % 13 === 5;
            const subjectId = noSubject ? null : Number(subj.run(`Re: ${sentence(rng, 2, 5)}`).lastInsertRowid);
            const summaryId = htmlOnly ? null : Number(summ.run(sentence(rng, 8, 20)).lastInsertRowid);
            const senderAddr = sent ? acc.self : p.email;
            const deleted = i % 37 === 9 ? 1 : 0;
            const id = Number(msg.run(`<fix-${i}@mail.example.com>`, String(i), `conv-${i % 40}`, Math.floor(ts / 1000), Math.floor(ts / 1000), box, addrId(senderAddr), subjectId, summaryId, deleted).lastInsertRowid);
            const to = sent ? (manyRecipients ? people.slice(0, 20).map((x) => x.email) : [p.email]) : [acc.self];
            to.forEach((t, pos) => rcpt.run(id, addrId(t), 0, pos));
        });
    })();
    db.close();
}
