import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import { formatHandle } from "../identity/normalize.js";
import { CHANNELS } from "../storage/repo.js";

const bad = (message) => new AppError(400, "invalid_request", message);
export const LIMITS = { profession: 200, company: 200, relationship: 100, linkedinUrl: 300, intro: 2000, note: 4000 };
const FIELDS = ["profession", "company", "relationship", "linkedinUrl", "intro"];
const MAX_NOTES = 200;
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

// "Who is this person": what the address book says (imported), what the user wrote (profile fields, notes), and facts
// computed from the messages. Nothing here leaves the Mac and nothing is guessed.
export function createProfile({ db, now = () => Date.now() }) {
    const q = {
        contact: db.prepare("SELECT id, display_name, origin, merged_into FROM contacts WHERE id = ?"),
        details: db.prepare("SELECT json FROM contact_details WHERE contact_id = ?"),
        profile: db.prepare("SELECT * FROM contact_profile WHERE contact_id = ?"),
        upsertProfile: db.prepare(`INSERT INTO contact_profile (contact_id, profession, company, relationship, linkedin_url, intro, updated_ms) VALUES (@id, @profession, @company, @relationship, @linkedinUrl, @intro, @now)
            ON CONFLICT(contact_id) DO UPDATE SET profession = @profession, company = @company, relationship = @relationship, linkedin_url = @linkedinUrl, intro = @intro, updated_ms = @now`),
        notes: db.prepare("SELECT id, text, created_ms FROM contact_notes WHERE contact_id = ? ORDER BY created_ms DESC, rowid DESC"),
        noteCount: db.prepare("SELECT COUNT(*) n FROM contact_notes WHERE contact_id = ?"),
        insertNote: db.prepare("INSERT INTO contact_notes (id, contact_id, text, created_ms) VALUES (?, ?, ?, ?)"),
        deleteNote: db.prepare("DELETE FROM contact_notes WHERE id = ? AND contact_id = ?"),
        handles: db.prepare(`SELECT h.handle_norm, h.kind, ch.link_origin, COUNT(m.id) n, MAX(m.ts_ms) last_ms
            FROM contact_handles ch JOIN handles h ON h.handle_norm = ch.handle_norm LEFT JOIN messages m ON m.handle_norm = h.handle_norm
            WHERE ch.contact_id = ? GROUP BY h.handle_norm ORDER BY n DESC, h.handle_norm`),
        byChannel: db.prepare(`SELECT m.channel, COUNT(*) total, SUM(m.is_from_me) sent, MIN(NULLIF(m.ts_ms, 0)) first_ms, MAX(m.ts_ms) last_ms
            FROM messages m JOIN contact_handles ch ON ch.handle_norm = m.handle_norm WHERE ch.contact_id = ? GROUP BY m.channel`),
        lastBy: db.prepare(`SELECT m.is_from_me f, MAX(m.ts_ms) t FROM messages m JOIN contact_handles ch ON ch.handle_norm = m.handle_norm WHERE ch.contact_id = ? GROUP BY m.is_from_me`),
        recent: db.prepare(`SELECT COUNT(*) n FROM messages m JOIN contact_handles ch ON ch.handle_norm = m.handle_norm WHERE ch.contact_id = ? AND m.ts_ms >= ?`),
        mergedFrom: db.prepare("SELECT display_name FROM contacts WHERE merged_into = ? ORDER BY display_name"),
    };

    function visible(id) {
        const c = q.contact.get(id);
        if (!c) throw new AppError(404, "contact_not_found", "That contact does not exist.");
        if (c.merged_into) {
            const err = new AppError(404, "contact_not_found", "That contact was merged into another one.");
            err.details = { mergedInto: c.merged_into };
            throw err;
        }
        return c;
    }

    function profileOf(id) {
        const p = q.profile.get(id);
        return { profession: p?.profession ?? "", company: p?.company ?? "", relationship: p?.relationship ?? "", linkedinUrl: p?.linkedin_url ?? "", intro: p?.intro ?? "", updatedAt: iso(p?.updated_ms) };
    }

    function get(id) {
        const c = visible(id);
        const byChannel = Object.fromEntries(CHANNELS.map((ch) => [ch, { total: 0, sent: 0, received: 0, firstTs: null, lastTs: null }]));
        let total = 0;
        let sent = 0;
        let firstMs = null;
        let lastMs = null;
        for (const r of q.byChannel.all(id)) {
            byChannel[r.channel] = { total: r.total, sent: r.sent, received: r.total - r.sent, firstTs: iso(r.first_ms), lastTs: iso(r.last_ms) };
            total += r.total;
            sent += r.sent;
            if (r.first_ms && (firstMs === null || r.first_ms < firstMs)) firstMs = r.first_ms;
            if (lastMs === null || r.last_ms > lastMs) lastMs = r.last_ms;
        }
        const last = Object.fromEntries(q.lastBy.all(id).map((r) => [r.f ? "sent" : "received", r.t]));
        const day = 86_400_000;
        return {
            id: c.id,
            displayName: c.display_name,
            origin: c.origin,
            card: JSON.parse(q.details.get(id)?.json ?? "{}"),
            profile: profileOf(id),
            notes: q.notes.all(id).map((n) => ({ id: n.id, text: n.text, createdAt: iso(n.created_ms) })),
            handles: q.handles.all(id).map((h) => ({ value: h.handle_norm, label: formatHandle(h.handle_norm), kind: h.kind, origin: h.link_origin, messages: h.n, lastTs: iso(h.last_ms) })),
            stats: {
                total, sent, received: total - sent, firstTs: iso(firstMs), lastTs: iso(lastMs),
                lastSentTs: iso(last.sent), lastReceivedTs: iso(last.received),
                last30Days: q.recent.get(id, now() - 30 * day).n,
                byChannel,
            },
            mergedFrom: q.mergedFrom.all(id).map((r) => r.display_name),
        };
    }

    function text(body, key) {
        const v = body[key];
        if (v === undefined) return undefined;
        if (typeof v !== "string") throw bad(`${key} must be text.`);
        const t = v.trim();
        if (t.length > LIMITS[key]) throw bad(`${key} must be at most ${LIMITS[key]} characters.`);
        return t;
    }

    function setProfile(id, body) {
        visible(id);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("Body must be an object.");
        const extra = Object.keys(body).find((k) => !FIELDS.includes(k));
        if (extra) throw bad(`Unknown field: ${extra}.`);
        const next = { ...profileOf(id) };
        for (const k of FIELDS) { const v = text(body, k); if (v !== undefined) next[k] = v; }
        if (next.linkedinUrl) {
            let u;
            try { u = new URL(next.linkedinUrl); } catch { throw bad("linkedinUrl must be a web address (https://...)."); }
            if (u.protocol !== "https:" && u.protocol !== "http:") throw bad("linkedinUrl must be a web address (https://...).");
        }
        q.upsertProfile.run({ id, ...next, now: now() });
        return profileOf(id);
    }

    function addNote(id, body) {
        visible(id);
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => k !== "text")) throw bad('Body must be {"text": "..."}.');
        if (typeof body.text !== "string" || !body.text.trim()) throw bad("A note cannot be empty.");
        if (body.text.length > LIMITS.note) throw bad(`A note must be at most ${LIMITS.note} characters.`);
        if (q.noteCount.get(id).n >= MAX_NOTES) throw new AppError(409, "too_many_notes", `A contact can have at most ${MAX_NOTES} notes. Delete some first.`);
        const note = { id: `n_${randomUUID()}`, text: body.text.trim(), createdMs: now() };
        q.insertNote.run(note.id, id, note.text, note.createdMs);
        return { id: note.id, text: note.text, createdAt: iso(note.createdMs) };
    }

    function deleteNote(id, noteId) {
        visible(id);
        if (q.deleteNote.run(noteId, id).changes === 0) throw new AppError(404, "note_not_found", "That note does not exist.");
        return { deleted: true };
    }

    return { get, setProfile, addNote, deleteNote };
}
