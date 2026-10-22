import { randomUUID } from "node:crypto";

export const CHANNELS = ["imessage", "email", "whatsapp"];
const MAX_TEXT = 256 * 1024;
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;
const PREVIEW_CHARS = 140;

export class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.code = "invalid_message";
    }
}

export function kindOf(handleNorm) {
    if (handleNorm.startsWith("group:") || handleNorm.startsWith("other:")) return "other";
    if (handleNorm.endsWith("@wa")) return "whatsapp";
    if (handleNorm.startsWith("+")) return "phone";
    if (handleNorm.includes("@")) return "email";
    return "other";
}

const preview = (text) => text.replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS);

// Turns user input into a safe FTS5 expression: every term quoted, prefix match, AND-joined.
export function ftsQuery(q) {
    const terms = String(q ?? "").split(/\s+/).filter(Boolean);
    return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" AND ");
}

function validate(m) {
    if (!CHANNELS.includes(m.channel)) throw new ValidationError(`unknown channel: ${m.channel}`);
    if (typeof m.account !== "string") throw new ValidationError("account must be a string");
    if (!m.providerMessageKey) throw new ValidationError("providerMessageKey is required");
    if (!m.handle_norm || !String(m.handle_norm).trim()) throw new ValidationError("handle_norm is required");
    if (typeof m.isFromMe !== "boolean") throw new ValidationError("isFromMe must be a boolean");
    if (!Number.isFinite(m.tsMs)) throw new ValidationError("tsMs must be a number");
}

