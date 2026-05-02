/**
 * {reply} - Chat Utilities
 * Helpers for message parsing, channel inference, and handle normalization.
 */

function safeDateMs(v) {
    try {
        const d = new Date(v);
        const t = d.getTime();
        return Number.isFinite(t) ? t : 0;
    } catch {
        return 0;
    }
}

const { parsePhoneNumberFromString } = require('libphonenumber-js');

function normalizePhone(phone) {
    if (!phone) return null;
    const raw = String(phone).trim();
    if (!raw) return null;

    let cleaned = raw.replace(/[^\d+]/g, "");
    if (cleaned.startsWith("00")) cleaned = `+${cleaned.slice(2)}`;

    try {
        const phoneNumber = parsePhoneNumberFromString(cleaned, 'HU');
        if (phoneNumber && phoneNumber.isValid()) {
            return phoneNumber.number; // e.g. +36701234567
        }
    } catch (e) { }

    const digits = cleaned.replace(/\D/g, "");
    if (digits.length < 6) return null;
    return "+" + digits;
}

function normalizeEmail(email) {
    if (!email) return null;
    const v = String(email).trim().toLowerCase();
    return v.includes("@") ? v : null;
}

function inferChannelFromHandle(handle, fallback = "imessage") {
    const h = String(handle || "");
    if (h.includes("@")) return "email";
    if (h.includes("-")) return "whatsapp";
    if (/^\d{11,}$/.test(h.replace(/\D/g, ""))) return "whatsapp";
    return fallback;
}

function inferSourceFromChannel(channel) {
    const c = String(channel || "").toLowerCase();
    if (c === "whatsapp") return "WhatsApp";
    if (c === "email") return "Mail";
    if (c === "imessage") return "iMessage";
    if (c === "telegram") return "Telegram";
    if (c === "discord") return "Discord";
    if (c === "signal") return "Signal";
    if (c === "viber") return "Viber";
    if (c === "linkedin") return "LinkedIn";
    return null;
}

function stripPathScheme(p) {
    return String(p || "").replace(/^(imessage:\/\/|whatsapp:\/\/|mailto:|telegram:\/\/|discord:\/\/|signal:\/\/|viber:\/\/|linkedin:\/\/)/i, "").trim();
}

function pathPrefixesForHandle(handle) {
    if (!handle || typeof handle !== "string") return [];
    const h = handle.trim();
    if (!h) return [];
    if (h.includes("@")) return [`mailto:${h}`];

    const variants = new Set();
    const clean = stripPathScheme(h);
    variants.add(clean);
    const normalized = normalizePhone(clean);
    if (normalized) variants.add(normalized);

    const out = [];
    for (const v of variants) {
        out.push(`imessage://${v}`);
        out.push(`whatsapp://${v}`);
        out.push(`telegram://${v}`);
        out.push(`discord://${v}`);
        out.push(`signal://${v}`);
        out.push(`viber://${v}`);
        out.push(`linkedin://${v}`);
    }
    return out;
}

function extractDateFromText(text) {
    if (!text || typeof text !== "string") return null;
    const m = text.match(/\[(.*?)\]/);
    if (!m) return null;
    const raw = String(m[1] || "").trim();
    if (!raw) return null;
    let d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
    // SQLite `datetime(..., 'localtime')` and other space-separated forms
    if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/.test(raw)) {
        d = new Date(raw.replace(/\s+/, "T"));
        if (!Number.isNaN(d.getTime())) return d;
    }
    const normalizedNatural = raw
        .replace(/^[A-Za-z]+,\s*/, "")
        .replace(/\s+at\s+/i, " ")
        .trim();
    if (normalizedNatural && normalizedNatural !== raw) {
        d = new Date(normalizedNatural);
        if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
}

/**
 * Classify indexed line `[ts] Sender: body` — "me" only from the sender token, not from quoted `] Me:` in the body.
 * @param {string} text
 * @returns {"me"|"contact"|null}
 */
function inferRoleFromIndexedLine(text) {
    const t = String(text || "");
    const m = t.match(/^\[[^\]]+\]\s*([^:\n]+?):\s*/);
    if (!m) return null;
    const who = String(m[1] || "").trim();
    if (!who) return null;
    if (who === "Me" || /^me$/i.test(who)) return "me";
    return "contact";
}

function parseVectorDocSequenceId(doc) {
    const id = String(doc?.id || "");
    const msg = id.match(/(?:^|-)msg-(\d+)$/i) || id.match(/msg-(\d+)/i);
    if (msg) return Number(msg[1]) || 0;
    return 0;
}

/**
 * Latest inbound message body + channel from vector rows (suggest + background draft queue).
 * @param {Array<{ id?: string, text?: string, path?: string, source?: string }>} docs
 * @returns {{ text: string, channel: string } | null}
 */
