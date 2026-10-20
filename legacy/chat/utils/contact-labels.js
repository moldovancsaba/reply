const { normalizeEmail, normalizePhone } = require("./chat-utils.js");

function shortOpaque(value, keep = 8) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length <= keep * 2) return raw;
  return `${raw.slice(0, keep)}…${raw.slice(-Math.min(keep, 4))}`;
}

function looksPhoneLike(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /^[+\d\s().-]{7,}$/.test(raw);
}

function isOpaqueMachineIdentifier(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (normalizeEmail(raw) || (looksPhoneLike(raw) && normalizePhone(raw))) return false;
  if (/\s/.test(raw)) return false;
  if (/^https?:\/\//i.test(raw)) return false;
  if (/^[a-z0-9._-]{1,32}$/i.test(raw) && /[aeiou]/i.test(raw)) return false;
  if (/^\d{10,20}$/.test(raw)) return false;
  if (/^[a-z0-9+/=]{16,}$/i.test(raw)) return true;
  if (/^[a-z0-9_-]{20,}$/i.test(raw)) return true;
  return false;
}

function normalizeStoredDisplayName(displayName, handle = "") {
  const raw = String(displayName || "").trim();
  if (!raw) return "";
  const baseHandle = String(handle || "").trim();
  if (baseHandle && raw.toLowerCase() === baseHandle.toLowerCase()) return "";
  if (isOpaqueMachineIdentifier(raw)) return "";
  return raw;
}

function inferPresentationChannel(contact = {}, fallbackHandle = "") {
  const channel = String(
    contact.lastChannel ||
    contact.channel ||
    contact.lastSource ||
    contact.source ||
    ""
  ).trim().toLowerCase();
  if (channel) return channel;
  const handle = String(contact.latestHandle || contact.handle || fallbackHandle || "").trim();
  if (handle.includes("@")) return "email";
  if (/^\+?\d{7,}$/.test(handle.replace(/\s+/g, ""))) return "imessage";
  return "";
}

function presentContactLabel(contact = {}, options = {}) {
  const handle = String(options.handle || contact.latestHandle || contact.handle || "").trim();
  const stored = normalizeStoredDisplayName(contact.displayName || contact.name || "", handle);
  if (stored) return stored;

  const phone = Array.isArray(contact.channels?.phone)
    ? contact.channels.phone.find((value) => normalizePhone(value))
    : null;
  if (phone) return normalizePhone(phone) || phone;

  const email = Array.isArray(contact.channels?.email)
    ? contact.channels.email.find((value) => normalizeEmail(value))
    : null;
  if (email) return normalizeEmail(email) || email;

  if (normalizeEmail(handle)) return normalizeEmail(handle) || handle;
  if (looksPhoneLike(handle) && normalizePhone(handle)) return normalizePhone(handle) || handle;

  const channel = inferPresentationChannel(contact, handle);
  if (channel === "whatsapp") {
    return `WhatsApp · ${shortOpaque(handle, 8)}`;
  }
  if (channel === "linkedin") {
    return `LinkedIn · ${shortOpaque(handle, 8)}`;
  }
  if (channel === "telegram") {
    return `Telegram · ${shortOpaque(handle, 8)}`;
  }
  if (channel === "discord") {
    return `Discord · ${shortOpaque(handle, 8)}`;
  }
  return shortOpaque(handle, 8) || "Unknown contact";
}

module.exports = {
  isOpaqueMachineIdentifier,
  normalizeStoredDisplayName,
  presentContactLabel,
};
