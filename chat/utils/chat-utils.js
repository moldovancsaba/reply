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
    const d = new Date(m[1]);
    return Number.isNaN(d.getTime()) ? null : d;
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
    buildSearchHaystack,
    matchesQuery
};
