/**
 * Reply-only outbound policy (GitHub: moldovancsaba/reply#17).
 *
 * Sends are allowed only to channel identities that already have inbound proof
 * (`contact_channels.inbound_verified_at`, surfaced on contacts as `verifiedChannels`).
 * Alias / merged rows (`primary_contact_id` pointing at the canonical contact) contribute
 * their verified addresses to the same gate. LinkedIn requires an exact match after
 * `normalizeLinkedinKey()` (scheme + URL stripping only — no substring unlock).
 *
 * Opt-in for production-style lockdown: `REPLY_OUTBOUND_REQUIRE_INBOUND_VERIFIED=true` (see `chat/.env.example`).
 * When unset or false, this gate is off — sends are not blocked here (other layers may still apply).
 * Denials are logged via `appendOutboundDenial()` to the app-owned outbound-policy-denials log.
 */
const fs = require("fs");
const path = require("path");
const contactStore = require("../contact-store.js");

function policyEnabled() {
  const v = String(process.env.REPLY_OUTBOUND_REQUIRE_INBOUND_VERIFIED ?? "").trim().toLowerCase();
  if (!v) return false;
  return v === "1" || v === "true" || v === "yes";
}

function normalizeEmail(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function normalizePhoneDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function normalizeLinkedinKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/^linkedin:\/\//i, "")
    .replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//i, "")
    .replace(/\/$/, "");
}

/**
 * Union inbound-verified identities for a canonical contact plus any rows linked via
 * `primary_contact_id` (merged profiles / aliases).
 *
 * @param {{ id?: string, verifiedChannels?: Record<string, string> } | null} contact
 * @param {Array<{ id?: string, primary_contact_id?: string, verifiedChannels?: Record<string, string> }>} allContacts
 */
function mergeVerifiedChannelMaps(contact, allContacts) {
  const merged = { ...(contact?.verifiedChannels || {}) };
  if (!contact?.id || !Array.isArray(allContacts)) return merged;
  for (const c of allContacts) {
    if (!c || c.id === contact.id) continue;
    if (c.primary_contact_id !== contact.id) continue;
    for (const [addr, ts] of Object.entries(c.verifiedChannels || {})) {
      if (ts) merged[addr] = merged[addr] || ts;
    }
  }
  return merged;
}

/**
 * Core gate used by `checkOutboundAllowed()` after resolving the contact.
 *
 * @param {string} channel
 * @param {string} recipientRaw
 * @param {{ verifiedChannels?: Record<string, string>, id?: string } | null} contact
 * @param {{ contactsRoster?: Array<{ id?: string, primary_contact_id?: string, verifiedChannels?: Record<string, string> }> }} [options]
 *        When `contactsRoster` is set, it replaces `contactStore.contacts` for merge-only
 *        (unit tests). Production callers omit it.
 */
function checkOutboundAllowedForContact(channel, recipientRaw, contact, options = {}) {
  const ch = String(channel || "").toLowerCase();
  const raw = String(recipientRaw || "").trim();
  if (!raw) {
    return {
      allowed: false,
      code: "missing_recipient",
      reason: "Missing recipient.",
      hint: "Provide a concrete address or handle for this channel.",
    };
  }

  if (!contact) {
    return {
      allowed: false,
      code: "unknown_contact",
      reason: "No contact profile matches this recipient.",
      hint: "Create or sync a contact first, then wait for inbound on this channel/address.",
    };
  }

  const roster = options.contactsRoster || contactStore.contacts;
  const verified = mergeVerifiedChannelMaps(contact, roster);
  const keys = Object.entries(verified).filter(([, ts]) => Boolean(ts));
  if (keys.length === 0) {
    return {
      allowed: false,
      code: "no_inbound_proof",
      reason: "This contact has no inbound-verified channel addresses yet.",
      hint: "Receive an inbound message on this channel so {reply} can record proof, then try again.",
    };
  }

  if (ch === "email") {
    const want = normalizeEmail(raw);
    for (const [addr] of keys) {
      if (normalizeEmail(addr) === want) return { allowed: true, code: "ok" };
    }
    return {
      allowed: false,
      code: "email_not_verified",
      reason: `No inbound proof for email ${raw}.`,
      hint: "{reply} only sends to addresses that have already emailed you on this contact.",
    };
  }

  if (ch === "imessage" || ch === "whatsapp") {
    const wantDigits = normalizePhoneDigits(raw);
    const wantBare = raw.replace(/^whatsapp:\/\//i, "").split("@")[0].trim();
    const want2 = normalizePhoneDigits(wantBare);
    const candidates = new Set([wantDigits, want2].filter(Boolean));

    for (const [addr] of keys) {
      const d = normalizePhoneDigits(addr);
      if (!d) continue;
      for (const c of candidates) {
        if (c && (d === c || d.endsWith(c) || c.endsWith(d))) {
          return { allowed: true, code: "ok" };
        }
      }
    }
    return {
      allowed: false,
      code: "phone_not_verified",
      reason: `No inbound proof for this number on ${ch}.`,
      hint: "Wait for an inbound message from this number (or its verified alias) before replying.",
    };
  }

  if (ch === "linkedin") {
    const want = normalizeLinkedinKey(raw);
    for (const [addr] of keys) {
      const k = normalizeLinkedinKey(addr);
      if (!k) continue;
      if (k === want) {
        return { allowed: true, code: "ok" };
      }
    }
    return {
      allowed: false,
      code: "linkedin_not_verified",
      reason: "No inbound-verified LinkedIn identity matches this recipient.",
      hint: "Receive a LinkedIn message on a verified profile handle first.",
    };
  }

  return {
    allowed: false,
    code: "unsupported_channel",
    reason: `Outbound policy not implemented for channel: ${ch}`,
    hint: "Use email, imessage, whatsapp, or linkedin.",
  };
}

/**
 * @param {string} channel imessage | email | whatsapp | linkedin
 * @param {string} recipientRaw
 * @returns {{ allowed: boolean, code?: string, reason?: string, hint?: string }}
 */
function checkOutboundAllowed(channel, recipientRaw) {
  if (!policyEnabled()) {
    return { allowed: true, code: "policy_disabled" };
  }

  const raw = String(recipientRaw || "").trim();
  const contact =
    contactStore.findContact(raw) ||
    contactStore.findContact(normalizeEmail(raw)) ||
    null;

  return checkOutboundAllowedForContact(channel, raw, contact);
}

function appendOutboundDenial(entry) {
  try {
    const logPath = path.join(__dirname, "..", "data", "outbound-policy-denials.jsonl");
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const row = {
      ts: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(logPath, JSON.stringify(row) + "\n");
  } catch (e) {
    console.error("[outbound-policy] audit log failed:", e.message);
  }
}

module.exports = {
  policyEnabled,
  checkOutboundAllowed,
  checkOutboundAllowedForContact,
  mergeVerifiedChannelMaps,
  appendOutboundDenial,
};