function pickLatestInboundFromVectorDocs(docs) {
    const rows = (Array.isArray(docs) ? docs : [])
        .map((d) => {
            const raw = String(d.text || "");
            const role = inferRoleFromIndexedLine(raw) ?? (raw.includes("] Me:") ? "me" : "contact");
            const date = extractDateFromText(raw);
            const text = stripMessagePrefix(raw).trim();
            const seq = parseVectorDocSequenceId(d);
            return { d, role, date, text, seq };
        })
        .filter((r) => r.text && r.role === "contact");

    if (rows.length === 0) return null;

    rows.sort((a, b) => {
        const ta = a.date ? a.date.getTime() : 0;
        const tb = b.date ? b.date.getTime() : 0;
        if (tb !== ta) return tb - ta;
        return b.seq - a.seq;
    });

    const best = rows[0];
    return {
        text: best.text,
        channel: channelFromDoc(best.d)
    };
}

function stripMessagePrefix(text) {
    if (!text || typeof text !== "string") return "";
    const idx = text.indexOf(": ");
    return idx >= 0 ? text.slice(idx + 2) : text;
}

function channelFromDoc(doc) {
    const p = (doc?.path || "").toString().toLowerCase();
    const s = (doc?.source || "").toString().toLowerCase();
    if (p.startsWith("whatsapp://") || s.includes("whatsapp")) return "whatsapp";
    if (p.startsWith("mailto:") || s.includes("mail") || s.includes("email")) return "email";
    if (p.startsWith("imessage://") || s.includes("imessage")) return "imessage";
    if (p.startsWith("telegram://") || s.includes("telegram")) return "telegram";
    if (p.startsWith("discord://") || s.includes("discord")) return "discord";
    if (p.startsWith("signal://") || s.includes("signal")) return "signal";
    if (p.startsWith("viber://") || s.includes("viber")) return "viber";
    if (p.startsWith("linkedin://") || s.includes("linkedin")) return "linkedin";
    return "imessage";
}

function isCommunicationChannel(channel) {
    const c = String(channel || "").toLowerCase().trim();
    return new Set([
        "imessage",
        "whatsapp",
        "email",
        "linkedin",
        "telegram",
        "discord",
        "signal",
        "viber"
    ]).has(c);
}

function isConversationDataSource(doc) {
    const path = String(doc?.path || "").toLowerCase().trim();
    const source = String(doc?.source || "").toLowerCase().trim();
    if (
        path.startsWith("imessage://") ||
        path.startsWith("whatsapp://") ||
        path.startsWith("mailto:") ||
        path.startsWith("email://") ||
        path.startsWith("linkedin://") ||
        path.startsWith("telegram://") ||
        path.startsWith("discord://") ||
        path.startsWith("signal://") ||
        path.startsWith("viber://")
    ) {
        return true;
    }
    return new Set([
        "imessage",
        "imessage-live",
        "whatsapp",
        "mail",
        "gmail",
        "imap",
        "linkedin",
        "telegram",
        "discord",
        "signal",
        "viber"
    ]).has(source);
}

function buildSearchHaystack(contact, convo) {
    const parts = [];
    const c = contact || {};
    const cv = convo || {};
    parts.push(c.displayName, c.name, c.handle);
    if (Array.isArray(c.aliases)) parts.push(...c.aliases);
    if (c.channels?.phone) parts.push(...c.channels.phone);
    if (c.channels?.email) parts.push(...c.channels.email);
    parts.push(cv.channel, cv.source, cv.latestHandle);
    return parts.filter(Boolean).map((v) => String(v)).join(" ").toLowerCase();
}

function matchesQuery(haystack, q) {
    const query = (q ?? "").toString().trim().toLowerCase();
    if (!query) return true;
    const tokens = query.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;
    const hs = (haystack || "").toString();
    const hsDigits = hs.replace(/\D/g, "");
    for (const t of tokens) {
        const td = t.replace(/\D/g, "");
        if (td.length >= 5) {
            if (!hsDigits.includes(td)) return false;
            continue;
        }
        if (!hs.includes(t)) return false;
    }
    return true;
}

module.exports = {
    safeDateMs,
    normalizePhone,
    normalizeEmail,
    inferChannelFromHandle,
    inferSourceFromChannel,
    stripPathScheme,
    pathPrefixesForHandle,
    extractDateFromText,
    stripMessagePrefix,
    channelFromDoc,
    isCommunicationChannel,
    isConversationDataSource,
    inferRoleFromIndexedLine,
    pickLatestInboundFromVectorDocs,
    buildSearchHaystack,
    matchesQuery
};
