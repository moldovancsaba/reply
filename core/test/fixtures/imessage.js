import Database from "better-sqlite3";
import { makePeople, randomTs, sentence } from "./people.js";

const APPLE_EPOCH_S = 978307200;
export const appleNanos = (ms) => (Math.floor(ms / 1000) - APPLE_EPOCH_S) * 1_000_000_000;
export const appleSeconds = (ms) => Math.floor(ms / 1000) - APPLE_EPOCH_S;

// Unsigned varint-like length used by typedstream: < 128 -> one byte, else 0x81 + 16-bit little endian.
function streamLen(n) {
    return n < 128 ? Buffer.from([n]) : Buffer.from([0x81, n & 0xff, (n >> 8) & 0xff]);
}

// Builds the same bytes as NSArchiver.archivedData(withRootObject: NSAttributedString(string:)) on macOS 26
// (verified byte-for-byte against NSArchiver in the helper tests). Messages stores bodies this way in `attributedBody`.
export function encodeAttributedBody(text) {
    const utf8 = Buffer.from(text, "utf8");
    const utf16len = text.length;
    const head = Buffer.from("040b73747265616d747970656481e803840140848484124e5341747472696275746564537472696e67008484084e534f626a656374008592848484084e53537472696e67019484012b", "hex");
    const mid = Buffer.from("8684026949", "hex");
    const tail = Buffer.from("928484840c4e5344696374696f6e6172790094840169008686", "hex");
    return Buffer.concat([head, streamLen(utf8.length), utf8, mid, Buffer.from([0x01]), streamLen(utf16len), tail]);
}

const SCHEMA = `
CREATE TABLE handle (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, service TEXT NOT NULL);
CREATE TABLE chat (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT NOT NULL, style INTEGER, chat_identifier TEXT, display_name TEXT);
CREATE TABLE message (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT NOT NULL, text TEXT, subject TEXT, handle_id INTEGER DEFAULT 0,
  service TEXT, date INTEGER, is_from_me INTEGER DEFAULT 0, associated_message_type INTEGER DEFAULT 0,
  associated_message_guid TEXT, associated_message_emoji TEXT, attributedBody BLOB, cache_has_attachments INTEGER DEFAULT 0
);
CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER, PRIMARY KEY (chat_id, message_id));
CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER, PRIMARY KEY (chat_id, handle_id));
CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT, filename TEXT, mime_type TEXT, transfer_name TEXT, total_bytes INTEGER, uti TEXT);
CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
`;

export function buildImessage(rng, n, outPath) {
    const db = new Database(outPath);
    db.exec(SCHEMA);
    const people = makePeople(rng, 25);
    const insHandle = db.prepare("INSERT INTO handle (id, service) VALUES (?, ?)");
    const insChat = db.prepare("INSERT INTO chat (guid, style, chat_identifier, display_name) VALUES (?, ?, ?, ?)");
    const insMsg = db.prepare(`INSERT INTO message (guid, text, subject, handle_id, service, date, is_from_me, associated_message_type, associated_message_guid, associated_message_emoji, attributedBody, cache_has_attachments)
        VALUES (@guid, @text, @subject, @handle_id, @service, @date, @is_from_me, @amt, @amg, @emoji, @body, @att)`);
    const joinChat = db.prepare("INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)");
    const insAtt = db.prepare("INSERT INTO attachment (guid, filename, mime_type, transfer_name, total_bytes, uti) VALUES (?, ?, ?, ?, ?, ?)");
    const joinAtt = db.prepare("INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)");

    // handles: most people are phones with a leading +, a few without, a few email-based iMessage ids
    const handleIds = people.map((p, i) => {
        const id = i % 8 === 7 ? p.email : i % 6 === 5 ? p.phone.slice(1) : p.phone;
        const service = i % 9 === 4 ? "SMS" : "iMessage";
        return { person: p, rowid: Number(insHandle.run(id, service).lastInsertRowid), service, id };
    });
    const direct = handleIds.map((h) => Number(insChat.run(`iMessage;-;${h.id}`, 45, h.id, null).lastInsertRowid));
    const groupMembers = handleIds.slice(0, 3);
    const groupChat = Number(insChat.run("iMessage;+;chat000000000000000001", 43, "chat000000000000000001", "Synthetic group").lastInsertRowid);
    const jh = db.prepare("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)");
    for (const m of groupMembers) jh.run(groupChat, m.rowid);

    db.transaction(() => {
        const rows = Array.from({ length: n }, () => ({ ts: randomTs(rng), r: rng() })).sort((a, b) => a.ts - b.ts);
        rows.forEach(({ ts, r }, i) => {
            const idx = rng.int(handleIds.length);
            const h = handleIds[idx];
            const inGroup = r < 0.1;
            const sender = inGroup ? rng.pick(groupMembers) : h;
            const fromMe = rng() < 0.45;
            const seconds = rng() < 0.1; // some rows use the old second-based Apple epoch
            const body = sentence(rng);
            const kind = rng();
            // 1:1 rows (sent or received) reference the counterpart handle; group rows reference the sender, sent group rows reference none
            const handleId = inGroup ? (fromMe ? 0 : sender.rowid) : h.rowid;
            const base = {
                guid: `FIX-${String(i).padStart(6, "0")}`, text: body, subject: null, handle_id: handleId,
                service: sender.service, date: seconds ? appleSeconds(ts) : appleNanos(ts), is_from_me: fromMe ? 1 : 0, amt: 0, amg: null, emoji: null, body: null, att: 0,
            };
            if (kind < 0.15) { base.text = null; base.body = encodeAttributedBody(body); }
            else if (kind < 0.2) { base.text = null; base.att = 1; }
            else if (kind < 0.25) { base.amt = 2000; base.amg = `p:0/FIX-${String(Math.max(0, i - 1)).padStart(6, "0")}`; base.emoji = null; base.text = null; }
            const id = Number(insMsg.run(base).lastInsertRowid);
            joinChat.run(inGroup ? groupChat : direct[idx], id);
            if (base.att) {
                const a = Number(insAtt.run(`ATT-${i}`, `~/Library/Messages/Attachments/${i}/IMG_${i}.jpeg`, "image/jpeg", `IMG_${i}.jpeg`, 1000 + i, "public.jpeg").lastInsertRowid);
                joinAtt.run(id, a);
            }
        });
    })();
    db.close();
}
