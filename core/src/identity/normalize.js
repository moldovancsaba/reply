import { getCountries, parsePhoneNumberFromString } from "libphonenumber-js/min";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cache = new Map();
const CACHE_MAX = 10_000;

export const isRegion = (r) => typeof r === "string" && getCountries().includes(r);

function e164(raw, region) {
    const p = parsePhoneNumberFromString(String(raw).trim(), region);
    if (!p || !p.isPossible()) return null; // an extension, if any, is dropped (p.number is E.164 only)
    return p.number;
}

function compute(raw, hint, region) {
    let s = String(raw ?? "").normalize("NFC").trim();
    if (!s) return null;
    const lower = s.toLowerCase();

    if (lower.startsWith("group:")) {
        const rest = s.slice(6).trim();
        return rest ? { handle_norm: `group:${rest}`, kind: "other" } : null;
    }
    if (lower.startsWith("other:")) {
        const rest = lower.slice(6).trim();
        return rest ? { handle_norm: `other:${rest}`, kind: "other" } : null;
    }
    // WhatsApp ids: <digits>@s.whatsapp.net or @c.us (individual), @g.us (group), @lid (opaque)
    const wa = /^([^@\s]+)@(s\.whatsapp\.net|c\.us|g\.us|lid|wa)$/.exec(lower);
    if (wa || hint === "whatsapp") {
        const [user, domain] = wa ? [wa[1], wa[2]] : [lower.replace(/@.*$/, ""), "s.whatsapp.net"];
        if (domain === "g.us") return { handle_norm: `group:${lower}`, kind: "other" };
        if (domain === "lid") return { handle_norm: `other:${lower}`, kind: "other" };
        const num = e164(user.startsWith("+") ? user : `+${user}`, region);
        return num ? { handle_norm: `${num}@wa`, kind: "whatsapp" } : { handle_norm: `other:${lower}`, kind: "other" };
    }
    if (hint === "email" || (hint !== "phone" && s.includes("@")) || lower.startsWith("mailto:")) {
        s = s.replace(/^mailto:/i, "");
        const q = s.indexOf("?");
        if (q >= 0) s = s.slice(0, q); // mailto query (subject=...)
        s = s.trim().toLowerCase();
        return EMAIL.test(s) ? { handle_norm: s, kind: "email" } : null;
    }
    if (/^tel:/i.test(s)) s = s.slice(4);
    let num = e164(s, region);
    // Messages sometimes stores a full international number without the "+" ("36301234567"): retry as international.
    if (!num && /^[\d\s().-]{7,}$/.test(s) && !s.trim().startsWith("0")) num = e164(`+${s.replace(/\D/g, "")}`, region);
    if (num) return { handle_norm: num, kind: "phone" };
    return hint === "phone" ? null : { handle_norm: `other:${lower}`, kind: "other" };
}

// Returns { handle_norm, kind } or null when the input cannot be a handle. Pure and cached.
//   phone    -> E.164 ("+36301234567"); numbers without a country code use `region`
//   email    -> trimmed, lowercased, `mailto:` stripped. Gmail dots and +tags are NOT altered.
//   whatsapp -> "<e164>@wa" (1:1); groups -> "group:<jid>"
//   other    -> "other:<trimmed lowercase raw>"
export function normalizeHandle(raw, hint, region = "HU") {
    const key = `${region}|${hint ?? ""}|${raw}`;
    if (cache.has(key)) return cache.get(key);
    const out = compute(raw, hint, region);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, out);
    return out;
}

// Human display form: international phone format, everything else as stored.
export function formatHandle(handleNorm) {
    const wa = handleNorm.endsWith("@wa");
    const base = wa ? handleNorm.slice(0, -3) : handleNorm;
    if (base.startsWith("+")) {
        const p = parsePhoneNumberFromString(base);
        if (p) return wa ? `${p.formatInternational()} (WhatsApp)` : p.formatInternational();
    }
    return handleNorm.replace(/^(group|other):/, "");
}
