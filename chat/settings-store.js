const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ensureDataHome, dataPath } = require("./app-paths.js");

ensureDataHome();
const SETTINGS_PATH = dataPath("settings.json");
const CHANNEL_BRIDGE_MODES = new Set(["disabled", "draft_only"]);
const CHANNEL_BRIDGE_CHANNELS = ["imessage", "whatsapp", "telegram", "discord", "signal", "viber", "linkedin"];

function debugSettingsLoggingEnabled() {
  const v = String(process.env.REPLY_DEBUG_SETTINGS || "").toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes";
}

// Encryption settings - Lazy initialization to ensure process.env is ready (via dotenv)
const ALGORITHM = "aes-256-cbc";
let _cachedKey = null;
function getEncryptionKey() {
  if (!_cachedKey) {
    const token = process.env.REPLY_OPERATOR_TOKEN || "reply-local-fallback-salt";
    if (debugSettingsLoggingEnabled()) {
      try {
        fs.appendFileSync(
          dataPath("debug_token.log"),
          `[${new Date().toISOString()}] settings-store: encryption key derived (operator token length=${token.length}, not logged)\n`
        );
      } catch {
        /* ignore */
      }
    }
    _cachedKey = crypto.scryptSync(
      token,
      "salt",
      32
    );
  }
  return _cachedKey;
}
const IV_LENGTH = 16;
const SENSITIVE_FIELDS = [
  "imap.pass",
  "gmail.clientSecret",
  "gmail.refreshToken",
  "global.googleApiKey",
  "global.operatorToken",
  "ai.openclawGatewayToken",
];

function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(getEncryptionKey()), iv);
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
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(getEncryptionKey()), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    // If decryption fails, we DO NOT return the raw encrypted string as fallback.
    // This prevents corruption if the result is later written to .env as a secret.
    console.error(`[Settings] Decryption failed for field. Check REPLY_OPERATOR_TOKEN. Error: ${e.message}`);
    return null;
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

/** One extra mailbox row for multi-account mail (reply#21). */
function normalizeMailAccountEntry(raw, idx) {
  if (!raw || typeof raw !== "object") return null;
  const id =
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim()
      : `mail-${idx}-${Date.now().toString(36)}`;
  const provider = raw.provider === "gmail_oauth" ? "gmail_oauth" : "imap";
  const im = raw.imap && typeof raw.imap === "object" ? raw.imap : {};
  const imap =
    provider === "imap"
      ? {
          host: String(im.host || "").trim(),
          port: Math.max(1, Math.min(parseInt(im.port, 10) || 993, 65535)),
          secure: im.secure !== false,
          user: String(im.user || "").trim(),
          mailbox: String(im.mailbox || "INBOX").trim() || "INBOX",
          sentMailbox: String(im.sentMailbox || "").trim(),
          limit: Math.max(1, Math.min(parseInt(im.limit, 10) || 200, 2000)),
          sinceDays: Math.max(1, Math.min(parseInt(im.sinceDays, 10) || 30, 3650)),
          selfEmails: String(im.selfEmails || "").trim(),
          pass: typeof im.pass === "string" ? im.pass : "",
        }
      : {
          host: "",
          port: 993,
          secure: true,
          user: "",
          mailbox: "INBOX",
          sentMailbox: "",
          limit: 200,
          sinceDays: 30,
          selfEmails: "",
          pass: "",
        };
  return {
    id,
    label: String(raw.label || id).slice(0, 120),
    provider,
    enabled: raw.enabled !== false,
    imap,
    gmailAccountRef: typeof raw.gmailAccountRef === "string" ? raw.gmailAccountRef.trim().slice(0, 128) : "",
  };
}

