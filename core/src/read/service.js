import { AppError } from "../errors.js";
import { formatHandle } from "../identity/normalize.js";
import { CHANNELS, ftsQuery } from "../storage/repo.js";

const SNIPPET_MAX = 160;
const SNIPPET_START = "\u0001";
const SNIPPET_END = "\u0002";
// Search ranking: S = bm25(messages_fts, TEXT_WEIGHT, SUBJECT_WEIGHT), lower is better. A subject states the topic of a
// whole mail, so subject matches weigh double. Recency is only the tie-breaker. Tune here and nowhere else.
export const TEXT_WEIGHT = 1.0;
export const SUBJECT_WEIGHT = 2.0;

export const encodeCursor = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

// Cursors are opaque to clients; anything that does not decode to the expected shape is `invalid_cursor`.
export function decodeCursor(raw, shape) {
    const bad = () => new AppError(400, "invalid_cursor", "That cursor is not valid. Start again from the first page.");
    let obj;
    try {
        obj = JSON.parse(Buffer.from(String(raw), "base64url").toString("utf8"));
    } catch {
        throw bad();
    }
    if (!obj || typeof obj !== "object") throw bad();
    for (const [k, type] of Object.entries(shape)) if (typeof obj[k] !== type || (type === "number" && !Number.isFinite(obj[k]))) throw bad();
    return obj;
}

const iso = (ms) => new Date(ms).toISOString();
const likeOf = (s) => `%${String(s).replace(/[\\%_]/g, "\\$&")}%`;
const emptyCounts = () => Object.fromEntries(CHANNELS.map((c) => [c, 0]));

// Keeps a snippet within SNIPPET_MAX characters without leaving a highlight open.
export function limitSnippet(s) {
    if (s.length <= SNIPPET_MAX) return s;
    let cut = s.slice(0, SNIPPET_MAX - 1);
    if (cut.lastIndexOf(SNIPPET_START) > cut.lastIndexOf(SNIPPET_END)) cut += SNIPPET_END;
    return `${cut}…`;
}

