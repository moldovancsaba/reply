/**
 * Reply-only outbound: allow sends only to identities that have inbound proof
 * (contact_channels.inbound_verified_at via hydrated verifiedChannels).
 */
const fs = require("fs");
const path = require("path");
const contactStore = require("../contact-store.js");

function policyEnabled() {
  const v = String(process.env.REPLY_OUTBOUND_REQUIRE_INBOUND_VERIFIED ?? "true").toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
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
    .replace(/^linkedin:\/\//i, "");
}

/**
 * @param {string} channel
 * @param {string} recipientRaw
 * @param {{ verifiedChannels?: Record<string, string> } | null} contact
 */
function checkOutboundAllowedForContact(channel, recipientRaw, contact) {
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

  const verified = contact.verifiedChannels || {};
  const keys = Object.entries(verified).filter(([, ts]) => Boolean(ts));
  if (keys.length === 0) {
    return {
      allowed: false,
      code: "no_inbound_proof",
      reason: "This contact has no inbound-verified channel addresses yet.",
      hint: "Receive an inbound message on this channel so Reply can record proof, then try again.",
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
      hint: "Reply only to addresses that have already emailed you on this contact.",
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
      if (k === want || k.includes(want) || want.includes(k)) {
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
  appendOutboundDenial,
};