function mergeMailAccountsFromIncoming(incomingList, previousList) {
  const prev = Array.isArray(previousList) ? previousList : [];
  if (!Array.isArray(incomingList)) return prev;
  const curMap = new Map(prev.map((a) => [a.id, a]));
  return incomingList
    .map((x, i) => normalizeMailAccountEntry(x, i))
    .filter(Boolean)
    .map((acc) => {
      const was = curMap.get(acc.id);
      if (was?.imap?.pass && (!acc.imap.pass || !String(acc.imap.pass).trim())) {
        return { ...acc, imap: { ...acc.imap, pass: was.imap.pass } };
      }
      return acc;
    });
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
      googleApiKey: global.googleApiKey === null ? null : (global.googleApiKey || "").toString(),
      operatorToken: global.operatorToken === null ? null : (global.operatorToken || "").toString(),
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
        gmail: Number(s?.worker?.quantities?.gmail) || 500,
        notes: Number(s?.worker?.quantities?.notes) || 0,
      },
    },
    health: {
      ollamaProbeTimeoutMs: Math.max(
        1000,
        Math.min(Number(s?.health?.ollamaProbeTimeoutMs) || 3000, 30000)
      ),
      uiHealthPollIntervalMs: Math.max(
        5000,
        Math.min(Number(s?.health?.uiHealthPollIntervalMs) || 15000, 300000)
      ),
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
    ai: (() => {
      const a = s?.ai || {};
      const dr = String(a.draftRuntime || "auto").toLowerCase();
      const draftRuntime = dr === "ollama" ? dr : "auto";
      const port = Number(a.ollamaPort);
      return {
        draftRuntime,
        ollamaHost: String(a.ollamaHost || "").trim().slice(0, 512),
        ollamaPort: Number.isFinite(port) ? Math.max(0, Math.min(port, 65535)) : 0,
        ollamaModel: String(a.ollamaModel || "").trim().slice(0, 160),
        openclawBinary: String(a.openclawBinary || "").trim().slice(0, 512),
        openclawGatewayUrl: String(a.openclawGatewayUrl || "").trim().slice(0, 512),
        openclawGatewayToken:
          a.openclawGatewayToken === null ? null : String(a.openclawGatewayToken || ""),
        annotationOllamaModel: String(a.annotationOllamaModel || "").trim().slice(0, 160),
        kycOllamaModel: String(a.kycOllamaModel || "").trim().slice(0, 160),
      };
    })(),
    mailAccounts: Array.isArray(s?.mailAccounts)
      ? s.mailAccounts.map((x, i) => normalizeMailAccountEntry(x, i)).filter(Boolean)
      : [],
    defaultMailAccountId:
      s?.defaultMailAccountId == null || s.defaultMailAccountId === ""
        ? null
        : String(s.defaultMailAccountId),
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
  // --- Safety Merge Logic ---
  // If the incoming 'next' object has null for sensitive fields, it likely means 
  // decryption failed in the caller's session. We should preserve the existing 
  // encrypted values from disk instead of overwriting with null.
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const onDiskEncrypted = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
      for (const field of SENSITIVE_FIELDS) {
        const incomingVal = getByPath(next, field);
        // If incoming is null (from my previous fix in decrypt()), but on-disk has a value
        if (incomingVal === null) {
          const existingEncrypted = getByPath(onDiskEncrypted, field);
          if (existingEncrypted && typeof existingEncrypted === 'string' && existingEncrypted.includes(':')) {
            console.log(`[Settings] Safety Merge: Preserving encrypted value for ${field}`);
            setByPath(next, field, existingEncrypted);
          }
        }
      }
    }
  } catch (e) {
    console.warn("[Settings] Safety merge failed, proceeding with standard write:", e.message);
  }

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
    // Best-effort hardening
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

  const ocTok = maskSecret(cfg.ai?.openclawGatewayToken);
  const mailAccounts = (cfg.mailAccounts || []).map((a) => {
    const passMask = maskSecret(a.imap?.pass);
    return {
      id: a.id,
      label: a.label || a.id,
      provider: a.provider || "imap",
      enabled: a.enabled !== false,
      gmailAccountRef: a.gmailAccountRef || "",
      imap: a.imap
        ? {
            host: a.imap.host || "",
            port: a.imap.port || 993,
            secure: a.imap.secure !== false,
            user: a.imap.user || "",
            mailbox: a.imap.mailbox || "INBOX",
            sentMailbox: a.imap.sentMailbox || "",
            limit: a.imap.limit || 200,
            sinceDays: a.imap.sinceDays || 30,
            selfEmails: a.imap.selfEmails || "",
            hasPass: passMask.has,
            passHint: passMask.hint,
          }
        : {},
    };
  });

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
    health: {
      ollamaProbeTimeoutMs: cfg.health?.ollamaProbeTimeoutMs ?? 3000,
      uiHealthPollIntervalMs: cfg.health?.uiHealthPollIntervalMs ?? 15000,
    },
    ai: {
      draftRuntime: cfg.ai?.draftRuntime || "auto",
      ollamaHost: cfg.ai?.ollamaHost || "",
      ollamaPort: cfg.ai?.ollamaPort || 0,
      ollamaModel: cfg.ai?.ollamaModel || "",
      openclawBinary: cfg.ai?.openclawBinary || "",
      openclawGatewayUrl: cfg.ai?.openclawGatewayUrl || "",
      hasOpenclawGatewayToken: ocTok.has,
      openclawGatewayTokenHint: ocTok.hint,
      annotationOllamaModel: cfg.ai?.annotationOllamaModel || "",
      kycOllamaModel: cfg.ai?.kycOllamaModel || "",
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
    mailAccounts,
    defaultMailAccountId: cfg.defaultMailAccountId ?? null,
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

    const ai = cfg.ai || {};
    if (ai.ollamaHost && String(ai.ollamaHost).trim()) {
      let h = String(ai.ollamaHost).trim();
      if (!/^https?:\/\//i.test(h)) h = `http://${h}`;
      mapping.OLLAMA_HOST = h.replace(/\/$/, "");
    } else if (Number(ai.ollamaPort) > 0) {
      mapping.OLLAMA_HOST = `http://127.0.0.1:${ai.ollamaPort}`;
    }
    if (ai.ollamaModel && String(ai.ollamaModel).trim()) {
      mapping.REPLY_OLLAMA_MODEL = String(ai.ollamaModel).trim();
    }
    if (ai.annotationOllamaModel && String(ai.annotationOllamaModel).trim()) {
      mapping.REPLY_ANNOTATION_MODEL = String(ai.annotationOllamaModel).trim();
    }
    if (ai.kycOllamaModel && String(ai.kycOllamaModel).trim()) {
      mapping.REPLY_KYC_OLLAMA_MODEL = String(ai.kycOllamaModel).trim();
    }
    if (ai.openclawBinary && String(ai.openclawBinary).trim()) {
      mapping.OPENCLAW_BIN = String(ai.openclawBinary).trim();
    }
    if (ai.openclawGatewayUrl && String(ai.openclawGatewayUrl).trim()) {
      mapping.REPLY_OPENCLAW_GATEWAY_URL = String(ai.openclawGatewayUrl).trim();
    }
    const ocPlain = decrypt(ai.openclawGatewayToken);
    if (ocPlain && String(ocPlain).trim()) {
      mapping.REPLY_OPENCLAW_GATEWAY_TOKEN = String(ocPlain).trim();
    }
    // Drop nulls and values that still look AES-encrypted (iv:hex), not URLs like http://...
    for (const key of Object.keys(mapping)) {
      const val = mapping[key];
      if (val === null) {
        delete mapping[key];
      } else if (
        typeof val === "string" &&
        /^[0-9a-f]{16,}:[0-9a-f]+$/i.test(val.trim())
      ) {
        delete mapping[key];
      }
    }

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
  mergeMailAccountsFromIncoming,
  isImapConfigured,
  isGmailConfigured,
  getChannelBridgeInboundMode,
};