export function createReadService({ db, replyChannels }) {
    const q = {
        contact: db.prepare("SELECT id, display_name, origin, merged_into FROM contacts WHERE id = ?"),
        summary: db.prepare("SELECT count_total, counts_json FROM contact_summary WHERE contact_id = ?"),
        handles: db.prepare("SELECT handle_norm, link_origin FROM contact_handles WHERE contact_id = ? ORDER BY handle_norm"),
        kind: db.prepare("SELECT kind FROM handles WHERE handle_norm = ?"),
    };

    function handlesFor(ids) {
        if (!ids.length) return new Map();
        const rows = db.prepare(`SELECT ch.contact_id, h.handle_norm, h.kind FROM contact_handles ch JOIN handles h ON h.handle_norm = ch.handle_norm
            WHERE ch.contact_id IN (${ids.map(() => "?").join(",")}) ORDER BY h.handle_norm`).all(...ids);
        const out = new Map();
        for (const r of rows) {
            if (!out.has(r.contact_id)) out.set(r.contact_id, []);
            out.get(r.contact_id).push({ value: r.handle_norm, label: formatHandle(r.handle_norm), kind: r.kind });
        }
        return out;
    }

    function activeContact(id) {
        const c = q.contact.get(id);
        if (!c) throw new AppError(404, "contact_not_found", "That contact does not exist.");
        if (c.merged_into) {
            const err = new AppError(404, "contact_not_found", "That contact was merged into another one.");
            err.details = { mergedInto: c.merged_into };
            throw err;
        }
        return c;
    }

    function listContacts({ query, channel, limit, cursor, includeEmpty }) {
        const join = includeEmpty ? "LEFT JOIN" : "JOIN";
        const where = ["c.hidden = 0"];
        const params = [];
        if (query) {
            where.push("(c.display_name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM contact_handles h WHERE h.contact_id = c.id AND h.handle_norm LIKE ? ESCAPE '\\'))");
            params.push(likeOf(query), likeOf(query));
        }
        if (channel) {
            where.push("json_extract(s.counts_json, ?) > 0");
            params.push(`$.${channel}`);
        }
        const base = `FROM contacts c ${join} contact_summary s ON s.contact_id = c.id WHERE ${where.join(" AND ")}`;
        const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(...params).n;
        const keyed = [...where];
        const keyParams = [...params];
        // ordering by the summary table's own columns lets SQLite walk the contact_summary_last index instead of sorting
        const sortTs = includeEmpty ? "COALESCE(s.last_ts_ms, 0)" : "s.last_ts_ms";
        const sortId = includeEmpty ? "c.id" : "s.contact_id";
        if (cursor) {
            const cur = decodeCursor(cursor, { ts: "number", id: "string" });
            keyed.push(`(${sortTs} < ? OR (${sortTs} = ? AND ${sortId} < ?))`);
            keyParams.push(cur.ts, cur.ts, cur.id);
        }
        const rows = db.prepare(`SELECT c.id, c.display_name, s.last_ts_ms, s.last_channel, s.last_preview, s.last_from_me, s.count_total, s.counts_json
            FROM contacts c ${join} contact_summary s ON s.contact_id = c.id WHERE ${keyed.join(" AND ")}
            ORDER BY ${sortTs} DESC, ${sortId} DESC LIMIT ?`).all(...keyParams, limit + 1);
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);
        const handles = handlesFor(page.map((r) => r.id));
        const items = page.map((r) => ({
            id: r.id,
            displayName: r.display_name,
            lastTs: r.last_ts_ms == null ? null : iso(r.last_ts_ms),
            lastChannel: r.last_channel ?? null,
            lastPreview: r.last_preview ?? "",
            lastFromMe: r.last_from_me == null ? false : Boolean(r.last_from_me),
            counts: r.counts_json ? JSON.parse(r.counts_json) : emptyCounts(),
            countTotal: r.count_total ?? 0,
            handles: handles.get(r.id) ?? [],
        }));
        const last = page.at(-1);
        return { items, nextCursor: hasMore ? encodeCursor({ ts: last.last_ts_ms ?? 0, id: last.id }) : null, hasMore, total };
    }

    function getContact(id) {
        const c = activeContact(id);
        const s = q.summary.get(id);
        return {
            id: c.id, displayName: c.display_name, origin: c.origin,
            counts: s ? JSON.parse(s.counts_json) : emptyCounts(), countTotal: s?.count_total ?? 0,
            handles: handlesFor([id]).get(id) ?? [],
            ...(replyChannels ? { replyChannels: replyChannels(id) } : {}),
        };
    }

    function getThread(contactId, { before, limit, channel }) {
        activeContact(contactId);
        const handles = q.handles.all(contactId).map((r) => r.handle_norm);
        if (!handles.length) return { items: [], nextCursor: null, hasMore: false };
        const params = [...handles];
        let sql = `SELECT * FROM messages WHERE handle_norm IN (${handles.map(() => "?").join(",")})`;
        if (channel) { sql += " AND channel = ?"; params.push(channel); }
        if (before) {
            const cur = decodeCursor(before, { ts: "number", id: "string" });
            sql += " AND (ts_ms < ? OR (ts_ms = ? AND id < ?))";
            params.push(cur.ts, cur.ts, cur.id);
        }
        sql += " ORDER BY ts_ms DESC, id DESC LIMIT ?";
        const rows = db.prepare(sql).all(...params, limit + 1);
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);
        // group chats: the sender's name when we know it (their contact), else their number
        const senders = [...new Set(page.map((m) => JSON.parse(m.meta_json || "{}").sender).filter(Boolean))];
        const senderNames = new Map();
        if (senders.length) {
            for (const r of db.prepare(`SELECT ch.handle_norm h, c.display_name n FROM contact_handles ch JOIN contacts c ON c.id = ch.contact_id WHERE ch.handle_norm IN (${senders.map(() => "?").join(",")})`).all(...senders)) senderNames.set(r.h, r.n === r.h ? formatHandle(r.h) : r.n);
        }
        const items = page.map((m) => {
            const meta = JSON.parse(m.meta_json || "{}");
            return {
                id: m.id, channel: m.channel, isFromMe: Boolean(m.is_from_me), ts: iso(m.ts_ms),
                ...(m.subject ? { subject: m.subject } : {}), text: m.text,
                ...(meta.isSummary ? { isSummary: true } : {}),
                attachments: JSON.parse(m.attachments_json), counterpartHandle: m.handle_norm,
                ...(meta.sender ? { sender: meta.sender, senderName: senderNames.get(meta.sender) ?? formatHandle(meta.sender) } : {}),
            };
        });
        const last = page.at(-1);
        return { items, nextCursor: hasMore ? encodeCursor({ ts: last.ts_ms, id: last.id }) : null, hasMore };
    }

    function search({ q: text, channel, contactId, limit, cursor }) {
        const match = ftsQuery(text);
        if (!match) return { items: [], nextCursor: null, hasMore: false };
        const params = [match];
        let inner = `SELECT m.id, m.channel, m.ts_ms, c.id AS contact_id, c.display_name AS contact_name,
                bm25(messages_fts, ${TEXT_WEIGHT}, ${SUBJECT_WEIGHT}) AS rank,
                snippet(messages_fts, 0, char(1), char(2), '…', 24) AS snippet
            FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
            JOIN contact_handles ch ON ch.handle_norm = m.handle_norm JOIN contacts c ON c.id = ch.contact_id
            WHERE messages_fts MATCH ?`;
        if (channel) { inner += " AND m.channel = ?"; params.push(channel); }
        if (contactId) { inner += " AND c.id = ?"; params.push(contactId); }
        let sql = `SELECT * FROM (${inner})`;
        if (cursor) {
            const cur = decodeCursor(cursor, { rank: "number", ts: "number", id: "string" });
            sql += " WHERE (rank > ? OR (rank = ? AND (ts_ms < ? OR (ts_ms = ? AND id < ?))))";
            params.push(cur.rank, cur.rank, cur.ts, cur.ts, cur.id);
        }
        sql += " ORDER BY rank ASC, ts_ms DESC, id DESC LIMIT ?";
        const rows = db.prepare(sql).all(...params, limit + 1);
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);
        const items = page.map((r) => ({ messageId: r.id, contactId: r.contact_id, contactName: r.contact_name, channel: r.channel, ts: iso(r.ts_ms), snippet: limitSnippet(r.snippet) }));
        const last = page.at(-1);
        return { items, nextCursor: hasMore ? encodeCursor({ rank: last.rank, ts: last.ts_ms, id: last.id }) : null, hasMore };
    }

    return { listContacts, getContact, getThread, search };
}
