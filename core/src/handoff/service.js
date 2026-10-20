import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import { formatHandle } from "../identity/normalize.js";
import { CHANNELS } from "../storage/repo.js";

// A handoff (the "open in the app instead" path; the app can also send itself, see src/send) validates the recipient, builds a link that opens the right macOS app with the
// text prefilled, and records that it happened (length only, never the text). The human presses send in that app.
export const MAX_TEXT = 1500; // above this the body would not survive a URL reliably: the UI copies it instead
const MAX_INPUT = 10_000;
const MAX_URL = 2000;
const MAX_SUBJECT = 300;

const NOTE = {
    imessage: "Opens Messages with your text. Reply Core does not send it.",
    email: "Opens Mail with your text. Reply Core does not send it.",
    whatsapp: "Opens WhatsApp with your text. Reply Core does not send it.",
};

// Which stored handles can receive a message on a channel. iMessage reaches phone numbers and email addresses;
// email only addresses; WhatsApp only WhatsApp handles. Group chats and opaque ids can never be a recipient.
export const handleKindsFor = { imessage: ["phone", "email"], email: ["email"], whatsapp: ["whatsapp"] };

export function buildUrl(channel, handle, text, subject) {
    const enc = encodeURIComponent;
    switch (channel) {
        case "imessage":
            return `sms:${enc(handle)}${text ? `&body=${enc(text)}` : ""}`;
        case "email": {
            const parts = [];
            if (subject) parts.push(`subject=${enc(subject)}`);
            if (text) parts.push(`body=${enc(text)}`);
            return `mailto:${enc(handle)}${parts.length ? `?${parts.join("&")}` : ""}`;
        }
        case "whatsapp":
            return `https://wa.me/${handle.replace(/\D/g, "")}${text ? `?text=${enc(text)}` : ""}`;
        default:
            throw new Error(`unknown channel ${channel}`);
    }
}

export function createHandoff({ db, now = () => Date.now() }) {
    const q = {
        contact: db.prepare("SELECT id, merged_into FROM contacts WHERE id = ?"),
        handles: db.prepare("SELECT h.handle_norm, h.kind FROM contact_handles ch JOIN handles h ON h.handle_norm = ch.handle_norm WHERE ch.contact_id = ? ORDER BY h.handle_norm"),
        insert: db.prepare("INSERT INTO handoffs (id, ts_ms, contact_id, channel, handle_kind, text_length) VALUES (?,?,?,?,?,?)"),
        lastUsed: (n) => db.prepare(`SELECT handle_norm FROM messages WHERE channel = ? AND handle_norm IN (${new Array(n).fill("?").join(",")}) ORDER BY ts_ms DESC, id DESC LIMIT 1`),
    };

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

    // Channels a reply can be handed off to for this contact, with the usable handles of each. `default` marks the
    // handle used in the most recent message on that channel (else the first).
    function channelsFor(contactId) {
        const handles = q.handles.all(contactId);
        const out = [];
        for (const channel of CHANNELS) {
            const usable = handles.filter((h) => handleKindsFor[channel].includes(h.kind));
            if (!usable.length) continue;
            const names = usable.map((h) => h.handle_norm);
            const last = q.lastUsed(names.length).get(channel, ...names)?.handle_norm ?? names[0];
            out.push({ channel, handles: usable.map((h) => ({ value: h.handle_norm, label: formatHandle(h.handle_norm), default: h.handle_norm === last })) });
        }
        return out;
    }

    // The one place that decides who a message may go to: always one of the contact's own stored handles of the right
    // kind for the channel, never a value taken from the request.
    function resolve({ contactId, channel, handle }) {
        if (!CHANNELS.includes(channel)) throw new AppError(400, "invalid_request", `channel must be one of ${CHANNELS.join(", ")}.`);
        activeContact(contactId);
        const available = channelsFor(contactId);
        const entry = available.find((c) => c.channel === channel);
        if (!entry) {
            const err = new AppError(422, "no_handle_for_channel", "This person has no address for that channel in Reply Core.");
            err.details = { availableChannels: available.map((c) => c.channel) };
            throw err;
        }
        let chosen = entry.handles.find((h) => h.default);
        if (handle !== undefined) {
            chosen = entry.handles.find((h) => h.value === handle);
            if (!chosen) throw new AppError(422, "handle_not_owned", "That address does not belong to this contact for that channel.");
        }
        return { chosen, kind: db.prepare("SELECT kind FROM handles WHERE handle_norm = ?").get(chosen.value).kind };
    }

    function handoff({ contactId, channel, handle, text, subject }) {
        if (!CHANNELS.includes(channel)) throw new AppError(400, "invalid_request", `channel must be one of ${CHANNELS.join(", ")}.`);
        if (typeof text !== "string") throw new AppError(400, "invalid_request", "text must be a string.");
        if (!text.trim()) throw new AppError(400, "text_empty", "Write a message first.");
        if (text.length > MAX_INPUT) throw new AppError(413, "text_too_long", `Messages over ${MAX_INPUT.toLocaleString("en-US")} characters cannot be handed off.`);
        if (subject !== undefined && (typeof subject !== "string" || subject.length > MAX_SUBJECT)) throw new AppError(400, "invalid_request", `subject must be text of at most ${MAX_SUBJECT} characters.`);
        const { chosen, kind } = resolve({ contactId, channel, handle });
        const full = buildUrl(channel, chosen.value, text, subject);
        const copy = full.length > MAX_URL || text.length > MAX_TEXT;
        const id = `h_${randomUUID().slice(0, 12)}`;
        db.transaction(() => q.insert.run(id, now(), contactId, channel, kind, text.length))();
        return {
            handoffId: id, action: copy ? "copy_and_open" : "open_url", url: copy ? buildUrl(channel, chosen.value, "", subject) : full,
            channel, handleLabel: chosen.label, note: NOTE[channel],
        };
    }

    return { handoff, channelsFor, resolve };
}
