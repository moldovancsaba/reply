const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SETTINGS_PATH = path.join(__dirname, "data", "settings.json");
const CHANNEL_BRIDGE_MODES = new Set(["disabled", "draft_only"]);
const CHANNEL_BRIDGE_CHANNELS = ["imessage", "whatsapp", "telegram", "discord", "signal", "viber", "linkedin"];

// Encryption settings
const ALGORITHM = "aes-256-cbc";
const ENCRYPTION_KEY = crypto.scryptSync(
  process.env.REPLY_OPERATOR_TOKEN || "reply-local-fallback-salt",
  "salt",
  32
);
const IV_LENGTH = 16;
const SENSITIVE_FIELDS = [
  "imap.pass",
  "gmail.clientSecret",
  "gmail.refreshToken",
  "global.googleApiKey",
  "global.operatorToken"
];

function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(text) {
  if (!text || !text.includes(":")) return text;
  try {
    const textParts = text.split(":");
    const iv = Buffer.from(textParts.shift(), "hex");
    const encryptedText = Buffer.from(textParts.join(":"), "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    console.warn("[Settings] Decryption failed, returning raw value.");
    return text;
  }
}

function getByPath(obj, path) {
  return path.split(".").reduce((o, i) => (o ? o[i] : undefined), obj);
}

function setByPath(obj, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  const target = parts.reduce((o, i) => {
    if (!o[i]) o[i] = {};
    return o[i];
  }, obj);
  target[last] = value;
}

function processSensitive(settings, action) {
  if (!settings || typeof settings !== "object") return settings;
  const next = JSON.parse(JSON.stringify(settings)); // Deep clone
  for (const field of SENSITIVE_FIELDS) {
    const val = getByPath(next, field);
    if (typeof val === "string" && val.trim()) {
      setByPath(next, field, action(val));
    }
  }
  return next;
}

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

  const global = s?.global || {};
  return {
    ...s,
    global: {
      googleApiKey: (global.googleApiKey || "").toString(),
      operatorToken: (global.operatorToken || "").toString(),
      requireOperatorToken: global.requireOperatorToken !== false,
      localWritesOnly: global.localWritesOnly !== false,
      requireHumanApproval: global.requireHumanApproval !== false,
      allowOpenClaw: global.allowOpenClaw !== false,
    },
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
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return processSensitive(raw, decrypt);
  } catch (e) {
    console.warn("[Settings] Failed to read settings.json:", e.message);
    return {};
  }
}

function writeSettings(next) {
  const encrypted = processSensitive(next, encrypt);
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${SETTINGS_PATH}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_PATH);

  // Sync to .env for compatibility with sidecars/cli
  syncToEnv(next);

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
  // If it's an encrypted string, we don't want to show the IV+Hash hash hint as it leaks too much info (or is confusing)
  // However, decrypt() is called in readSettings, so the value passed to maskSecret should already be decrypted.
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
    global: {
      ...cfg.global,
      googleApiKey: undefined, // ensure raw value is NOT leaked
      operatorToken: undefined,
      hasGoogleApiKey: maskSecret(cfg.global.googleApiKey).has,
      googleApiKeyHint: maskSecret(cfg.global.googleApiKey).hint,
      hasOperatorToken: maskSecret(cfg.global.operatorToken).has,
      operatorTokenHint: maskSecret(cfg.global.operatorToken).hint,
    },
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

function syncToEnv(settings) {
  try {
    const cfg = withDefaults(settings);
    const global = cfg.global || {};
    const ENV_PATH = path.join(__dirname, ".env");

    let content = "";
    if (fs.existsSync(ENV_PATH)) {
      content = fs.readFileSync(ENV_PATH, "utf8");
    }

    const mapping = {
      "GOOGLE_API_KEY": decrypt(global.googleApiKey),
      "REPLY_OPERATOR_TOKEN": decrypt(global.operatorToken),
      "REPLY_SECURITY_REQUIRE_OPERATOR_TOKEN": global.requireOperatorToken,
      "REPLY_SECURITY_LOCAL_WRITES_ONLY": global.localWritesOnly,
      "REPLY_SECURITY_REQUIRE_HUMAN_APPROVAL": global.requireHumanApproval,
      "REPLY_WHATSAPP_ALLOW_OPENCLAW_SEND": global.allowOpenClaw
    };

    let lines = content.split("\n");
    const seen = new Set();

    // Update existing lines
    lines = lines.map(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        if (Object.prototype.hasOwnProperty.call(mapping, key)) {
          seen.add(key);
          return `${key}=${mapping[key]}`;
        }
      }
      return line;
    });

    // Append missing lines
    for (const [key, value] of Object.entries(mapping)) {
      if (!seen.has(key) && value !== undefined && value !== "") {
        lines.push(`${key}=${value}`);
      }
    }

    fs.writeFileSync(ENV_PATH, lines.join("\n"), { mode: 0o600 });
    console.log("[Settings] Synced global secrets to .env");
  } catch (e) {
    console.warn("[Settings] Failed to sync to .env:", e.message);
  }
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
