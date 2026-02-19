const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "data", "settings.json");
const CHANNEL_BRIDGE_MODES = new Set(["disabled", "draft_only"]);
const CHANNEL_BRIDGE_CHANNELS = ["telegram", "discord", "signal", "viber", "linkedin"];

function normalizeChannelBridgeMode(value, fallback = "disabled") {
  const v = String(value || "").trim().toLowerCase();
  if (CHANNEL_BRIDGE_MODES.has(v)) return v;
  return fallback;
}

function withDefaults(settings) {
  const s = settings && typeof settings === "object" ? settings : {};
  const bridgeChannels = {};
  for (const channel of CHANNEL_BRIDGE_CHANNELS) {
    bridgeChannels[channel] = {
      inboundMode: normalizeChannelBridgeMode(
        s?.channelBridge?.channels?.[channel]?.inboundMode,
        "draft_only"
      ),
    };
  }
  return {
    ...s,
    channelBridge: {
      channels: bridgeChannels,
    },
    gmail: {
      ...(s?.gmail || {}),
      sync: {
        ...(s?.gmail?.sync || {}),
        scope: (s?.gmail?.sync?.scope || "inbox_sent").toString(),
        query: (s?.gmail?.sync?.query || "").toString(),
      },
    },
    worker: {
      pollIntervalSeconds: Number(s?.worker?.pollIntervalSeconds) || 60,
      quantities: {
        imessage: Number(s?.worker?.quantities?.imessage) || 1000,
        whatsapp: Number(s?.worker?.quantities?.whatsapp) || 500,
        gmail: Number(s?.worker?.quantities?.gmail) || 100,
        notes: Number(s?.worker?.quantities?.notes) || 0,
      },
    },
    ui: {
      channels: {
        imessage: {
          emoji: (s?.ui?.channels?.imessage?.emoji || "💬").toString(),
          bubbleMe: (s?.ui?.channels?.imessage?.bubbleMe || "#0a84ff").toString(),
          bubbleContact: (s?.ui?.channels?.imessage?.bubbleContact || "#262628").toString(),
        },
        whatsapp: {
          emoji: (s?.ui?.channels?.whatsapp?.emoji || "🟢").toString(),
          bubbleMe: (s?.ui?.channels?.whatsapp?.bubbleMe || "#25D366").toString(),
          bubbleContact: (s?.ui?.channels?.whatsapp?.bubbleContact || "#262628").toString(),
        },
        email: {
          emoji: (s?.ui?.channels?.email?.emoji || "📧").toString(),
          bubbleMe: (s?.ui?.channels?.email?.bubbleMe || "#5e5ce6").toString(),
          bubbleContact: (s?.ui?.channels?.email?.bubbleContact || "#262628").toString(),
        },
        linkedin: {
          emoji: (s?.ui?.channels?.linkedin?.emoji || "🟦").toString(),
          bubbleMe: (s?.ui?.channels?.linkedin?.bubbleMe || "#0077b5").toString(),
          bubbleContact: (s?.ui?.channels?.linkedin?.bubbleContact || "#262628").toString(),
        },
      },
    },
  };
}

function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } catch (e) {
    console.warn("[Settings] Failed to read settings.json:", e.message);
    return {};
  }
}

function writeSettings(next) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${SETTINGS_PATH}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_PATH);
  try {
    fs.chmodSync(SETTINGS_PATH, 0o600);
  } catch {
    // Best-effort hardening: avoid failing settings writes on chmod issues.
  }
}

function maskSecret(value) {
  if (!value) return { has: false, hint: "" };
  const s = String(value);
  if (!s.trim()) return { has: false, hint: "" };
  return { has: true, hint: s.slice(-2) };
}

function maskSettingsForClient(settings) {
  const cfg = withDefaults(settings);
  const imap = cfg?.imap || {};
  const gmail = cfg?.gmail || {};
  const worker = cfg?.worker || {};
  const ui = cfg?.ui || {};
  const channelBridge = cfg?.channelBridge || {};

  const imapPass = maskSecret(imap.pass);
  const gmailClientSecret = maskSecret(gmail.clientSecret);
  const gmailRefresh = maskSecret(gmail.refreshToken);

  return {
    imap: {
      host: imap.host || "",
      port: imap.port || 993,
      secure: imap.secure !== false,
      user: imap.user || "",
      mailbox: imap.mailbox || "INBOX",
      sentMailbox: imap.sentMailbox || "",
      limit: imap.limit || 200,
      sinceDays: imap.sinceDays || 30,
      selfEmails: imap.selfEmails || "",
      hasPass: imapPass.has,
      passHint: imapPass.hint,
    },
    gmail: {
      clientId: gmail.clientId || "",
      hasClientSecret: gmailClientSecret.has,
      clientSecretHint: gmailClientSecret.hint,
      connectedEmail: gmail.email || "",
      connectedAt: gmail.connectedAt || "",
      hasRefreshToken: gmailRefresh.has,
      refreshTokenHint: gmailRefresh.hint,
      sync: {
        scope: gmail?.sync?.scope || "inbox_sent",
        query: gmail?.sync?.query || "",
      },
    },
    worker: {
      pollIntervalSeconds: worker.pollIntervalSeconds,
      quantities: worker.quantities,
    },
    channelBridge: channelBridge,
    ui: ui,
  };
}

function getChannelBridgeInboundMode(settingsOrNull, channel) {
  const cfg = withDefaults(settingsOrNull || readSettings());
  const key = String(channel || "").trim().toLowerCase();
  if (!key) return "disabled";
  return normalizeChannelBridgeMode(
    cfg?.channelBridge?.channels?.[key]?.inboundMode,
    "disabled"
  );
}

function isImapConfigured(settings = null) {
  const envOk = !!(process.env.REPLY_IMAP_HOST && process.env.REPLY_IMAP_USER && process.env.REPLY_IMAP_PASS);
  if (envOk) return true;
  const s = settings || readSettings();
  const imap = s?.imap || {};
  return !!(imap.host && imap.user && imap.pass);
}

function isGmailConfigured(settings = null) {
  const s = settings || readSettings();
  const gmail = s?.gmail || {};
  return !!(gmail.clientId && gmail.clientSecret && gmail.refreshToken);
}

module.exports = {
  SETTINGS_PATH,
  CHANNEL_BRIDGE_CHANNELS,
  withDefaults,
  readSettings,
  writeSettings,
  maskSettingsForClient,
  isImapConfigured,
  isGmailConfigured,
  getChannelBridgeInboundMode,
};