export function createRepo(db, { now = () => Date.now(), afterBatch = null } = {}) {
    let afterHook = afterBatch;
    const q = {
        message: db.prepare("SELECT text, subject, attachments_json, ts_ms, meta_json FROM messages WHERE id = ?"),
        insertMessage: db.prepare(`INSERT INTO messages (id, channel, account, provider_message_key, thread_key, handle_norm, is_from_me, ts_ms, subject, text, attachments_json, meta_json, ingested_at)
            VALUES (@id, @channel, @account, @provider_message_key, @thread_key, @handle_norm, @is_from_me, @ts_ms, @subject, @text, @attachments_json, @meta_json, @ingested_at)`),
        // Mail to yourself is two messages in two Mail accounts (the sent copy and the received copy): the same mail, so the same
        // provider message key, "from me" at the same time with the same subject; the received copy often has no body yet.
        // The key is the identity: two different mails never share it, however alike they look.
        twin: db.prepare("SELECT id, text FROM messages WHERE channel = 'email' AND is_from_me = 1 AND handle_norm = ? AND ts_ms = ? AND subject IS ? AND provider_message_key = ? AND account != ? LIMIT 1"),
        setText: db.prepare("UPDATE messages SET text = ?, attachments_json = ? WHERE id = ?"),
        twinPairs: db.prepare(`SELECT a.id AS keep_id, b.id AS drop_id, a.handle_norm AS handle FROM messages a JOIN messages b
            ON b.handle_norm = a.handle_norm AND b.ts_ms = a.ts_ms AND b.subject IS a.subject AND b.provider_message_key = a.provider_message_key AND b.account != a.account
            WHERE a.channel = 'email' AND b.channel = 'email' AND a.is_from_me = 1 AND b.is_from_me = 1
            AND (length(a.text) > length(b.text) OR (length(a.text) = length(b.text) AND a.id < b.id))`),
        dropMessage: db.prepare("DELETE FROM messages WHERE id = ?"),
        updateMessage: db.prepare("UPDATE messages SET text=@text, subject=@subject, attachments_json=@attachments_json, ts_ms=@ts_ms, meta_json=@meta_json WHERE id=@id"),
        handle: db.prepare("SELECT first_seen_ms, last_seen_ms FROM handles WHERE handle_norm = ?"),
        insertHandle: db.prepare("INSERT INTO handles (handle_norm, kind, first_seen_ms, last_seen_ms) VALUES (?,?,?,?)"),
        widenHandle: db.prepare("UPDATE handles SET first_seen_ms=?, last_seen_ms=? WHERE handle_norm=?"),
        link: db.prepare("SELECT contact_id FROM contact_handles WHERE handle_norm = ?"),
        insertContact: db.prepare("INSERT INTO contacts (id, display_name, origin, hidden, created_ms) VALUES (?,?,?,0,?)"),
        insertLink: db.prepare("INSERT INTO contact_handles (handle_norm, contact_id, link_origin, linked_ms) VALUES (?,?,?,?)"),
        lastMessage: db.prepare(`SELECT m.channel, m.text, m.is_from_me, m.ts_ms FROM messages m
            JOIN contact_handles ch ON ch.handle_norm = m.handle_norm WHERE ch.contact_id = ?
            ORDER BY m.ts_ms DESC, m.id DESC LIMIT 1`),
        counts: db.prepare(`SELECT m.channel, COUNT(*) n FROM messages m
            JOIN contact_handles ch ON ch.handle_norm = m.handle_norm WHERE ch.contact_id = ? GROUP BY m.channel`),
        upsertSummary: db.prepare(`INSERT INTO contact_summary (contact_id, last_ts_ms, last_channel, last_preview, last_from_me, count_total, counts_json)
            VALUES (@contact_id, @last_ts_ms, @last_channel, @last_preview, @last_from_me, @count_total, @counts_json)
            ON CONFLICT(contact_id) DO UPDATE SET last_ts_ms=excluded.last_ts_ms, last_channel=excluded.last_channel, last_preview=excluded.last_preview,
              last_from_me=excluded.last_from_me, count_total=excluded.count_total, counts_json=excluded.counts_json`),
        deleteSummary: db.prepare("DELETE FROM contact_summary WHERE contact_id = ?"),
        handlesOf: db.prepare("SELECT handle_norm FROM contact_handles WHERE contact_id = ?"),
        syncGet: db.prepare("SELECT * FROM sync_state WHERE connector = ? AND account = ?"),
        syncUpsert: db.prepare(`INSERT INTO sync_state (connector, account, cursor_json, state, last_success_ms, last_error_code, last_error_ms, messages_total)
            VALUES (@connector, @account, @cursor_json, @state, @last_success_ms, @last_error_code, @last_error_ms, @messages_total)
            ON CONFLICT(connector, account) DO UPDATE SET cursor_json=excluded.cursor_json, state=excluded.state, last_success_ms=excluded.last_success_ms,
              last_error_code=excluded.last_error_code, last_error_ms=excluded.last_error_ms, messages_total=excluded.messages_total`),
    };

    function ensureHandle(handleNorm, ts) {
        const row = q.handle.get(handleNorm);
        if (!row) q.insertHandle.run(handleNorm, kindOf(handleNorm), ts, ts);
        else if (ts < row.first_seen_ms || ts > row.last_seen_ms) q.widenHandle.run(Math.min(ts, row.first_seen_ms), Math.max(ts, row.last_seen_ms), handleNorm);
    }

    function ensureContactForHandle(handleNorm) {
        const link = q.link.get(handleNorm);
        if (link) return link.contact_id;
        const id = randomUUID();
        const t = now();
        q.insertContact.run(id, handleNorm, "auto", t);
        q.insertLink.run(handleNorm, id, "auto", t);
        return id;
    }

    function rebuildSummary(contactId) {
        const last = q.lastMessage.get(contactId);
        if (!last) {
            q.deleteSummary.run(contactId);
            return;
        }
        const counts = Object.fromEntries(CHANNELS.map((c) => [c, 0]));
        let total = 0;
        for (const r of q.counts.all(contactId)) {
            counts[r.channel] = r.n;
            total += r.n;
        }
        q.upsertSummary.run({
            contact_id: contactId, last_ts_ms: last.ts_ms, last_channel: last.channel, last_preview: preview(last.text),
            last_from_me: last.is_from_me, count_total: total, counts_json: JSON.stringify(counts),
        });
    }

    // One transaction per batch: a structurally invalid row rolls the whole batch back.
    function upsertMessages(batch) {
        const result = upsertInTransaction(batch);
        afterHook?.(result); // e.g. merges waiting for handles that have just appeared
        return result;
    }

    function upsertInTransaction(batch) {
        return db.transaction(() => {
            const result = { inserted: 0, updated: 0, skipped: 0, quarantined: 0 };
            const touched = new Set();
            const t = now();
            for (const m of batch) {
                validate(m);
                if (m.tsMs <= 0 || m.tsMs > t + FUTURE_SLACK_MS) {
                    result.quarantined++;
                    continue;
                }
                const id = `${m.channel}:${m.account}:${m.providerMessageKey}`;
                const row = {
                    id, channel: m.channel, account: m.account, provider_message_key: m.providerMessageKey,
                    thread_key: m.threadKey ?? "", handle_norm: m.handle_norm, is_from_me: m.isFromMe ? 1 : 0, ts_ms: Math.trunc(m.tsMs),
                    subject: m.subject ?? null, text: String(m.text ?? "").slice(0, MAX_TEXT),
                    attachments_json: JSON.stringify(m.attachments ?? []), meta_json: JSON.stringify(m.meta ?? {}), ingested_at: t,
                };
                const existing = q.message.get(id);
                ensureHandle(m.handle_norm, row.ts_ms);
                const contactId = ensureContactForHandle(m.handle_norm);
                const twin = !existing && row.channel === "email" && row.is_from_me === 1 ? q.twin.get(row.handle_norm, row.ts_ms, row.subject, row.provider_message_key, row.account) : null;
                if (twin) {
                    // the same mail seen from the other account: keep one message, with the longer text
                    if (row.text.length > twin.text.length) { q.setText.run(row.text, row.attachments_json, twin.id); result.updated++; } else { result.skipped++; continue; }
                } else if (!existing) {
                    q.insertMessage.run(row);
                    result.inserted++;
                } else if (existing.text !== row.text || existing.subject !== row.subject || existing.attachments_json !== row.attachments_json || existing.ts_ms !== row.ts_ms || existing.meta_json !== row.meta_json) {
                    q.updateMessage.run(row);
                    result.updated++;
                } else {
                    result.skipped++;
                    continue;
                }
                touched.add(contactId);
            }
            for (const c of touched) rebuildSummary(c);
            return result;
        })();
    }

    // One-off clean-up of self-mail twins stored before they were collapsed on import. Returns how many were removed.
    function dedupeSelfMail() {
        return db.transaction(() => {
            const pairs = q.twinPairs.all();
            const contacts = new Set();
            const gone = new Set();
            for (const p of pairs) {
                if (gone.has(p.drop_id) || gone.has(p.keep_id)) continue;
                q.dropMessage.run(p.drop_id);
                gone.add(p.drop_id);
                const c = q.link.get(p.handle)?.contact_id;
                if (c) contacts.add(c);
            }
            for (const c of contacts) rebuildSummary(c);
            return gone.size;
        })();
    }

    function getThread(contactId, { beforeTs, beforeId, limit = 50, channel } = {}) {
        const handles = q.handlesOf.all(contactId).map((r) => r.handle_norm);
        if (!handles.length) return [];
        const marks = handles.map(() => "?").join(",");
        const params = [...handles];
        let sql = `SELECT * FROM messages WHERE handle_norm IN (${marks})`;
        if (channel) { sql += " AND channel = ?"; params.push(channel); }
        if (beforeTs != null) { sql += " AND (ts_ms < ? OR (ts_ms = ? AND id < ?))"; params.push(beforeTs, beforeTs, beforeId ?? "￿"); }
        sql += " ORDER BY ts_ms DESC, id DESC LIMIT ?";
        params.push(limit);
        return db.prepare(sql).all(...params);
    }

    function listContacts({ query, channel, limit = 30, beforeTs, beforeId } = {}) {
        const where = ["c.hidden = 0"];
        const params = [];
        if (query) {
            where.push("(c.display_name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM contact_handles h WHERE h.contact_id = c.id AND h.handle_norm LIKE ? ESCAPE '\\'))");
            const like = `%${String(query).replace(/[\\%_]/g, "\\$&")}%`;
            params.push(like, like);
        }
        if (channel) { where.push("json_extract(s.counts_json, ?) > 0"); params.push(`$.${channel}`); }
        if (beforeTs != null) { where.push("(s.last_ts_ms < ? OR (s.last_ts_ms = ? AND s.contact_id < ?))"); params.push(beforeTs, beforeTs, beforeId ?? "￿"); }
        params.push(limit);
        return db.prepare(`SELECT c.id, c.display_name, c.origin, s.last_ts_ms, s.last_channel, s.last_preview, s.last_from_me, s.count_total, s.counts_json
            FROM contact_summary s JOIN contacts c ON c.id = s.contact_id WHERE ${where.join(" AND ")}
            ORDER BY s.last_ts_ms DESC, s.contact_id DESC LIMIT ?`).all(...params);
    }

    function search({ q: text, channel, contactId, limit = 30 } = {}) {
        const match = ftsQuery(text);
        if (!match) return [];
        const params = [match];
        let sql = `SELECT m.id, m.channel, m.ts_ms, m.handle_norm, bm25(messages_fts, 1.0, 2.0) AS rank,
                snippet(messages_fts, 0, char(1), char(2), '…', 24) AS snippet
            FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid WHERE messages_fts MATCH ?`;
        if (channel) { sql += " AND m.channel = ?"; params.push(channel); }
        if (contactId) { sql += " AND m.handle_norm IN (SELECT handle_norm FROM contact_handles WHERE contact_id = ?)"; params.push(contactId); }
        sql += " ORDER BY rank ASC, m.ts_ms DESC, m.id DESC LIMIT ?";
        params.push(limit);
        return db.prepare(sql).all(...params);
    }

    function getSyncState(connector, account = "") {
        return q.syncGet.get(connector, account) ?? null;
    }

    function setSyncState(connector, account, patch) {
        const cur = getSyncState(connector, account) ?? {
            connector, account, cursor_json: "{}", state: "idle", last_success_ms: null, last_error_code: null, last_error_ms: null, messages_total: 0,
        };
        q.syncUpsert.run({ ...cur, ...patch, connector, account });
        return getSyncState(connector, account);
    }

    return { setAfterBatch: (fn) => { afterHook = fn; }, upsertMessages, dedupeSelfMail, getThread, listContacts, search, getSyncState, setSyncState, rebuildSummary, ensureContactForHandle, handlesOf: (id) => q.handlesOf.all(id).map((r) => r.handle_norm) };
}
