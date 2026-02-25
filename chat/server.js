/**
 * Reply POC — Localhost Chat Server
 * 
 * This server provides the backend for the "Local Brain" chat interface.
 * It serves the static HTML UI and handles API requests for:
 * 1. Generating reply suggestions based on local context.
 * 2. Syncing Apple Notes to the vector database.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") }); // Load chat/.env deterministically

const { generateReply, extractKYC } = require('./reply-engine.js');
const { getSnippets } = require("./knowledge.js");
const { sync: syncIMessage } = require('./sync-imessage.js');
const { syncNotes } = require('./sync-notes.js');
const { syncWhatsApp } = require('./sync-whatsapp.js');
const { syncLinkedIn } = require('./sync-linkedin.js');
const triageEngine = require('./triage-engine.js');
const { refineReply } = require("./gemini-client.js");
const contactStore = require("./contact-store.js");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { mergeProfile } = require("./kyc-merge.js");
const { serveKyc, serveAnalyzeContact } = require("./routes/kyc.js");
const {
  readSettings,
  writeSettings,
  maskSettingsForClient,
  isImapConfigured,
  isGmailConfigured,
  withDefaults,
  CHANNEL_BRIDGE_CHANNELS,
  getChannelBridgeInboundMode,
} = require("./settings-store.js");
const { buildAuthUrl, connectGmailFromCallback, disconnectGmail } = require("./gmail-connector.js");
const {
  ingestInboundEvent,
  ingestInboundEvents,
  normalizeInboundEvent,
  toVectorDoc,
  readBridgeEventLog,
  readChannelSyncState,
} = require("./channel-bridge.js");
const { createRateLimiter } = require("./rate-limiter.js");
const {
  getSecurityPolicy,
  isLocalRequest,
  hasValidOperatorToken,
  isHumanApproved,
  appendSecurityAudit,
  resolveClientIp,
} = require("./security-policy.js");
const { enforceOpenClawWhatsAppGuard } = require("./openclaw-guard.js");

// Default to port 3000 if not specified in environment variables.
const PORT_MIN = parseInt(process.env.PORT || "3000", 10);
const HTML_PATH = path.join(__dirname, "index.html");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
let gmailOauthState = null;

let boundPort = PORT_MIN;
const analysisInFlightByHandle = new Map();
const securityPolicy = getSecurityPolicy(process.env);
const OPERATOR_TOKEN_COOKIE_NAME = "reply_operator_token";
const BRIDGE_MANAGED_CHANNELS = new Set(CHANNEL_BRIDGE_CHANNELS);

// Conversation list helpers
const conversationsIndexCache = {
  builtAtMs: 0,
  ttlMs: 5 * 1000,
  buildPromise: null,
  items: [],
};

// Queue for auto-annotation to prevent SQLITE_BUSY write races
const annotationQueue = [];
let processingAnnotation = false;

async function processAnnotationQueue() {
  if (processingAnnotation || annotationQueue.length === 0) return;
  processingAnnotation = true;
  try {
    while (annotationQueue.length > 0) {
      const { text, callback } = annotationQueue.shift();
      try {
        const result = await _internalAutoAnnotate(text);
        if (callback) callback(null, result);
      } catch (err) {
        console.error("[AutoAnnotate] Error in queue:", err);
        if (callback) callback(err);
      }
    }
  } finally {
    processingAnnotation = false;
  }
}

const conversationStatsCache = new Map(); // key -> { builtAtMs, lastContacted, stats }
const CONVERSATION_STATS_TTL_MS = 60 * 1000;
const CONVERSATION_PREVIEW_SAMPLE_ROWS = 200;

let docsTablePromise = null;
let openClawGuardLastCheckAtMs = 0;
let openClawGuardLastResult = null;

function applyOpenClawWhatsAppGuard(force = false) {
  const now = Date.now();
  if (!force && now - openClawGuardLastCheckAtMs < 30_000) {
    return openClawGuardLastResult;
  }
  openClawGuardLastCheckAtMs = now;
  try {
    const result = enforceOpenClawWhatsAppGuard();
    openClawGuardLastResult = result;
    if (!result?.ok) {
      console.warn("OpenClaw WhatsApp guard not enforced:", result?.reason || "unknown reason");
    } else if (result.changed) {
      console.log("OpenClaw WhatsApp guard enforced.");
    }
  } catch (error) {
    openClawGuardLastResult = {
      ok: false,
      changed: false,
      reason: String(error?.message || error || "unknown error"),
    };
    console.warn("OpenClaw WhatsApp guard failed:", openClawGuardLastResult.reason);
  }
  return openClawGuardLastResult;
}

function invalidateConversationCaches() {
  conversationsIndexCache.items = [];
  conversationsIndexCache.builtAtMs = 0;
  conversationStatsCache.clear();
}

function escapeSqlString(value) {
  return String(value ?? "").replace(/'/g, "''");
}

/**
 * Automatically annotate a sent message as a golden example.
 */
async function autoAnnotateSentMessage(channel, handle, text) {
  return new Promise((resolve, reject) => {
    annotationQueue.push({ channel, handle, text, resolve, reject });
    processAnnotationQueue().catch(reject);
  });
}

/**
 * Internal worker for annotation to prevent re-entrancy issues
 */
async function _internalAutoAnnotate(channel, handle, text) {
  try {
    const { addDocuments } = require("./vector-store.js");
    const dateStr = new Date().toLocaleString();
    const formatted = `[${dateStr}] Me: ${text}`;
    const msgId = `urn:reply:manual:${Date.now()}`;
    await addDocuments([{
      id: msgId,
      text: formatted,
      source: channel,
      path: `${channel}://${handle}`,
      is_annotated: true
    }]);

    // 2. Save to unified chat.db
    const { saveMessages } = require("./message-store.js");
    await saveMessages([{
      id: msgId,
      text: text,
      source: channel,
      handle: handle,
      timestamp: new Date().toISOString(),
      path: `${channel}://${handle}`
    }]);

    // 3. Update contact last contacted to refresh triage/sort order
    await contactStore.updateLastContacted(handle, new Date().toISOString(), { channel });

    // 4. Invalidate conversations cache to force re-sort in UI
    conversationsIndexCache.builtAtMs = 0;
  } catch (e) {
    console.error("Auto-annotation failed:", e.message);
    throw e;
  }
}

async function getDocsTable() {
  if (docsTablePromise) return docsTablePromise;
  docsTablePromise = (async () => {
    const { connect } = require("./vector-store.js");
    const db = await connect();
    return await db.openTable("documents");
  })();
  return docsTablePromise;
}

function safeDateMs(v) {
  try {
    const d = new Date(v);
    const t = d.getTime();
    return Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
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

  return parts
    .filter(Boolean)
    .map((v) => String(v))
    .join(" ")
    .toLowerCase();
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

function getBridgePolicyForChannel(channel, settingsSnapshot = null) {
  const key = String(channel || "").trim().toLowerCase();
  if (!key) return null;
  if (!BRIDGE_MANAGED_CHANNELS.has(key)) return null;
  const inboundMode = getChannelBridgeInboundMode(settingsSnapshot, key);
  return {
    managed: true,
    channel: key,
    inboundMode,
    label: `${key} ${inboundMode}`,
  };
}

function buildChannelBridgeSummary(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 200, 5000));
  const events = readBridgeEventLog(limit);
  const settings = readSettings();
  const counts = { total: events.length, ingested: 0, duplicate: 0, error: 0, other: 0 };
  const channels = {};
  let lastEventAt = null;
  let lastErrorAt = null;

  for (const evt of events) {
    const status = String(evt?.status || "").toLowerCase();
    const channel = String(evt?.channel || "unknown").toLowerCase() || "unknown";
    const at = String(evt?.at || "").trim();

    if (status === "ingested") counts.ingested += 1;
    else if (status === "duplicate") counts.duplicate += 1;
    else if (status === "error") counts.error += 1;
    else counts.other += 1;

    if (!channels[channel]) {
      channels[channel] = { ingested: 0, duplicate: 0, error: 0, other: 0, total: 0, lastAt: null };
    }
    channels[channel].total += 1;
    if (status === "ingested") channels[channel].ingested += 1;
    else if (status === "duplicate") channels[channel].duplicate += 1;
    else if (status === "error") channels[channel].error += 1;
    else channels[channel].other += 1;
    if (at) channels[channel].lastAt = at;

    if (at) lastEventAt = at;
    if (status === "error" && at) lastErrorAt = at;
  }

  return {
    limit,
    sampleSize: events.length,
    counts,
    channels,
    rollout: Object.fromEntries(
      CHANNEL_BRIDGE_CHANNELS.map((channel) => [
        channel,
        getChannelBridgeInboundMode(settings, channel),
      ])
    ),
    lastEventAt,
    lastErrorAt,
  };
}

function stripPathScheme(p) {
  return String(p || "").replace(/^(imessage:\/\/|whatsapp:\/\/|mailto:|telegram:\/\/|discord:\/\/|signal:\/\/|viber:\/\/|linkedin:\/\/)/i, "").trim();
}

async function collectRows(results) {
  if (!results) return [];
  if (Array.isArray(results)) return results;
  const out = [];
  for await (const batch of results) {
    for (const row of batch) out.push(row.toJSON ? row.toJSON() : row);
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function getConversationsIndexFresh() {
  const now = Date.now();
  if (conversationsIndexCache.buildPromise) return conversationsIndexCache.buildPromise;
  if (conversationsIndexCache.items.length && (now - conversationsIndexCache.builtAtMs) < conversationsIndexCache.ttlMs) {
    return { items: conversationsIndexCache.items };
  }

  conversationsIndexCache.buildPromise = (async () => {
    const contacts = await contactStore.refresh();
    const items = (contacts || [])
      .slice()
      .sort((a, b) => safeDateMs(b?.lastContacted) - safeDateMs(a?.lastContacted))
      .map((c) => {
        const handle = String(c?.handle || c?.displayName || "").trim();
        const channel = (c?.lastChannel || inferChannelFromHandle(handle)).toString();
        return {
          key: String(c?.id || handle),
          handle,
          latestHandle: handle,
          sortTime: safeDateMs(c?.lastContacted),
          channel,
          source: inferSourceFromChannel(channel),
          contact: c || null,
        };
      })
      .filter((x) => x.handle);

    conversationsIndexCache.items = items;
    conversationsIndexCache.builtAtMs = Date.now();
    return { items };
  })().finally(() => {
    conversationsIndexCache.buildPromise = null;
  });

  return conversationsIndexCache.buildPromise;
}

async function getConversationStatsForHandle(handle, contact) {
  const key = String(contact?.id || handle || "").trim();
  const lastContacted = String(contact?.lastContacted || "");
  const cached = conversationStatsCache.get(key);
  const now = Date.now();
  if (cached && cached.lastContacted === lastContacted && (now - cached.builtAtMs) < CONVERSATION_STATS_TTL_MS) {
    return cached.stats;
  }

  const { getHistory } = require("./vector-store.js");
  const handles = contactStore.getAllHandles(handle);

  // Add WhatsApp @lid aliases for known phone JIDs so older ingested messages remain discoverable.
  const phoneDigits = handles
    .filter((h) => typeof h === "string" && !h.includes("@"))
    .map((h) => normalizePhone(h))
    .filter(Boolean);
  const lidByPhone = await whatsAppIdResolver.lidsForPhones(phoneDigits);
  const lidHandles = Array.from(new Set(Array.from(lidByPhone.values()).filter(Boolean)));
  const allHandles = Array.from(new Set([...handles, ...lidHandles]));
  const prefixes = Array.from(new Set(allHandles.flatMap((h) => pathPrefixesForHandle(h))));

  let totalCount = 0;
  let best = { time: 0, preview: null, previewDate: null, channel: null, source: null, latestHandle: null, path: null };

  for (const prefix of prefixes) {
    const rows = await getHistory(prefix);
    totalCount += Array.isArray(rows) ? rows.length : 0;
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const sample = rows.length > CONVERSATION_PREVIEW_SAMPLE_ROWS
      ? rows.slice(-CONVERSATION_PREVIEW_SAMPLE_ROWS)
      : rows;
    for (const r of sample) {
      const dt = extractDateFromText(r?.text || "");
      const t = dt ? dt.getTime() : 0;
      if (!t) continue;
      if (t > best.time) {
        best = {
          time: t,
          preview: stripMessagePrefix(r?.text || "").trim(),
          previewDate: dt.toISOString(),
          channel: channelFromDoc(r),
          source: r?.source || null,
          latestHandle: stripPathScheme(r?.path || ""),
          path: r?.path || null,
        };
      }
    }
  }

  // If the latest handle is a WhatsApp linked-device @lid, prefer the real phone JID for sending stability.
  if (best.channel === "whatsapp" && best.latestHandle && /^\d{13,}$/.test(best.latestHandle)) {
    const waMeta = await whatsAppIdResolver.phoneForLids([best.latestHandle]);
    const meta = waMeta.get(best.latestHandle);
    if (meta?.phone) best.latestHandle = meta.phone;
  }

  const stats = {
    count: totalCount,
    channel: best.channel,
    source: best.source,
    preview: best.preview,
    previewDate: best.previewDate,
    latestHandle: best.latestHandle || handle,
  };

  conversationStatsCache.set(key, { builtAtMs: now, lastContacted, stats });
  return stats;
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function setOperatorTokenCookie(req, res) {
  if (!securityPolicy.requireOperatorToken) return;
  if (!isLocalRequest(req)) return;
  const token = String(securityPolicy.operatorToken || "").trim();
  if (!token) return;

  const cookie = [
    `${OPERATOR_TOKEN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=43200",
  ].join("; ");
  res.setHeader("Set-Cookie", cookie);
}

function auditSecurityDecision(req, params) {
  appendSecurityAudit({
    route: params.route,
    action: params.action,
    method: req.method,
    decision: params.decision,
    reason: params.reason || "",
    dryRun: Boolean(params.dryRun),
    ip: resolveClientIp(req),
    userAgent: String(req.headers["user-agent"] || ""),
  });
}

function denySensitiveRoute(req, res, params) {
  auditSecurityDecision(req, {
    route: params.route,
    action: params.action,
    decision: "deny",
    reason: params.code,
    dryRun: params.dryRun,
  });
  writeJson(res, params.statusCode || 403, {
    error: params.message,
    code: params.code,
    hint: params.hint,
  });
}

function authorizeSensitiveRoute(req, res, options) {
  const route = options.route || "unknown";
  const action = options.action || route;
  const payload = options.payload || {};
  const requireHumanApproval = options.requireHumanApproval !== false;
  const dryRun = Boolean(payload?.dryRun);

  if (securityPolicy.localWritesOnly && !isLocalRequest(req)) {
    denySensitiveRoute(req, res, {
      route,
      action,
      code: "local_only",
      message: "Sensitive route is restricted to local requests.",
      hint: "Use localhost access or disable REPLY_SECURITY_LOCAL_WRITES_ONLY (not recommended).",
      statusCode: 403,
      dryRun,
    });
    return false;
  }

  if (securityPolicy.requireOperatorToken && !hasValidOperatorToken(req, securityPolicy)) {
    denySensitiveRoute(req, res, {
      route,
      action,
      code: "operator_token_required",
      message: "Missing or invalid operator token.",
      hint: "Provide X-Reply-Operator-Token with a valid token.",
      statusCode: 401,
      dryRun,
    });
    return false;
  }

  const approvalRequired =
    securityPolicy.requireHumanApproval &&
    requireHumanApproval &&
    !(dryRun && securityPolicy.allowDryRunWithoutApproval);
  if (approvalRequired && !isHumanApproved(req, payload)) {
    denySensitiveRoute(req, res, {
      route,
      action,
      code: "human_approval_required",
      message: "Human approval is required for this sensitive action.",
      hint: "Send approval.confirmed=true in payload or X-Reply-Human-Approval: confirmed.",
      statusCode: 403,
      dryRun,
    });
    return false;
  }

  auditSecurityDecision(req, {
    route,
    action,
    decision: "allow",
    reason: "authorized",
    dryRun,
  });
  return true;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const body = await readRequestBody(req);
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

async function readTextBody(req) {
  return await readRequestBody(req);
}

function analyzeContactInChild(handle) {
  const childScript = path.join(__dirname, "kyc-analyze-child.js");
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [childScript, String(handle)],
      {
        cwd: __dirname,
        timeout: 5 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
        env: process.env
      },
      (err, stdout, stderr) => {
        if (err) {
          const signal = err.signal || null;
          const code = typeof err.code === "number" ? err.code : null;
          const suffix = signal ? ` (signal ${signal})` : code !== null ? ` (code ${code})` : "";
          const details = String((stderr || stdout || "")).trim();
          const msg =
            signal === "SIGSEGV" || /segmentation fault/i.test(details)
              ? `Analyzer crashed with a segmentation fault${suffix}.`
              : `Analyzer failed${suffix}.`;
          return reject(new Error(details ? `${msg} ${details}` : msg));
        }

        const out = String(stdout || "").trim();
        let parsed = null;
        try {
          parsed = out ? JSON.parse(out) : null;
        } catch {
          const details = String((stderr || stdout || "")).trim();
          return reject(new Error(details ? `Analyzer returned invalid JSON. ${details}` : "Analyzer returned invalid JSON."));
        }

        if (!parsed || parsed.status !== "ok") {
          return reject(new Error(parsed?.error || "Analyzer failed."));
        }

        resolve(parsed.profile || null);
      }
    );
  });
}

function analyzeContactDeduped(handle) {
  const key = String(handle || "").trim();
  if (!key) return Promise.reject(new Error("Missing handle"));
  const existing = analysisInFlightByHandle.get(key);
  if (existing) return existing;

  const p = analyzeContactInChild(key)
    .finally(() => {
      analysisInFlightByHandle.delete(key);
    });
  analysisInFlightByHandle.set(key, p);
  return p;
}

function pathPrefixesForHandle(handle) {
  if (!handle || typeof handle !== "string") return [];
  const h = handle.trim();
  if (!h) return [];
  if (h.includes("@")) return [`mailto:${h}`];
  // Phone-like handles may exist across multiple channels, and may be formatted differently (+36... vs 3630...).
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
  if (s.includes("messenger")) return "messenger";
  if (s.includes("instagram")) return "instagram";
  return "imessage";
}

function normalizeEmail(email) {
  if (!email) return null;
  const v = String(email).trim().toLowerCase();
  return v.includes("@") ? v : null;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  if (!raw) return null;
  // Remove punctuation/spaces, keep only digits and a leading "+"
  let cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("00")) cleaned = `+${cleaned.slice(2)}`;
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return digits; // Use digits-only key to match across formatting
}

function resolveWhatsAppSendTransport(rawTransport) {
  const value =
    rawTransport !== undefined && rawTransport !== null
      ? rawTransport
      : process.env.REPLY_WHATSAPP_SEND_TRANSPORT;
  const normalized = String(value || "desktop").trim().toLowerCase();
  if (normalized === "openclaw" || normalized === "openclaw_cli" || normalized === "web") {
    return "openclaw_cli";
  }
  return "desktop";
}

function resolveWhatsAppOpenClawSendEnabled() {
  const v = String(process.env.REPLY_WHATSAPP_ALLOW_OPENCLAW_SEND ?? "false")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(v);
}

function isManualUiWhatsAppSend(payload) {
  const source = String(payload?.approval?.source || "")
    .trim()
    .toLowerCase();
  return source === "ui-send-message" || source === "ui-send-whatsapp-manual";
}

function hasHumanEnterTrigger(payload) {
  const kind = String(payload?.trigger?.kind || "")
    .trim()
    .toLowerCase();
  if (kind !== "human_enter") return false;
  const at = String(payload?.trigger?.at || "").trim();
  if (!at) return false;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return false;
  // Trigger expires quickly to reduce replay risk from stale payloads.
  return Math.abs(Date.now() - t) <= 120000;
}

function resolveOpenClawBinary() {
  const configured = String(process.env.OPENCLAW_BIN || "").trim();
  return configured || "openclaw";
}

function parseJsonSafe(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeSendErrorMessage(rawMessage, fallbackMessage) {
  let text = String(rawMessage || "").trim();
  while (/^error:\s*/i.test(text)) {
    text = text.replace(/^error:\s*/i, "").trim();
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text) return text;
  return String(fallbackMessage || "Request failed.");
}

function resolveWhatsAppDesktopFallbackOnOpenClawFailure(rawValue) {
  if (typeof rawValue === "boolean") return rawValue;
  const envValue = String(
    process.env.REPLY_WHATSAPP_DESKTOP_FALLBACK_ON_OPENCLAW_FAILURE ?? "true"
  )
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(envValue);
}

function isOpenClawDesktopFallbackEligible(errorObj) {
  const s = [
    errorObj?.message,
    errorObj?.hint,
    errorObj?.raw?.stderr,
    errorObj?.raw?.stdout,
  ]
    .map((v) => String(v || ""))
    .join("\n")
    .toLowerCase();

  return [
    "no active whatsapp web listener",
    "start the gateway",
    "openclaw gateway",
    "gateway is running",
    "login --channel whatsapp",
    "no whatsapp web session found",
    "scan the qr",
    "not linked",
    "enoent",
    "command not found",
  ].some((pattern) => s.includes(pattern));
}

function buildOpenClawWhatsAppHint(rawErrorText, execErrorText, shortErrorText) {
  const s = `${rawErrorText || ""}\n${execErrorText || ""}\n${shortErrorText || ""}`.toLowerCase();
  if (s.includes("enoent")) {
    return "Install OpenClaw CLI or set OPENCLAW_BIN to the openclaw executable path.";
  }
  if (s.includes("no active whatsapp web listener")) {
    return "Start OpenClaw gateway and link WhatsApp first (example: `openclaw channels login --channel whatsapp --account default`).";
  }
  if (s.includes("gateway is running") || s.includes("start the gateway")) {
    return "Start OpenClaw gateway, then retry (example: `openclaw gateway`).";
  }
  if (
    s.includes("not linked") ||
    s.includes("scan the qr") ||
    s.includes("login --channel whatsapp") ||
    s.includes("no whatsapp web session found")
  ) {
    return "Link WhatsApp in OpenClaw first (example: `openclaw channels login --channel whatsapp`), then retry.";
  }
  return "Ensure OpenClaw CLI is installed, gateway is running, and WhatsApp Web is linked.";
}

async function sendWhatsAppViaOpenClawCli(options) {
  // Re-apply guard before each OpenClaw send to prevent accidental DM pairing prompts.
  applyOpenClawWhatsAppGuard(false);

  const recipient = String(options?.recipient || "").trim();
  const text = String(options?.text || "");
  const dryRun = Boolean(options?.dryRun);
  const bin = resolveOpenClawBinary();
  const args = [
    "message",
    "send",
    "--channel",
    "whatsapp",
    "--target",
    recipient,
    "--message",
    text,
    "--json",
  ];
  if (dryRun) args.push("--dry-run");

  return await new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const outText = String(stdout || "").trim();
      const errText = String(stderr || "").trim();
      const parsedOut = parseJsonSafe(outText);
      const parsedErr = parseJsonSafe(errText);

      if (error) {
        const execErr = String(error?.message || "").trim();

        // Filter out OpenClaw audit warnings from stderr
        const cleanErrLines = errText.split("\n").filter(line => {
          const l = line.trim().toLowerCase();
          return l && !l.startsWith("warn") && !l.includes("gateway.bind") && !l.includes("trustedproxies");
        });
        const cleanErrText = cleanErrLines.length > 0 ? cleanErrLines[cleanErrLines.length - 1].trim() : "";

        const shortErr = normalizeSendErrorMessage(
          parsedErr?.error ||
          parsedErr?.message ||
          parsedOut?.error ||
          parsedOut?.message ||
          cleanErrText ||
          execErr,
          "OpenClaw WhatsApp send failed."
        );
        const wrapped = new Error(shortErr);
        wrapped.hint = buildOpenClawWhatsAppHint(errText, execErr, shortErr);
        wrapped.raw = {
          stdout: outText,
          stderr: errText,
        };
        reject(wrapped);
        return;
      }

      resolve({
        parsed: parsedOut,
        raw: outText,
      });
    });
  });
}

const WA_DB_PATH = path.join(
  process.env.HOME || "",
  "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite"
);

const whatsAppIdResolver = (() => {
  const MAX_CACHE = 5000;
  const lidToPhone = new Map(); // lidDigits -> { phone, partnerName } | null
  const phoneToLid = new Map(); // phoneDigits -> lidDigits | null

  let waDb = null;
  let openPromise = null;

  function cap(map) {
    while (map.size > MAX_CACHE) map.delete(map.keys().next().value);
  }

  async function ensureDb() {
    if (waDb) return waDb;
    if (openPromise) return openPromise;

    openPromise = (async () => {
      try {
        if (!process.env.HOME) return null;
        if (!fs.existsSync(WA_DB_PATH)) return null;
        const sqlite3 = require("sqlite3").verbose();
        waDb = new sqlite3.Database(WA_DB_PATH, sqlite3.OPEN_READONLY);
        waDb.run("PRAGMA busy_timeout = 5000");
        return waDb;
      } catch (e) {
        console.warn("WhatsApp DB unavailable:", e?.message || e);
        waDb = null;
        return null;
      } finally {
        openPromise = null;
      }
    })();

    return openPromise;
  }

  function all(db, sql, params) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  function buildInQuery(baseSql, values) {
    const safeValues = Array.isArray(values) ? values : [];
    if (safeValues.length === 0) {
      return { sql: baseSql + "NULL)", params: [] };
    }
    const placeholders = safeValues.map(() => "?").join(",");
    return { sql: baseSql + placeholders + ")", params: safeValues };
  }

  function normalizeWhatsAppContactJid(contactJid) {
    if (!contactJid) return null;
    const v = String(contactJid).trim();
    if (!v) return null;
    // "36205631691@s.whatsapp.net" -> "36205631691"
    if (v.includes("@")) return v.split("@")[0];
    return v;
  }

  async function phoneForLids(lidDigitsList) {
    const lids = Array.from(new Set((lidDigitsList || []).map((v) => String(v || "").trim()).filter(Boolean)));
    const out = new Map();

    for (const lid of lids) {
      if (lidToPhone.has(lid)) {
        const cached = lidToPhone.get(lid);
        if (cached) out.set(lid, cached);
      }
    }

    const missing = lids.filter((lid) => !lidToPhone.has(lid));
    if (missing.length === 0) return out;

    const db = await ensureDb();
    if (!db) return out;

    const CHUNK = 400;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const ids = chunk.map((lid) => `${lid}@lid`);
      const query = buildInQuery(
        "SELECT ZCONTACTIDENTIFIER, ZCONTACTJID, ZPARTNERNAME FROM ZWACHATSESSION WHERE ZCONTACTIDENTIFIER IN (",
        ids
      );

      let rows = [];
      try {
        rows = await all(db, query.sql, query.params);
      } catch (e) {
        console.warn("WhatsApp lid mapping query failed:", e?.message || e);
        break;
      }

      const foundLids = new Set();
      for (const r of rows) {
        const identifier = (r?.ZCONTACTIDENTIFIER || "").toString();
        const lidDigits = identifier.endsWith("@lid") ? identifier.slice(0, -4) : identifier;
        if (!lidDigits) continue;

        const phone = normalizeWhatsAppContactJid(r?.ZCONTACTJID || "");
        if (!phone) continue;

        const meta = { phone, partnerName: (r?.ZPARTNERNAME || "").toString() };
        lidToPhone.set(lidDigits, meta);
        phoneToLid.set(phone, lidDigits);
        cap(lidToPhone);
        cap(phoneToLid);

        out.set(lidDigits, meta);
        foundLids.add(lidDigits);
      }

      // Negative cache to avoid repeated lookups
      chunk.forEach((lid) => {
        if (!foundLids.has(lid)) lidToPhone.set(lid, null);
      });
      cap(lidToPhone);
    }

    return out;
  }

  async function lidsForPhones(phoneDigitsList) {
    const phones = Array.from(
      new Set((phoneDigitsList || []).map((v) => String(v || "").trim()).filter(Boolean).map((v) => normalizePhone(v)).filter(Boolean))
    );
    const out = new Map();

    for (const p of phones) {
      if (phoneToLid.has(p)) {
        const cached = phoneToLid.get(p);
        if (cached) out.set(p, cached);
      }
    }

    const missing = phones.filter((p) => !phoneToLid.has(p));
    if (missing.length === 0) return out;

    const db = await ensureDb();
    if (!db) return out;

    const CHUNK = 400;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const jids = chunk.map((p) => `${p}@s.whatsapp.net`);
      const query = buildInQuery(
        "SELECT ZCONTACTJID, ZCONTACTIDENTIFIER FROM ZWACHATSESSION WHERE ZCONTACTJID IN (",
        jids
      );

      let rows = [];
      try {
        rows = await all(db, query.sql, query.params);
      } catch (e) {
        console.warn("WhatsApp phone mapping query failed:", e?.message || e);
        break;
      }

      const foundPhones = new Set();
      for (const r of rows) {
        const phone = normalizeWhatsAppContactJid(r?.ZCONTACTJID || "");
        if (!phone) continue;
        const identifier = (r?.ZCONTACTIDENTIFIER || "").toString();
        const lidDigits = identifier.endsWith("@lid") ? identifier.slice(0, -4) : null;
        phoneToLid.set(phone, lidDigits || null);
        cap(phoneToLid);
        foundPhones.add(phone);
        if (lidDigits) out.set(phone, lidDigits);
      }

      // Negative cache
      chunk.forEach((p) => {
        const key = normalizePhone(p);
        if (key && !foundPhones.has(key)) phoneToLid.set(key, null);
      });
      cap(phoneToLid);
    }

    return out;
  }

  return { phoneForLids, lidsForPhones };
})();

/**
 * Serve the static HTML chat interface.
 */
function serveHtml(req, res) {
  fs.readFile(HTML_PATH, (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Error loading chat UI.");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(data);
  });
}

/**
 * API Endpoint: /api/suggest
 * Generates a draft suggestion using the latest incoming message for a handle.
 * Uses contact KYC/profile context via generateReply(..., recipient).
 */
async function serveSuggest(req, res) {
  if (req.method !== "POST") {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const json = await readJsonBody(req);
    const handle = json.handle || json.recipient || null;
    const providedMessage = (json.message || json.text || "").trim();

    if (!handle) {
      writeJson(res, 400, { error: "Missing handle" });
      return;
    }

    let message = providedMessage;

    if (!message) {
      const handles = contactStore.getAllHandles(handle);
      const { getHistory } = require("./vector-store.js");

      const prefixes = handles.flatMap((h) => pathPrefixesForHandle(h));
      const historyBatches = await Promise.all(prefixes.map((p) => getHistory(p)));
      const docs = historyBatches.flat();

      const messages = docs
        .map((d) => ({
          role: (d.text || "").includes("] Me:") ? "me" : "contact",
          text: stripMessagePrefix(d.text || ""),
          date: extractDateFromText(d.text || ""),
        }))
        .filter((m) => m.date && m.text)
        .sort((a, b) => b.date - a.date);

      const lastIncoming = messages.find((m) => m.role === "contact");
      message = lastIncoming?.text?.trim() || "";
    }

    if (!message) {
      writeJson(res, 200, { suggestion: "Hi — just checking in." });
      return;
    }

    const snippets = await getSnippets(message, 3);
    const suggestion = await generateReply(message, snippets, handle);
    writeJson(res, 200, { suggestion });
  } catch (e) {
    console.error("Suggest error:", e);
    writeJson(res, 500, { error: e.message || "Suggest failed" });
  }
}

/**
 * API Endpoint: /api/suggest-reply
 * Generates a reply suggestion based on the user's message and local knowledge snippets.
 */
function serveSuggestReply(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    let message = "";
    let recipient = null;
    try {
      const json = JSON.parse(body || "{}");
      message = json.message ?? json.text ?? "";
      recipient = json.recipient || null;
    } catch {
      message = body;
    }

    // Retrieve relevant context from the vector store (Hybrid Search).
    const snippets = await getSnippets(message, 3);

    // Generate a suggested reply using the local LLM.
    const suggestion = await generateReply(message, snippets, recipient);

    // Identify contact for UI display
    const contact = contactStore.findContact(recipient);

    writeJson(res, 200, {
      suggestion,
      contact: contact ? { displayName: contact.displayName, profession: contact.profession } : null,
      snippets: snippets.map((s) => ({
        source: s.source,
        path: s.path,
        text: s.text.slice(0, 200) + (s.text.length > 200 ? "…" : "")
      }))
    });
  });
}

/**
 * API Endpoint: /api/kyc
 * GET  /api/kyc?handle=...
 * POST /api/kyc { handle, displayName/profession/relationship/intro } (accepts legacy {name, role} too)
 */
// Migrated to routes/kyc.js

/**
 * API Endpoint: /api/sync-notes
 * Triggers the Apple Notes synchronization process.
 * This runs in the background and updates the vector database with new or modified notes.
 */
function serveSyncNotes(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  console.log("Received request to sync Apple Notes.");

  const settings = withDefaults(readSettings());
  const notesLimit = Number(settings?.worker?.quantities?.notes) || 0;

  // Trigger the sync process. 
  // We return immediately to the UI, but the sync continues in the background.
  syncNotes(notesLimit > 0 ? notesLimit : null)
    .then((stats) => {
      console.log("Sync completed successfully:", stats);
    })
    .catch((err) => {
      console.error("Background sync error:", err);
    });

  // Respond immediately to the client so the UI doesn't hang.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "started", message: "Sync started in background" }));
}

/**
 * API Endpoint: /api/refine-reply
 * Uses Google Gemini to polish a drafted reply.
 */
function serveRefineReply(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    let draft = "";
    let context = "";
    try {
      const json = JSON.parse(body || "{}");
      draft = json.draft || "";
      context = json.context || "";
    } catch {
      draft = body;
    }

    try {
      const refined = await refineReply(draft, context);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ refined }));
    } catch (e) {
      console.error("Gemini Error:", e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

/**
 * API Endpoint: /api/feedback
 * Logs user feedback (Like/Dislike + Reason) to a JSONL file.
 */
function serveFeedback(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const entry = JSON.parse(body || "{}");
      // Add timestamp
      entry.timestamp = new Date().toISOString();

      const logLine = JSON.stringify(entry) + "\n";
      fs.appendFile(path.join(__dirname, "feedback.jsonl"), logLine, (err) => {
        if (err) console.error("Error writing feedback:", err);
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
  });
}

// --- Security Middleware ---

// Rate limiter for sensitive routes (30 req/min per IP)
const sensitiveRateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 30 });

// Routes that are rate-limited (send, sync, settings mutations, bridge ingest)
const RATE_LIMITED_ROUTES = new Set([
  "/api/send-imessage",
  "/api/send-whatsapp",
  "/api/send-linkedin",
  "/api/send-email",
  "/api/sync-imessage",
  "/api/sync-whatsapp",
  "/api/sync-mail",
  "/api/sync-notes",
  "/api/settings",
  "/api/kyc",
  "/api/gmail/disconnect",
  "/api/analyze-contact",
  "/api/channel-bridge/inbound",
]);

// Content Security Policy (restricts inline scripts, external resources)
const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // added unsafe-inline for diagnostics
  // unsafe-eval needed for some JS templates/workers
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // allow Google Fonts
  "img-src 'self' data: blob: https://www.gravatar.com",
  "font-src 'self' https://fonts.gstatic.com", // allow Google Fonts
  "connect-src 'self' ws: wss:",              // Allow WebSockets
  "media-src 'self' blob:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Create the HTTP server and route requests.
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  console.log(`[HTTP] ${req.method} ${url.pathname}${url.search}`);

  const clientIp = resolveClientIp(req);
  // Use a dummy base URL to parse the path relative to the server root.
  const pathname = url.pathname;

  // --- CORS ---
  const origin = req.headers.origin || "";
  const ALLOWED_CORS_ORIGINS = new Set([
    `http://localhost:${boundPort}`,
    `http://127.0.0.1:${boundPort}`,
    "https://www.linkedin.com",
    "https://linkedin.com",
    "https://web.whatsapp.com" // Future proofing
  ]);

  const allowedOrigin = ALLOWED_CORS_ORIGINS.has(origin) ? origin : `http://localhost:${boundPort}`;

  // Only allow allowed origins (or no origin for non-browser clients)
  if (origin && !ALLOWED_CORS_ORIGINS.has(origin)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "CORS: origin not allowed" }));
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Reply-Operator-Token, X-Reply-Human-Approval");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- Content Security Policy ---
  res.setHeader("Content-Security-Policy", CSP_HEADER);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  setOperatorTokenCookie(req, res);

  // --- Rate Limiting (sensitive routes only) ---
  if (RATE_LIMITED_ROUTES.has(pathname) && req.method === "POST") {
    const clientIp = req.socket?.remoteAddress || "unknown";
    if (!sensitiveRateLimiter.isAllowed(clientIp)) {
      const status = sensitiveRateLimiter.getStatus(clientIp);
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil(status.resetMs / 1000)),
      });
      res.end(JSON.stringify({ error: "Too many requests. Please try again later." }));
      return;
    }
  }

  // Serve static files (CSS, JS)
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/')) {
    const filePath = path.join(__dirname, pathname);
    try {
      const content = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath);
      const contentType = {
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json'
      }[ext] || 'text/plain';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, max-age=0',
      });
      res.end(content);
      return;
    } catch (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
  }

  // Serve files from /public (e.g. /public/whatsapp.svg).
  if (pathname.startsWith('/public/')) {
    const fileName = pathname.replace(/^\/public\//, '');
    const filePath = path.join(PUBLIC_DIR, fileName);
    try {
      const content = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = {
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
      }[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, max-age=0',
      });
      res.end(content);
      return;
    } catch {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
  }

  // Backward compatible root SVG path support (e.g. /whatsapp.svg).
  if (/^\/[a-zA-Z0-9_-]+\.svg$/.test(pathname)) {
    const fileName = pathname.slice(1);
    const filePath = path.join(PUBLIC_DIR, fileName);
    try {
      const content = await fs.promises.readFile(filePath);
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-store, max-age=0',
      });
      res.end(content);
      return;
    } catch {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
  }

  if (url.pathname === "/api/thread") {
    const handle = url.searchParams.get("handle");
    const limit = parseInt(url.searchParams.get("limit")) || 30;
    const offset = parseInt(url.searchParams.get("offset")) || 0;

    if (!handle) {
      res.writeHead(400);
      res.end("Missing handle");
      return;
    }

    const handles = contactStore.getAllHandles(handle);
    const { getHistory } = require("./vector-store.js");

    // Add WhatsApp @lid aliases for known phone JIDs so older ingested messages remain discoverable.
    const phoneDigits = handles
      .filter((h) => typeof h === "string" && !h.includes("@"))
      .map((h) => normalizePhone(h))
      .filter(Boolean);

    const lidByPhone = await whatsAppIdResolver.lidsForPhones(phoneDigits);
    const lidHandles = Array.from(new Set(Array.from(lidByPhone.values()).filter(Boolean)));

    const allHandles = Array.from(new Set([...handles, ...lidHandles]));

    // Fetch history for all handles across channels (with normalized variants)
    const prefixes = Array.from(new Set(allHandles.flatMap((h) => pathPrefixesForHandle(h))));

    try {
      const historyBatches = await Promise.all(prefixes.map((p) => getHistory(p)));
      const allDocs = historyBatches.flat();

      // Convert vector docs to message history items and sort by date
      const allMessages = allDocs.map(d => {
        // Extract direction/role from text prefix [Date] Me/Handle: ...
        const isFromMe = (d.text || "").includes("] Me:");
        const dateObj = extractDateFromText(d.text || "");
        return {
          role: isFromMe ? "me" : "contact",
          is_from_me: isFromMe,
          text: stripMessagePrefix(d.text || ""),
          date: dateObj ? dateObj.toISOString() : null,
          channel: channelFromDoc(d),
          source: d.source || null,
          path: d.path || null,
        };
      }).sort((a, b) => {
        const da = a.date ? new Date(a.date) : new Date(0);
        const db = b.date ? new Date(b.date) : new Date(0);
        return db - da;
      });

      const pagedMessages = allMessages.slice(offset, offset + limit);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        messages: pagedMessages,
        hasMore: allMessages.length > offset + limit,
        total: allMessages.length
      }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- Training & Annotations ---
  if (url.pathname === "/api/training/annotations") {
    if (req.method === "GET") {
      try {
        const { getGoldenExamples, getPendingSuggestions } = require("./vector-store.js");
        const goldens = await getGoldenExamples(200);
        const pending = await getPendingSuggestions(50);
        writeJson(res, 200, { annotations: goldens, pending });
      } catch (e) {
        writeJson(res, 500, { error: e.message });
      }
      return;
    }
    if (req.method === "DELETE") {
      const payload = await readJsonBody(req);
      if (!authorizeSensitiveRoute(req, res, { route: "/api/training/annotations", action: "delete-annotation", payload })) return;
      try {
        if (payload.id) {
          const { deleteDocument } = require("./vector-store.js");
          await deleteDocument(payload.id);
        }
        writeJson(res, 200, { status: "ok" });
      } catch (e) {
        writeJson(res, 500, { error: e.message });
      }
      return;
    }
  }

  if (url.pathname === "/api/messages/annotate" && req.method === "POST") {
    const payload = await readJsonBody(req);
    if (!authorizeSensitiveRoute(req, res, { route: "/api/messages/annotate", action: "annotate-message", payload })) return;
    try {
      const { annotateDocument, addDocuments } = require("./vector-store.js");
      if (payload.id && (payload.is_annotated === false || payload.is_annotated === undefined)) {
        // This is moving a suggestion to goldens
        await annotateDocument(payload.id, true);
      } else if (payload.text) {
        // Adding a fresh golden
        await addDocuments([{
          id: `urn:reply:manual:${Date.now()}`,
          text: payload.text,
          source: payload.source || "manual",
          path: payload.path || "manual://gui",
          is_annotated: true
        }]);
      }
      writeJson(res, 200, { status: "ok" });
    } catch (e) {
      writeJson(res, 500, { error: e.message });
    }
    return;
  }
  if (url.pathname === "/api/suggest") {
    await serveSuggest(req, res);
    return;
  }
  if (url.pathname === "/api/settings") {
    if (req.method === "GET") {
      const settings = readSettings();
      writeJson(res, 200, maskSettingsForClient(settings));
      return;
    }
    if (req.method === "POST") {
      try {
        const incoming = await readJsonBody(req);
        if (!authorizeSensitiveRoute(req, res, {
          route: "/api/settings",
          action: "update-settings",
          payload: incoming,
        })) {
          return;
        }
        const current = withDefaults(readSettings());
        const next = { ...current };

        const imap = incoming?.imap || {};
        if (imap && typeof imap === "object") {
          next.imap = { ...(current.imap || {}) };
          if (typeof imap.host === "string") next.imap.host = imap.host.trim();
          if (imap.port !== undefined) next.imap.port = parseInt(imap.port, 10) || 993;
          if (imap.secure !== undefined) next.imap.secure = !!imap.secure;
          if (typeof imap.user === "string") next.imap.user = imap.user.trim();
          if (typeof imap.mailbox === "string") next.imap.mailbox = imap.mailbox.trim() || "INBOX";
          if (typeof imap.sentMailbox === "string") next.imap.sentMailbox = imap.sentMailbox.trim();
          if (imap.limit !== undefined) next.imap.limit = Math.max(1, Math.min(parseInt(imap.limit, 10) || 200, 2000));
          if (imap.sinceDays !== undefined) next.imap.sinceDays = Math.max(1, Math.min(parseInt(imap.sinceDays, 10) || 30, 3650));
          if (typeof imap.selfEmails === "string") next.imap.selfEmails = imap.selfEmails.trim();

          // Password: if blank/omitted, keep existing.
          if (typeof imap.pass === "string") {
            const p = imap.pass;
            if (p.trim()) next.imap.pass = p;
          }
        }

        const gmail = incoming?.gmail || {};
        if (gmail && typeof gmail === "object") {
          next.gmail = { ...(current.gmail || {}) };
          if (typeof gmail.clientId === "string") next.gmail.clientId = gmail.clientId.trim();
          if (typeof gmail.redirectUri === "string") next.gmail.redirectUri = gmail.redirectUri.trim();
          // Client secret: if blank, keep.
          if (typeof gmail.clientSecret === "string") {
            const s = gmail.clientSecret;
            if (s.trim()) next.gmail.clientSecret = s;
          }
          const sync = gmail.sync || {};
          if (sync && typeof sync === "object") {
            next.gmail.sync = { ...(current.gmail?.sync || {}) };
            if (typeof sync.scope === "string") {
              const scope = sync.scope.trim();
              if (["inbox_sent", "all_mail", "custom"].includes(scope)) next.gmail.sync.scope = scope;
            }
            if (typeof sync.query === "string") {
              next.gmail.sync.query = sync.query.trim().slice(0, 500);
            }
          }
        }

        const global = incoming?.global || {};
        if (global && typeof global === "object") {
          next.global = { ...(current.global || {}) };
          if (typeof global.googleApiKey === "string") {
            const val = global.googleApiKey.trim();
            if (val) next.global.googleApiKey = val;
          }
          if (typeof global.operatorToken === "string") {
            const val = global.operatorToken.trim();
            if (val) next.global.operatorToken = val;
          }
          if (global.requireOperatorToken !== undefined) next.global.requireOperatorToken = !!global.requireOperatorToken;
          if (global.localWritesOnly !== undefined) next.global.localWritesOnly = !!global.localWritesOnly;
          if (global.requireHumanApproval !== undefined) next.global.requireHumanApproval = !!global.requireHumanApproval;
          if (typeof global.whatsappTransport === "string") {
            const val = global.whatsappTransport.trim();
            if (["openclaw_cli", "desktop_automation"].includes(val)) next.global.whatsappTransport = val;
          }
          if (global.allowOpenClaw !== undefined) next.global.allowOpenClaw = !!global.allowOpenClaw;
          if (global.desktopFallback !== undefined) next.global.desktopFallback = !!global.desktopFallback;
        }

        const worker = incoming?.worker || {};
        if (worker && typeof worker === "object") {
          next.worker = { ...(current.worker || {}) };
          if (worker.pollIntervalSeconds !== undefined) {
            const v = parseInt(worker.pollIntervalSeconds, 10);
            next.worker.pollIntervalSeconds = Number.isFinite(v) ? Math.max(10, Math.min(v, 3600)) : current.worker.pollIntervalSeconds;
          }
          const q = worker.quantities || {};
          if (q && typeof q === "object") {
            next.worker.quantities = { ...(current.worker?.quantities || {}) };
            const clamp = (val, def, max) => {
              const v = parseInt(val, 10);
              if (!Number.isFinite(v)) return def;
              return Math.max(0, Math.min(v, max));
            };
            if (q.imessage !== undefined) next.worker.quantities.imessage = clamp(q.imessage, current.worker.quantities.imessage, 5000);
            if (q.whatsapp !== undefined) next.worker.quantities.whatsapp = clamp(q.whatsapp, current.worker.quantities.whatsapp, 2000);
            if (q.gmail !== undefined) next.worker.quantities.gmail = clamp(q.gmail, current.worker.quantities.gmail, 500);
            if (q.notes !== undefined) next.worker.quantities.notes = clamp(q.notes, current.worker.quantities.notes, 5000);
          }
        }

        const ui = incoming?.ui || {};
        if (ui && typeof ui === "object") {
          next.ui = { ...(current.ui || {}) };
          const channels = ui.channels || {};
          if (channels && typeof channels === "object") {
            next.ui.channels = { ...(current.ui?.channels || {}) };
            for (const key of ["imessage", "whatsapp", "email", "linkedin"]) {
              if (!channels[key] || typeof channels[key] !== "object") continue;
              next.ui.channels[key] = { ...(current.ui.channels[key] || {}) };
              const ch = channels[key];
              if (typeof ch.emoji === "string") next.ui.channels[key].emoji = ch.emoji.trim().slice(0, 4);
              if (typeof ch.bubbleMe === "string") next.ui.channels[key].bubbleMe = ch.bubbleMe.trim().slice(0, 32);
              if (typeof ch.bubbleContact === "string") next.ui.channels[key].bubbleContact = ch.bubbleContact.trim().slice(0, 32);
            }
          }
        }

        const channelBridge = incoming?.channelBridge || {};
        if (channelBridge && typeof channelBridge === "object") {
          next.channelBridge = { ...(current.channelBridge || {}), channels: { ...(current.channelBridge?.channels || {}) } };
          const channels = channelBridge.channels || {};
          if (channels && typeof channels === "object") {
            for (const key of CHANNEL_BRIDGE_CHANNELS) {
              if (!channels[key] || typeof channels[key] !== "object") continue;
              const mode = String(channels[key].inboundMode || "").trim().toLowerCase();
              if (!next.channelBridge.channels[key]) next.channelBridge.channels[key] = {};
              if (mode === "draft_only" || mode === "disabled") {
                next.channelBridge.channels[key].inboundMode = mode;
              }
            }
          }
        }

        writeSettings(next);
        writeJson(res, 200, { status: "ok" });
      } catch (e) {
        writeJson(res, 500, { error: e.message || "Failed to save settings" });
      }
      return;
    }

    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }
  if (url.pathname === "/api/gmail/auth-url") {
    try {
      const settings = readSettings();
      const gmail = settings?.gmail || {};
      if (!gmail.clientId || !gmail.clientSecret) {
        writeJson(res, 400, { error: "Missing Gmail clientId/clientSecret in Settings" });
        return;
      }

      const baseUrl = `http://${req.headers.host}`;
      const redirectUri = `${baseUrl}/api/gmail/oauth-callback`;

      const state = crypto.randomBytes(16).toString("hex");
      gmailOauthState = { value: state, createdAt: Date.now() };

      const urlStr = buildAuthUrl({ clientId: gmail.clientId, redirectUri, state });
      writeJson(res, 200, { url: urlStr, redirectUri });
    } catch (e) {
      writeJson(res, 500, { error: e.message || "Failed to start Gmail auth" });
    }
    return;
  }
  if (url.pathname === "/api/gmail/oauth-callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err = url.searchParams.get("error");
    if (err) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end(`Gmail OAuth error: ${err}`);
      return;
    }
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing OAuth code");
      return;
    }
    if (!gmailOauthState || gmailOauthState.value !== state || (Date.now() - gmailOauthState.createdAt) > 10 * 60 * 1000) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Invalid OAuth state. Please try Connect Gmail again.");
      return;
    }

    try {
      const baseUrl = `http://${req.headers.host}`;
      const redirectUri = `${baseUrl}/api/gmail/oauth-callback`;
      await connectGmailFromCallback({ code, redirectUri });
      gmailOauthState = null;
      res.writeHead(302, { Location: `${baseUrl}/?gmail=connected` });
      res.end();
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Failed to connect Gmail: ${e.message}`);
    }
    return;
  }
  if (url.pathname === "/api/gmail/disconnect") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const payload = await readJsonBody(req);
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/gmail/disconnect",
      action: "disconnect-gmail",
      payload,
    })) {
      return;
    }
    try {
      await disconnectGmail();
      writeJson(res, 200, { status: "ok" });
    } catch (e) {
      writeJson(res, 500, { error: e.message || "Failed to disconnect Gmail" });
    }
    return;
  }
  if (url.pathname === "/api/gmail/check") {
    try {
      const { checkGmailConnection } = require("./gmail-connector.js");
      const info = await checkGmailConnection();
      writeJson(res, 200, { status: "ok", ...info });
    } catch (e) {
      writeJson(res, 500, { status: "error", error: e?.message || String(e) });
    }
    return;
  }
  if (url.pathname === "/api/sync-mail") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const payload = await readJsonBody(req);
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/sync-mail",
      action: "sync-mail",
      payload,
    })) {
      return;
    }
    console.log("Starting Mail sync in background...");
    const { syncMail } = require("./sync-mail.js");
    syncMail().then(count => {
      console.log(`Mail sync completed: ${count} emails.`);
    }).catch(err => {
      console.error(`Mail sync error: ${err.message}`);
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "started", message: "Mail sync started in background" }));
    return;
  }
  if (url.pathname === "/api/channel-bridge/inbound") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const payload = await readJsonBody(req);
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/channel-bridge/inbound",
      action: "channel-bridge-inbound",
      payload,
      requireHumanApproval: false,
    })) {
      return;
    }

    try {
      // payload is already read above
      const events = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.events) ? payload.events : [payload]);

      if (!events.length) {
        writeJson(res, 400, { error: "Inbound payload is empty." });
        return;
      }

      const settings = readSettings();
      const normalizedForPolicy = events.map((evt) => normalizeInboundEvent(evt));
      const denied = normalizedForPolicy
        .map((event, index) => ({
          index,
          channel: event.channel,
          inboundMode: getChannelBridgeInboundMode(settings, event.channel),
        }))
        .filter((x) => x.inboundMode !== "draft_only");

      if (denied.length > 0) {
        writeJson(res, 403, {
          error: "Channel bridge inbound is disabled for one or more channels.",
          code: "channel_bridge_disabled",
          denied,
        });
        return;
      }

      const globalDryRun = payload?.dryRun === true;
      const allDryRun = globalDryRun || events.every((evt) => evt?.dryRun === true);

      if (allDryRun) {
        const normalized = normalizedForPolicy.map((event, idx) => {
          const doc = toVectorDoc(event);
          return {
            index: idx,
            status: "dry-run",
            event,
            doc: { id: doc.id, source: doc.source, path: doc.path },
          };
        });

        if (normalized.length === 1) {
          writeJson(res, 200, normalized[0]);
          return;
        }

        writeJson(res, 200, {
          status: "dry-run",
          total: normalized.length,
          results: normalized,
        });
        return;
      }

      const ingestInput = globalDryRun
        ? events.map((evt) => ({ ...(evt || {}), dryRun: false }))
        : events;

      if (ingestInput.length === 1) {
        const out = await ingestInboundEvent(ingestInput[0]);
        if (!out.duplicate) invalidateConversationCaches();
        writeJson(res, 200, {
          status: out.duplicate ? "duplicate" : "ok",
          event: out.event,
          doc: out.doc,
          duplicate: Boolean(out.duplicate),
        });
        return;
      }

      const out = await ingestInboundEvents(ingestInput, { failFast: false });
      if (out.accepted > 0) invalidateConversationCaches();
      writeJson(res, 200, {
        status: out.errors > 0 ? "partial" : "ok",
        accepted: out.accepted,
        skipped: out.skipped,
        errors: out.errors,
        total: out.total,
        results: out.results,
      });
    } catch (e) {
      writeJson(res, 400, { error: e?.message || "Invalid channel bridge payload" });
    }
    return;
  }
  if (url.pathname === "/api/channel-bridge/events") {
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 500));
    const events = readBridgeEventLog(limit);
    writeJson(res, 200, {
      status: "ok",
      total: events.length,
      events,
    });
    return;
  }
  if (url.pathname === "/api/import/linkedin") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      if (!isHumanApproved(req) && !isLocalRequest(req)) {
        writeJson(res, 403, { error: "Import requires local access or human approval." });
        return;
      }

      const csvText = await readTextBody(req);
      if (!csvText || csvText.length < 10) {
        writeJson(res, 400, { error: "Empty or invalid CSV file." });
        return;
      }

      const { ingestLinkedInContactsFromString } = require("./ingest-linkedin-contacts.js");
      const { ingestLinkedInPostsFromString } = require("./ingest-linkedin-posts.js");

      const rows = parseLinkedInCSV(csvText);
      if (rows.length === 0) {
        writeJson(res, 400, { error: "No valid rows found in CSV." });
        return;
      }

      // 1. Detect if it's Connections.csv or Shares.csv (LinkedIn Message backup handled by parseLinkedInCSV)
      const firstRow = rows[0] || {};
      if (firstRow['First Name'] && firstRow['Last Name'] && firstRow['Email Address']) {
        const result = await ingestLinkedInContactsFromString(csvText);
        writeJson(res, 200, { count: result.count, errors: 0 });
        return;
      }
      if (firstRow['ShareCommentary'] || firstRow['Content']) {
        const result = await ingestLinkedInPostsFromString(csvText);
        writeJson(res, 200, { count: result.count, errors: 0 });
        return;
      }

      // Fallback: Continue with existing message import logic
      console.log(`[Import] Parsed ${rows.length} rows from LinkedIn CSV.`);

      let imported = 0;
      let errors = 0;
      const events = [];

      for (const row of rows) {
        const timestamp = safeDateMs(row.DATE) ? new Date(row.DATE).toISOString() : new Date().toISOString();
        const direction = (row.DIRECTION || "").toUpperCase();

        let sender = row.FROM || "Unknown";
        let recipient = row.TO || "Me";
        if (sender === "LinkedIn Member") sender = "Unknown User";

        let peerHandle = "";
        let peerName = "";
        let flow = "inbound";

        if (direction === "OUTGOING") {
          flow = "outbound";
          peerName = recipient;
          peerHandle = "linkedin://" + recipient.replace(/\s+/g, "").toLowerCase();
        } else {
          flow = "inbound";
          peerName = sender;
          peerHandle = "linkedin://" + sender.replace(/\s+/g, "").toLowerCase();
        }

        if (!peerName || peerName === "Me") continue;

        events.push({
          channel: "linkedin",
          flow,
          timestamp,
          text: row.CONTENT || "",
          peer: {
            handle: peerHandle,
            displayName: peerName,
            isGroup: false
          },
          threadId: peerHandle,
          dryRun: false
        });
      }

      const BATCH_SIZE = 50;
      for (let i = 0; i < events.length; i += BATCH_SIZE) {
        const batch = events.slice(i, i + BATCH_SIZE);
        const results = await ingestInboundEvents(batch, { failFast: false });
        imported += results.accepted;
        errors += results.errors;
      }

      writeJson(res, 200, {
        status: "ok",
        count: imported,
        errors,
        message: `Imported ${imported} messages.`
      });

    } catch (e) {
      console.error("Import error:", e);
      writeJson(res, 500, { error: e.message });
    }
    return;
  }
  if (url.pathname === "/api/channel-bridge/summary") {
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 2000));
    const summary = buildChannelBridgeSummary({ limit });
    writeJson(res, 200, { status: "ok", summary });
    return;
  }
  if (url.pathname === "/api/conversations") {
    const limit = parseInt(url.searchParams.get("limit")) || 20;
    const offset = parseInt(url.searchParams.get("offset")) || 0;
    const q = (url.searchParams.get("q") || url.searchParams.get("query") || "").toString();

    try {
      const bridgeSettings = readSettings();
      const { items } = await getConversationsIndexFresh();
      const filtered = q && q.trim()
        ? items.filter((c) => matchesQuery(buildSearchHaystack(c.contact, c), q))
        : items;

      const page = filtered.slice(offset, offset + limit);
      const enriched = await mapLimit(page, 4, async (c) => {
        const contact = c.contact || null;
        const hasDraft = contact?.status === "draft" && contact?.draft;
        const displayName = (contact?.displayName || contact?.name || c.handle).toString();

        let stats = null;
        try {
          stats = await getConversationStatsForHandle(c.handle, contact);
        } catch (e) {
          console.warn("Conversation stats failed:", c.handle, e?.message || e);
        }

        const lastChannel = (stats?.channel || c.channel || contact?.lastChannel || "").toString();
        const lastSource = stats?.source || c.source || null;
        const lastContacted =
          contact?.lastContacted ||
          stats?.previewDate ||
          (c.sortTime ? new Date(c.sortTime).toISOString() : null);
        const bridgePolicy = getBridgePolicyForChannel(lastChannel, bridgeSettings);

        return {
          id: contact?.id || c.handle,
          displayName,
          handle: stats?.latestHandle || c.latestHandle || c.handle,
          latestHandle: stats?.latestHandle || c.latestHandle || c.handle,
          count: Number.isFinite(Number(stats?.count)) ? Number(stats.count) : 0,
          lastMessage: hasDraft
            ? `Draft: ${String(contact.draft).slice(0, 50)}...`
            : (stats?.preview ? String(stats.preview).slice(0, 80) : "Click to see history"),
          status: contact?.status || "open",
          draft: contact?.draft || null,
          channel: lastChannel,
          lastChannel,
          lastSource,
          lastContacted: lastContacted || null,
          bridgePolicy,
        };
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        contacts: enriched,
        hasMore: filtered.length > offset + limit,
        total: filtered.length,
        meta: { mode: "db", q: q || "" },
      }));
    } catch (err) {
      console.error("Error loading conversations from database:", err);
      // Fallback to contact store if database query fails
      const { getHistory } = require("./vector-store.js");
      const bridgeSettings = readSettings();

      async function statsForContactHandle(handle) {
        if (!handle) return { count: 0, channel: null, source: null, preview: null, previewDate: null };

        const handles = contactStore.getAllHandles(handle);
        const phoneDigits = handles
          .filter((h) => typeof h === "string" && !h.includes("@"))
          .map((h) => normalizePhone(h))
          .filter(Boolean);
        const lidByPhone = await whatsAppIdResolver.lidsForPhones(phoneDigits);
        const lidHandles = Array.from(new Set(Array.from(lidByPhone.values()).filter(Boolean)));

        const allHandles = Array.from(new Set([...handles, ...lidHandles]));
        const prefixes = Array.from(new Set(allHandles.flatMap((h) => pathPrefixesForHandle(h))));

        const historyBatches = await Promise.all(prefixes.map((p) => getHistory(p)));
        const docs = historyBatches.flat();
        if (docs.length === 0) return { count: 0, channel: null, source: null, preview: null, previewDate: null };

        const enriched = docs
          .map((d) => ({
            text: stripMessagePrefix(d.text || "").trim(),
            date: extractDateFromText(d.text || ""),
            channel: channelFromDoc(d),
            source: d.source || null,
          }))
          .filter((d) => d.date && d.text)
          .sort((a, b) => b.date - a.date);

        const latest = enriched[0] || null;
        return {
          count: docs.length,
          channel: latest?.channel || null,
          source: latest?.source || null,
          preview: latest?.text || null,
          previewDate: latest?.date ? latest.date.toISOString() : null,
        };
      }

      const contacts = await contactStore.refresh();
      const list = (await Promise.all(
        contacts
          .sort((a, b) => {
            const da = a.lastContacted ? new Date(a.lastContacted) : new Date(0);
            const db = b.lastContacted ? new Date(b.lastContacted) : new Date(0);
            return db - da;
          })
          .slice(offset, offset + limit)
          .map(async (c) => {
            const hasDraft = c.status === "draft" && c.draft;
            const inferredChannel = (() => {
              if (c.lastChannel) return c.lastChannel;
              const h = (c.handle || "").toString();
              if (h.includes("@")) return "email";
              if (h.trim().startsWith("+")) return "imessage";
              // Heuristics: WhatsApp identifiers are often digits without "+" or include a dash (e.g. groups).
              if (h.includes("-")) return "whatsapp";
              if (/^\d{11,}$/.test(h.replace(/\s+/g, ""))) return "whatsapp";
              return "imessage";
            })();

            const stats = await statsForContactHandle(c.handle);

            return {
              id: c.id,
              displayName: c.displayName,
              handle: c.handle,
              count: stats.count || 0,
              lastMessage: hasDraft
                ? `Draft: ${c.draft.slice(0, 50)}...`
                : (stats.preview ? stats.preview.slice(0, 80) : "Click to see history"),
              status: c.status || "open",
              draft: c.draft || null,
              channel: stats.channel || inferredChannel,
              lastChannel: c.lastChannel || stats.channel || inferredChannel,
              lastSource: stats.source || (inferredChannel === "whatsapp" ? "WhatsApp" : (inferredChannel === "email" ? "Mail" : "iMessage")),
              lastContacted: c.lastContacted || stats.previewDate,
              bridgePolicy: getBridgePolicyForChannel(c.lastChannel || stats.channel || inferredChannel, bridgeSettings),
            };
          })
      )).filter(Boolean);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        contacts: list,
        hasMore: contacts.length > offset + limit,
        total: contacts.length,
        meta: { mode: "fallback", error: err?.message || String(err) },
      }));
    }
    return;
  }
  if (url.pathname === "/api/suggest-reply") {
    serveSuggestReply(req, res);
    return;
  }
  if (url.pathname === "/api/kyc") {
    let bodyData = null;
    if (req.method === "POST") {
      bodyData = await readJsonBody(req);
      console.log(`[API] POST /api/kyc - handle=${bodyData?.handle}`, JSON.stringify(bodyData));
    } else {
      console.log(`[API] GET /api/kyc - handle=${url.searchParams.get("handle")}`);
    }
    await serveKyc(req, res, url, authorizeSensitiveRoute, () => {
      invalidateConversationCaches();
    }, bodyData);
    return;
  }
  if (url.pathname === "/api/sync-notes") {
    const payload = req.method === "POST" ? await readJsonBody(req) : {};
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/sync-notes",
      action: "sync-notes",
      payload,
    })) {
      return;
    }
    serveSyncNotes(req, res);
    return;
  }
  if (url.pathname === "/api/sync-imessage") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const payload = await readJsonBody(req);
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/sync-imessage",
      action: "sync-imessage",
      payload,
    })) {
      return;
    }
    console.log("Starting iMessage sync in background...");
    execFile(process.execPath, [path.join(__dirname, "sync-imessage.js")], { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Sync error: ${error.message}`);
        return;
      }
      if (stderr) console.warn(`Sync stderr: ${stderr}`);
      console.log(`Sync completed: ${stdout.trim()}`);
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "started", message: "iMessage sync started in background" }));
    return;
  }
  if (url.pathname === "/api/send-imessage") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const payload = await readJsonBody(req);
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/send-imessage",
      action: "send-imessage",
      payload,
    })) {
      return;
    }

    const recipient = (payload?.recipient || "").toString().trim();
    const text = (payload?.text || "").toString();
    if (!recipient || !text) {
      writeJson(res, 400, { error: "Missing recipient or text" });
      return;
    }

    // Guard: iMessage only works with phone numbers or email addresses.
    // Reject any handle that looks like a non-iMessage URI (e.g. linkedin://, whatsapp://)
    const NON_IMESSAGE_SCHEMES = ["linkedin://", "whatsapp://", "telegram://", "discord://", "signal://"];
    if (NON_IMESSAGE_SCHEMES.some(scheme => recipient.startsWith(scheme))) {
      writeJson(res, 400, {
        error: `Cannot send iMessage to '${recipient}': handle appears to be a ${recipient.split("://")[0]} contact, not iMessage.`,
        code: "INVALID_IMESSAGE_RECIPIENT"
      });
      return;
    }

    const appleScript = `
on run argv
  set recipientId to item 1 of argv
  set msg to item 2 of argv
  tell application "Messages"
    set targetService to 1st service whose service type is iMessage
    set targetBuddy to buddy recipientId of targetService
    send msg to targetBuddy
  end tell
end run
    `;

    execFile("/usr/bin/osascript", ["-e", appleScript, "--", recipient, text], async (error) => {
      if (error) {
        console.error(`Send error: ${error}`);
        writeJson(res, 500, { error: error.message });
        return;
      }
      await contactStore.clearDraft(recipient);
      await autoAnnotateSentMessage("imessage", recipient, text);
      writeJson(res, 200, { status: "ok" });
    });
    return;
  }
  if (url.pathname === "/api/send-whatsapp") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const payload = await readJsonBody(req);
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/send-whatsapp",
      action: "send-whatsapp",
      payload,
    })) {
      return;
    }
    if (!isManualUiWhatsAppSend(payload)) {
      denySensitiveRoute(req, res, {
        route: "/api/send-whatsapp",
        action: "send-whatsapp",
        code: "manual_ui_send_required",
        message: "WhatsApp send is restricted to manual UI sends from {reply}.",
        hint: "Use the {reply} UI Send button after human review/approval.",
        statusCode: 403,
        dryRun: Boolean(payload?.dryRun),
      });
      return;
    }
    if (!hasHumanEnterTrigger(payload)) {
      denySensitiveRoute(req, res, {
        route: "/api/send-whatsapp",
        action: "send-whatsapp",
        code: "human_enter_trigger_required",
        message: "WhatsApp send requires explicit human Enter trigger from UI.",
        hint: "Send from {reply} UI using Enter/Send button; trigger expires after 2 minutes.",
        statusCode: 403,
        dryRun: Boolean(payload?.dryRun),
      });
      return;
    }
    const recipientRaw = (payload?.recipient || "").toString().trim();
    const textRaw = (payload?.text || "").toString();
    const dryRun = Boolean(payload?.dryRun);

    if (!recipientRaw || !textRaw) {
      writeJson(res, 400, { error: "Missing recipient or text" });
      return;
    }

    // WhatsApp search works best with digits/+; keep user formatting but remove extra whitespace.
    const recipient = recipientRaw.replace(/\s+/g, "");
    const text = textRaw.replace(/\r\n/g, "\n");
    const requestedTransport = resolveWhatsAppSendTransport(payload?.transport);
    if (requestedTransport === "openclaw_cli" && !resolveWhatsAppOpenClawSendEnabled()) {
      writeJson(res, 403, {
        error: "OpenClaw WhatsApp outbound is disabled by policy.",
        code: "openclaw_whatsapp_send_disabled",
        hint: "Use Desktop send path in {reply}; keep OpenClaw for inbound/draft assistance only.",
        transport: "openclaw_cli_blocked",
      });
      return;
    }
    let transport = requestedTransport;
    let openclawFallback = null;

    if (requestedTransport === "openclaw_cli") {
      try {
        const result = await sendWhatsAppViaOpenClawCli({ recipient, text, dryRun });
        await contactStore.clearDraft(recipientRaw);
        writeJson(res, 200, {
          status: "ok",
          transport: requestedTransport,
          result: result.parsed || result.raw || "ok",
        });
        return;
      } catch (e) {
        const shortErr = normalizeSendErrorMessage(
          e?.message,
          "OpenClaw WhatsApp send failed."
        );
        const hint = String(
          e?.hint ||
          "Ensure OpenClaw CLI is installed, gateway is running, and WhatsApp Web is linked."
        );
        const fallbackEnabled = resolveWhatsAppDesktopFallbackOnOpenClawFailure(
          payload?.allowDesktopFallback
        );
        const fallbackEligible = isOpenClawDesktopFallbackEligible(e);
        if (!fallbackEnabled || !fallbackEligible) {
          console.error("Send WhatsApp (OpenClaw) error:", shortErr);
          writeJson(res, 500, {
            error: shortErr,
            hint,
            transport: requestedTransport,
          });
          return;
        }
        console.warn(
          "Send WhatsApp (OpenClaw) failed; retrying with desktop automation:",
          shortErr
        );
        transport = "desktop_fallback";
        openclawFallback = {
          from: requestedTransport,
          reason: shortErr,
          hint,
        };
      }
    }

    const appCandidates = [
      process.env.WHATSAPP_APP_NAME,
      "WhatsApp",
      "WhatsApp Beta",
    ]
      .map((v) => (v || "").toString().trim())
      .filter(Boolean)
      .filter((v, idx, arr) => arr.indexOf(v) === idx);

    const candidateList = appCandidates.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(", ");

    const appleScript = `
on run argv
  set target to item 1 of argv
  set msg to item 2 of argv
  set dryRun to false
  try
    set dr to (item 3 of argv as string)
    if dr is "1" or dr is "true" then set dryRun to true
  end try
  set candidates to {${candidateList}}

  set appName to my pickRunningApp(candidates)
  if appName is "" then error "WhatsApp is not running."

  set the clipboard to msg
  tell application appName to activate
  delay 0.6

  tell application "System Events"
    set p to process appName
    tell p
      set frontmost to true
      delay 0.25

      -- Close any popovers/modals that might steal focus
      key code 53 -- escape
	      delay 0.15
	
	      -- Wait for a WhatsApp window to exist (activation can be slow)
	      repeat 30 times
	        if (count of windows) > 0 then exit repeat
	        delay 0.2
	      end repeat
	      if (count of windows) = 0 then error "No WhatsApp window available."

	      set w to window 1

        -- Compute thresholds relative to the WhatsApp window position.
        -- Using absolute Y constants is flaky when the window is not near the top of the screen.
        set wpos to position of w
        set wsz to size of w
        set wy to item 2 of wpos
        set wh to item 2 of wsz
        set searchThresholdY to (wy + 260) as integer
        set composerMinY to (wy + (wh * 0.55)) as integer

	      -- Try to enter search/new chat using shortcuts, then fall back to focusing the top text field directly.
	      -- We NEVER type the target unless focus is in the top area.
	      set focusedOk to my focusLooksAboveY(p, searchThresholdY)
	      if focusedOk is false then
	        keystroke "k" using {command down}
	        delay 0.25
	        set focusedOk to my focusLooksAboveY(p, searchThresholdY)
	      end if
	      if focusedOk is false then
	        keystroke "f" using {command down}
	        delay 0.25
	        set focusedOk to my focusLooksAboveY(p, searchThresholdY)
	      end if
	      if focusedOk is false then
	        keystroke "n" using {command down}
	        delay 0.25
	        set focusedOk to my focusLooksAboveY(p, searchThresholdY)
	      end if
	      if focusedOk is false then
	        set focusedOk to my focusTopTextField(w, searchThresholdY)
	      end if
	      -- Focus can settle asynchronously; re-check a few times before failing.
	      repeat 10 times
	        if my focusLooksAboveY(p, searchThresholdY) then
	          set focusedOk to true
	          exit repeat
	        end if
	        delay 0.08
	      end repeat
	      if focusedOk is false then error "Failed to focus WhatsApp search. Check=" & my focusCheck(p, searchThresholdY)

	      -- Clear any prior search text
	      keystroke "a" using {command down}
	      delay 0.05
	      key code 51 -- delete
	      delay 0.1

	      -- Type the recipient and only press enter if we're still in the search area (prevents sending the number as a message).
	      if my focusLooksAboveY(p, searchThresholdY) is false then error "Search focus lost; aborting to avoid sending the recipient. Focus=" & my focusDebug(p)
	      keystroke target
	      delay 0.35
	      if my focusLooksAboveY(p, searchThresholdY) is false then error "Search focus lost; aborting to avoid sending the recipient. Focus=" & my focusDebug(p)
	      key code 36 -- enter to open the chat (often opens first match)
	      delay 0.6
	
	      -- Some WhatsApp builds keep focus in the search field after Enter; try selecting the first result.
	      if my focusLooksAboveY(p, searchThresholdY) then
	        key code 125 -- down arrow
	        delay 0.12
	        key code 36 -- enter
	        delay 0.7
	      end if
		
	      -- Ensure the message composer is focused before pasting
	      set composerOk to false
	      try
	        -- Prefer a deterministic click in the composer area (more reliable than tabbing across unknown UI trees).
	        repeat with offVal in {90, 140, 190}
	          set offNum to contents of offVal
	          if my clickWindowBottom(w, offNum) then
	            delay 0.18
	            if my focusLooksBelowY(p, composerMinY) then
	              set composerOk to true
	              exit repeat
	            end if
	          end if
	        end repeat
	      end try

	      if composerOk is false then
	        -- Fallback: tab around a bit.
	        repeat 12 times
	          key code 48 -- tab
	          delay 0.12
	          if my focusLooksBelowY(p, composerMinY) then
	            set composerOk to true
	            exit repeat
	          end if
	        end repeat
	      end if

	      if composerOk is false then error "Failed to focus WhatsApp message composer. Check=" & my focusCheck(p, composerMinY)

	      if dryRun is true then return "dry-run"
	      keystroke "v" using {command down}
	      delay 0.15
	      key code 36 -- send
    end tell
  end tell

  return "ok"
end run

on pickRunningApp(candidates)
  tell application "System Events"
    repeat with n in candidates
      if exists process (contents of n) then return (contents of n)
    end repeat
  end tell
  return ""
end pickRunningApp

using terms from application "System Events"
on focusLooksAboveY(p, maxY)
  try
    set el to value of attribute "AXFocusedUIElement" of p
    set y to missing value
    try
      set fr to value of attribute "AXFrame" of el
      set y to item 2 of fr
    end try
    if y is missing value then
      try
        set pos to value of attribute "AXPosition" of el
        set y to item 2 of pos
      end try
    end if
    set yNum to my numFrom(y)
    set maxNum to my numFrom(maxY)
    if yNum is not missing value and maxNum is not missing value then
      if yNum < maxNum then return true
    end if
  end try
  return false
end focusLooksAboveY

on focusLooksBelowY(p, minY)
  try
    set el to value of attribute "AXFocusedUIElement" of p
    set y to missing value
    try
      set fr to value of attribute "AXFrame" of el
      set y to item 2 of fr
    end try
    if y is missing value then
      try
        set pos to value of attribute "AXPosition" of el
        set y to item 2 of pos
      end try
    end if
    set yNum to my numFrom(y)
    set minNum to my numFrom(minY)
    if yNum is not missing value and minNum is not missing value then
      if yNum > minNum then return true
    end if
  end try
  return false
end focusLooksBelowY

on focusBottomTextArea(w, minY)
  set best to missing value
  set bestY to -1

  try
    set ta to every text area of w
    repeat with el in ta
      set y to my yOf(el)
      if y is not missing value and y > (minY as real) and y > bestY then
        set bestY to y
        set best to el
      end if
    end repeat
  end try

  if best is missing value then
    try
      set tf to every text field of w
      repeat with el in tf
        set y to my yOf(el)
        if y is not missing value and y > (minY as real) and y > bestY then
          set bestY to y
          set best to el
        end if
      end repeat
    end try
  end if

  if best is missing value then return false
  return my tryFocus(best)
end focusBottomTextArea

on focusTopTextField(w, maxY)
  try
    set tf to every text field of w
    repeat with el in tf
      set y to my yOf(el)
      if y is not missing value and y < (maxY as real) then
        if my tryFocus(el) then return true
      end if
    end repeat
  end try

  -- Fallback: scan the entire window tree for any text-like element near the top.
  try
    set els to entire contents of w
    set best to missing value
    set bestY to 999999
    repeat with el in els
      try
        set r to (value of attribute "AXRole" of el) as string
        if r is "AXTextField" or r is "AXSearchField" or r is "AXTextArea" then
          set y to my yOf(el)
          if y is not missing value and y < (maxY as real) and y < bestY then
            set bestY to y
            set best to el
          end if
        end if
      end try
    end repeat
    if best is not missing value then
      if my tryFocus(best) then return true
    end if
  end try

  return false
end focusTopTextField

on yOf(el)
  set y to missing value
  try
    set fr to value of attribute "AXFrame" of el
    set y to item 2 of fr
  end try
  if y is missing value then
    try
      set pos to value of attribute "AXPosition" of el
      set y to item 2 of pos
    end try
  end if
  return my numFrom(y)
end yOf

on numFrom(v)
  if v is missing value then return missing value
  try
    return v as real
  end try
  try
    return (v as string) as real
  end try
  return missing value
end numFrom

on tryFocus(el)
  try
    set focused of el to true
    delay 0.08
    return true
  on error
    try
      click el
      delay 0.08
      return true
    on error
      return false
    end try
  end try
end tryFocus

on clickWindowBottom(w, offsetFromBottom)
  try
    set wpos to position of w
    set wsz to size of w
    set wx to item 1 of wpos
    set wy to item 2 of wpos
    set ww to item 1 of wsz
    set wh to item 2 of wsz
    set cx to (wx + (ww / 2)) as integer
    set cy to (wy + wh - (offsetFromBottom as integer)) as integer
    click at {cx, cy}
    return true
  on error
    try
      set fr to value of attribute "AXFrame" of w
      set wx to item 1 of fr
      set wy to item 2 of fr
      set ww to item 3 of fr
      set wh to item 4 of fr
      set cx to (wx + (ww / 2)) as integer
      set cy to (wy + wh - (offsetFromBottom as integer)) as integer
      click at {cx, cy}
      return true
    on error
      return false
    end try
  end try
end clickWindowBottom

on focusDebug(p)
  try
    set el to value of attribute "AXFocusedUIElement" of p
    if el is missing value then return "none"
    set r to ""
    try
      set r to (value of attribute "AXRole" of el) as string
    end try
    set fr to {}
    try
      set fr to value of attribute "AXFrame" of el
    end try
    if r is "" then set r to "unknown-role"
    if fr is {} then return r
    return r & " y=" & (item 2 of fr as string)
  on error
    return "unknown"
  end try
end focusDebug

on focusCheck(p, thresholdY)
  try
    set el to value of attribute "AXFocusedUIElement" of p
    if el is missing value then return "none"
    set r to ""
    try
      set r to (value of attribute "AXRole" of el) as string
    end try
    set y to missing value
    try
      set fr to value of attribute "AXFrame" of el
      set y to item 2 of fr
    end try
    return r & " y=" & (y as string) & " thr=" & (thresholdY as string) & " above=" & ((my focusLooksAboveY(p, thresholdY)) as string) & " below=" & ((my focusLooksBelowY(p, thresholdY)) as string)
  on error errMsg
    return "err:" & errMsg
  end try
end focusCheck

	end using terms from
		    `;

    execFile("/usr/bin/osascript", ["-e", appleScript, "--", recipient, text, String(dryRun)], async (error, stdout, stderr) => {
      if (error) {
        // Keep logs readable: avoid dumping the full script/command line into the console.
        const rawErr = (stderr || "").toString().trim();
        const execErr = (error?.message || "").toString().trim();
        const shortErr = (() => {
          const m = rawErr.match(/execution error: ([^\n\r]+)/i);
          if (m && m[1]) return normalizeSendErrorMessage(m[1], "WhatsApp automation failed.");
          if (rawErr) return normalizeSendErrorMessage(rawErr.split("\n").slice(-1)[0], "WhatsApp automation failed.");
          if (execErr.includes("Command failed:")) return "WhatsApp automation failed (osascript).";
          return normalizeSendErrorMessage(execErr, "WhatsApp automation failed.");
        })();
        const hint = (() => {
          const s = `${rawErr}\n${execErr}\n${shortErr}`.toLowerCase();
          if (s.includes("not authorized") && s.includes("system events")) {
            return "Grant Accessibility permission to the process running {reply} (System Settings → Privacy & Security → Accessibility), then retry.";
          }
          if (s.includes("whatsapp is not running")) {
            return "Open WhatsApp Desktop (or WhatsApp Beta), keep it running and logged in, then retry.";
          }
          if (s.includes("no whatsapp window")) {
            return "Bring WhatsApp to the foreground and ensure a WhatsApp window is open (not minimized), then retry.";
          }
          if (s.includes("failed to focus whatsapp search")) {
            return "In WhatsApp, close popovers/modals, click the search field once, then retry from {reply}.";
          }
          if (s.includes("failed to focus whatsapp message composer")) {
            return "Open the target chat in WhatsApp and click the message composer once, then retry.";
          }
          if (s.includes("search focus lost")) {
            return "WhatsApp focus moved away from search; close popovers and keep WhatsApp frontmost, then retry.";
          }
          return "Ensure WhatsApp Desktop is installed/logged in, and enable Accessibility for the process running this server (System Settings → Privacy & Security → Accessibility).";
        })();
        console.error("Send WhatsApp error:", shortErr);
        // Common cases: missing Accessibility permissions, WhatsApp not installed, UI not focused.
        writeJson(res, 500, {
          error: shortErr,
          hint,
          transport,
          fallback: openclawFallback,
        });
        return;
      }
      await contactStore.clearDraft(recipientRaw);
      await autoAnnotateSentMessage("whatsapp", recipientRaw, text);
      writeJson(res, 200, {
        status: "ok",
        result: (stdout || "").trim(),
        transport,
        fallback: openclawFallback,
      });
    });
    return;
  }
  if (url.pathname === "/api/send-linkedin") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const payload = await readJsonBody(req);
    // Implement "Human Enter" check for security
    if (!hasHumanEnterTrigger(payload)) {
      denySensitiveRoute(req, res, {
        route: "/api/send-linkedin",
        action: "send-linkedin",
        code: "human_enter_trigger_required",
        message: "LinkedIn send requires explicit human Enter trigger from UI.",
        hint: "Send from {reply} UI using Enter/Send button; trigger expires after 2 minutes.",
        statusCode: 403,
        dryRun: Boolean(payload?.dryRun),
      });
      return;
    }

    const recipient = (payload?.recipient || "").toString().trim();
    const text = (payload?.text || "").toString();

    if (!recipient || !text) {
      writeJson(res, 400, { error: "Missing recipient or text" });
      return;
    }

    // Logic: Copy text to clipboard and open LinkedIn messaging (or specific profile if possible).
    // Note: LinkedIn URLs are tricky without a public profile URL.
    // If the recipient looks like a LinkedIn handle (linkedin:...), we try to open messaging.
    // Otherwise we just open the messaging inbox.

    // Attempt to extract a profile handle if it exists (e.g. linkedin:some.one -> some.one)
    // But direct messaging via URL is often restricted. Safe bet: Open messaging inbox.
    const targetUrl = "https://www.linkedin.com/messaging/";

    const appleScript = `
      on run argv
        set msg to item 1 of argv
        set the clipboard to msg
        tell application "Browser" to open location "${targetUrl}"
        -- Fallback to default browser if "Browser" abstract fails (usually handled by 'open' command in shell, but here we use open location)
        -- Actually, 'open' command is better for URLs.
      end run
    `;

    // Use 'open' for URL and 'pbcopy' for clipboard to be more robust than complex AppleScript
    // We execute them in parallel/sequence.

    const child_process = require("child_process");

    try {
      // 1. Copy to clipboard
      const proc = child_process.spawn("pbcopy");
      proc.stdin.write(text);
      proc.stdin.end();

      // 2. Open URL
      child_process.spawn("open", [targetUrl]);

      // 3. Persist outbound message
      try {
        const { addDocuments } = require("./vector-store.js");
        const { saveMessages } = require("./message-store.js");
        const dateStr = new Date().toLocaleString();
        const timestamp = new Date().toISOString();
        const formatted = `[${dateStr}] Me: ${text}`;
        const msgId = `urn:reply:linkedin:manual:${Date.now()}`;
        const channel = "linkedin";
        const path = `linkedin://${recipient}`;

        // Vector store (Golden Example)
        await addDocuments([{
          id: msgId,
          text: formatted,
          source: "LinkedIn",
          path: path,
          is_annotated: true
        }]);

        // Unified Chat DB
        await saveMessages([{
          id: msgId,
          text: text,
          source: "LinkedIn",
          handle: recipient,
          timestamp: timestamp,
          path: path
        }]);

        // Update contact last contacted
        await contactStore.updateLastContacted(recipient, timestamp, { channel });
        invalidateConversationCaches();
      } catch (persistErr) {
        console.error("LinkedIn outbound persistence failed:", persistErr.message);
      }

      await contactStore.clearDraft(recipient);
      writeJson(res, 200, {
        status: "ok",
        transport: "desktop_clipboard",
        hint: "Message copied to clipboard. Paste in LinkedIn."
      });
    } catch (e) {
      console.error("LinkedIn automation failed:", e);
      writeJson(res, 500, { error: "Failed to run desktop automation: " + e.message });
    }
    return;
  }
  if (url.pathname === "/api/send-email") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const payload = await readJsonBody(req);
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/send-email",
      action: "send-email",
      payload,
    })) {
      return;
    }
    const recipient = (payload?.recipient || "").toString().trim();
    const text = (payload?.text || "").toString();
    if (!recipient || !text) {
      writeJson(res, 400, { error: "Missing recipient or text" });
      return;
    }

    // Prefer Gmail API send when connected.
    try {
      const settings = readSettings();
      const gmail = settings?.gmail || {};
      if (gmail.refreshToken && gmail.clientId && gmail.clientSecret) {
        const { sendGmail } = require("./gmail-connector.js");
        const { getLatestSubject } = require("./vector-store.js");

        const originalSubject = await getLatestSubject(recipient);
        const subject = originalSubject || ""; // Fallback to empty as requested

        await sendGmail({ to: recipient, subject, text });
        await contactStore.clearDraft(recipient);
        await autoAnnotateSentMessage("email", recipient, text);
        writeJson(res, 200, { status: "ok", provider: "gmail" });
        return;
      }
    } catch (e) {
      console.error("Gmail send failed, falling back to Mail.app:", e.message);
    }

    // Fallback: AppleScript to send via Mail.app (opens compose window).
    // Use execFile argv to avoid shell-escaping problems and to support multiline text.
    const { getLatestSubject } = require("./vector-store.js");
    const originalSubject = await getLatestSubject(recipient);
    const subject = originalSubject || ""; // Fallback to empty as requested

    const appleScript = `
on run argv
  set toAddr to item 1 of argv
  set bodyText to item 2 of argv
  set subjectText to item 3 of argv
  tell application "Mail"
    set newMessage to make new outgoing message with properties {subject:subjectText, content:bodyText, visible:true}
    tell newMessage
      make new to recipient at end of to recipients with properties {address:toAddr}
      -- send -- Uncomment to send automatically, keeping visible:true for safety now
    end tell
    activate
  end tell
end run
      `;

    execFile("/usr/bin/osascript", ["-e", appleScript, "--", String(recipient), String(text), String(subject)], async (error) => {
      if (error) {
        console.error(`Send Mail error: ${error}`);
        writeJson(res, 500, { error: error.message });
        return;
      }
      await contactStore.clearDraft(recipient);
      writeJson(res, 200, { status: "ok" });
    });
    return;
  }
  if (url.pathname === "/api/sync-kyc") {
    writeJson(res, 200, { status: "ok", message: "Intelligence sweep is active in the background." });
    return;
  }
  if (url.pathname === "/api/sync-contacts") {
    const { ingestContacts } = require("./ingest-contacts.js");
    ingestContacts().then(count => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", count: count }));
    }).catch(err => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.toString() }));
    });
    return;
  }
  if (url.pathname === "/api/update-contact") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const { handle, data } = JSON.parse(body);
        if (!handle || !data) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing handle or data" }));
          return;
        }

        const updatedContact = await contactStore.updateContact(handle, data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", contact: updatedContact }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  if (url.pathname === "/api/clear-pending-kyc") {
    const handle = url.searchParams.get("handle");
    if (handle) {
      await contactStore.clearPendingKYC(handle);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing handle" }));
    }
    return;
  }
  if (url.pathname === "/api/add-note") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        if (!authorizeSensitiveRoute(req, res, {
          route: "/api/add-note",
          action: "add-note",
          payload,
        })) {
          return;
        }
        const { handle, text } = payload;
        if (!handle || !text) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing handle or text" }));
          return;
        }
        await contactStore.addNote(handle, text);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.toString() }));
      }
    });
    return;
  }
  if (url.pathname === "/api/update-note") {
    const payload = await readJsonBody(req);
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/update-note",
      action: "update-note",
      payload,
    })) {
      return;
    }
    const handle = (payload?.handle || "").toString().trim();
    const id = (payload?.id || "").toString().trim();
    const text = (payload?.text || "").toString();

    if (!handle || !id) {
      writeJson(res, 400, { error: "Missing handle or id" });
      return;
    }
    if (!text.trim()) {
      writeJson(res, 400, { error: "Text cannot be empty" });
      return;
    }

    await contactStore.updateNote(handle, id, text);
    writeJson(res, 200, { status: "ok" });
    return;
  }
  if (url.pathname === "/api/delete-note") {
    const handle = url.searchParams.get("handle");
    const id = url.searchParams.get("id");
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/delete-note",
      action: "delete-note",
      payload: { handle, id },
    })) {
      return;
    }
    if (handle && id) {
      await contactStore.deleteNote(handle, id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing handle or id" }));
    }
    return;
  }
  /**
   * API Endpoint: /api/system-health
   * Returns metadata about the server uptime, sync status, and contact database health.
   * Consolidated for {reply}.
   */
  if (url.pathname === "/api/system-health") {
    const DATA_DIR = path.join(__dirname, "data");

    const readStatus = (filename) => {
      const p = path.join(DATA_DIR, filename);
      if (fs.existsSync(p)) {
        try {
          return JSON.parse(fs.readFileSync(p, "utf8"));
        } catch (e) {
          return { state: "error", message: e.message };
        }
      }
      return { state: "idle", message: "No sync data available" };
    };

    // "Real" counts: number of messages in the project-local SQLite data store.
    async function countIngested(source) {
      try {
        const sqlite3 = require("sqlite3");
        const CHAT_DB = path.join(DATA_DIR, "chat.db");
        if (!fs.existsSync(CHAT_DB)) return 0;

        const db = new sqlite3.Database(CHAT_DB);
        return new Promise((resolve) => {
          db.serialize(() => {
            db.run("PRAGMA journal_mode = WAL");
            db.run("PRAGMA busy_timeout = 5000");
            let query = "";
            if (source === "iMessage") {
              // For iMessage, we count rows in the raw 'message' table synced from system.
              query = "SELECT count(*) as count FROM message WHERE text IS NOT NULL AND text != ''";
            } else {
              // For other sources, we count the unified store.
              query = "SELECT count(*) as count FROM unified_messages WHERE source = ?";
            }
            db.get(query, source === "iMessage" ? [] : [source], (err, row) => {
              db.close();
              resolve(row?.count || 0);
            });
          });
        });
      } catch (e) {
        console.error(`Error counting ${source}:`, e);
        return 0;
      }
    }

    const getNotesCount = () => {
      const notesMetadata = path.join(__dirname, '../knowledge/notes-metadata.json');
      if (fs.existsSync(notesMetadata)) {
        try {
          const data = JSON.parse(fs.readFileSync(notesMetadata, "utf8"));
          // notes-metadata.json is a cache object with note IDs as keys
          return Object.keys(data).length;
        } catch (e) {
          return 0;
        }
      }
      return 0;
    };

    const settings = readSettings();
    const mailStatus = readStatus("mail_sync_status.json");
    const gmailOk = isGmailConfigured(settings);
    const imapOk = isImapConfigured(settings);
    const mailProvider = gmailOk ? "gmail" : (imapOk ? "imap" : (mailStatus.connector || ""));
    const mailAccount =
      (gmailOk ? (settings?.gmail?.email || "") : "") ||
      (imapOk ? (settings?.imap?.user || "") : "") ||
      (process.env.REPLY_IMAP_USER || "");

    // Build health response with counts from source of truth
    const imessageStatus = readStatus("imessage_sync_status.json");
    const whatsappStatus = readStatus("whatsapp_sync_status.json");
    const notesStatus = readStatus("notes_sync_status.json");
    const kycStatus = readStatus("kyc_sync_status.json");

    const [imessageCount, whatsappCount, mailCount, linkedinMessagesCount, linkedinPostsCount, notesCountIngested] = await Promise.all([
      countIngested("iMessage"),
      countIngested("WhatsApp"),
      // Email counts currently remain from LanceDB or specific logs
      (async () => {
        try {
          const { connect } = require("./vector-store.js");
          const db = await connect();
          const table = await db.openTable("documents");
          return await table.countRows("source IN ('Gmail','IMAP','Mail','mbox')");
        } catch { return 0; }
      })(),
      (async () => {
        try {
          const { connect } = require("./vector-store.js");
          const db = await connect();
          const table = await db.openTable("documents");
          return await table.countRows("source IN ('LinkedIn')");
        } catch { return 0; }
      })(),
      (async () => {
        try {
          const { connect } = require("./vector-store.js");
          const db = await connect();
          const table = await db.openTable("documents");
          return await table.countRows("source IN ('linkedin-posts')");
        } catch { return 0; }
      })(),
      (async () => {
        try {
          const { connect } = require("./vector-store.js");
          const db = await connect();
          const table = await db.openTable("documents");
          return await table.countRows("source IN ('apple-notes')");
        } catch { return 0; }
      })(),
    ]);

    const health = {
      uptime: Math.floor(process.uptime()),
      status: "online",
      channels: {
        imessage: {
          ...imessageStatus,
          processed: imessageCount,
          total: imessageCount,
        },
        whatsapp: {
          ...whatsappStatus,
          processed: whatsappCount,
          total: whatsappCount
        },
        notes: {
          ...notesStatus,
          processed: notesCountIngested,
          total: getNotesCount()
        },
        mail: {
          ...mailStatus,
          lastAt: mailStatus.lastSync || null,
          provider: mailProvider,
          account: mailAccount,
          connected: !!(gmailOk || imapOk),
          processed: mailCount,
          total: mailCount,
        },
        linkedin_messages: {
          ...readStatus("linkedin_sync_status.json"),
          processed: linkedinMessagesCount,
          total: linkedinMessagesCount,
          lastAt: readChannelSyncState().linkedin || null
        },
        linkedin_posts: {
          ...readStatus("linkedin_posts_sync_status.json"),
          processed: linkedinPostsCount,
          total: linkedinPostsCount,
          lastAt: readChannelSyncState().linkedin_posts || null
        },
        contacts: readStatus("sync_state.json"),
        kyc: kycStatus
      },
      stats: await contactStore.getStats(),
      lastCheck: new Date().toISOString()
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
    return;
  }
  /**
   * API Endpoint: /api/openclaw/status
   * Proxies OpenClaw gateway health status.
   */
  if (url.pathname === "/api/openclaw/status") {
    const http = require("http");
    const options = {
      hostname: "127.0.0.1",
      port: 18789, // Default OpenClaw port
      path: "/health",
      method: "GET",
      timeout: 2000
    };

    const proxyReq = http.request(options, (proxyRes) => {
      let data = "";
      proxyRes.on("data", (chunk) => { data += chunk; });
      proxyRes.on("end", () => {
        res.writeHead(proxyRes.statusCode, { "Content-Type": "application/json" });
        res.end(data);
      });
    });

    proxyReq.on("error", (e) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "offline",
        error: "OpenClaw gateway unreachable",
        detail: e.message
      }));
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      res.writeHead(504, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "timeout", error: "OpenClaw health check timed out" }));
    });

    proxyReq.end();
    return;
  }
  // Back-compat alias used by some UI code
  if (url.pathname === "/api/status") {
    // Delegate to /api/update-status handler
    url.pathname = "/api/update-status";
  }
  if (url.pathname === "/api/update-status") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const { handle, status } = JSON.parse(body);
        if (!handle || !status) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing handle or status" }));
          return;
        }
        await contactStore.updateStatus(handle, status);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.toString() }));
      }
    });
    return;
  }
  if (url.pathname === "/api/refine-reply") {
    serveRefineReply(req, res);
    return;
  }
  if (url.pathname === "/api/feedback") {
    serveFeedback(req, res);
    return;
  }
  if (url.pathname === "/api/sync-whatsapp") {
    if (req.method === "POST") {
      const payload = await readJsonBody(req);
      if (!authorizeSensitiveRoute(req, res, {
        route: "/api/sync-whatsapp",
        action: "sync-whatsapp",
        payload,
      })) {
        return;
      }
      // Trigger background sync
      syncWhatsApp().catch(err => console.error("Manual WhatsApp Sync Error:", err));
      writeJson(res, 202, { status: "sync_started", source: "whatsapp" });
    } else {
      res.writeHead(405);
      res.end("Method Not Allowed");
    }
    return;
  }
  if (url.pathname === "/api/sync-linkedin") {
    if (req.method === "POST") {
      const payload = await readJsonBody(req);
      if (!authorizeSensitiveRoute(req, res, { route: "/api/sync-linkedin", action: "sync-linkedin", payload })) return;

      // Trigger sidecar-based background sync
      syncLinkedIn().catch(err => console.error("Manual LinkedIn Sync Error:", err));

      writeJson(res, 202, {
        status: "sync_started",
        source: "linkedin",
        message: "LinkedIn sidecar sync started in background."
      });
    }
    return;
  }
  if (url.pathname === "/api/sync-linkedin-contacts") {
    if (req.method === "POST") {
      const payload = await readJsonBody(req);
      if (!authorizeSensitiveRoute(req, res, { route: "/api/sync-linkedin-contacts", action: "sync-linkedin-contacts", payload })) return;
      writeJson(res, 200, {
        status: "hint",
        message: "Import 'Connections.csv' to sync LinkedIn contacts.",
        hint: "Go to Dashboard -> LinkedIn -> Import Archive to upload your CSV."
      });
    }
    return;
  }
  if (url.pathname === "/api/sync-linkedin-posts") {
    if (req.method === "POST") {
      const payload = await readJsonBody(req);
      if (!authorizeSensitiveRoute(req, res, { route: "/api/sync-linkedin-posts", action: "sync-linkedin-posts", payload })) return;

      // For now, posts sync is manual CSV import, but we record the activity
      recordChannelSync('linkedin_posts');

      writeJson(res, 202, {
        status: "sync_started",
        source: "linkedin_posts",
        message: "LinkedIn posts sync (manual refresh) completed."
      });
    }
    return;
  }

  if (url.pathname === "/api/analyze-contact") {
    await serveAnalyzeContact(req, res, authorizeSensitiveRoute, analysisInFlightByHandle);
    return;
  }

  if (url.pathname === "/api/accept-suggestion") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const { handle, id } = JSON.parse(body);
        await contactStore.acceptSuggestion(handle, id);
        const contact = contactStore.findContact(handle);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", contact }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === "/api/triage-log") {
    const logs = triageEngine.getLogs(20);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ logs }));
    return;
  }

  if (url.pathname === "/api/decline-suggestion") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const { handle, id } = JSON.parse(body);
        await contactStore.declineSuggestion(handle, id);
        const contact = contactStore.findContact(handle);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", contact }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    serveHtml(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});


/**
 * Simple CSV Parser for LinkedIn Archive
 * Handles quoted fields and newlines within fields
 * @param {string} text
 * @returns {Array<Object>} rows
 */
function parseLinkedInCSV(text) {
  const rows = [];
  let row = [];
  let currentToken = '';
  let insideQuote = false;

  // Normalize newlines
  const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const nextChar = input[i + 1];

    if (insideQuote) {
      if (char === '"' && nextChar === '"') {
        currentToken += '"';
        i++; // Skip escaped quote
      } else if (char === '"') {
        insideQuote = false;
      } else {
        currentToken += char;
      }
    } else {
      if (char === '"') {
        insideQuote = true;
      } else if (char === ',') {
        row.push(currentToken);
        currentToken = '';
      } else if (char === '\n') {
        row.push(currentToken);
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
        currentToken = '';
      } else {
        currentToken += char;
      }
    }
  }
  // Push last row
  if (currentToken || row.length > 0) {
    row.push(currentToken);
    rows.push(row);
  }

  // Extract Headers
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim().toUpperCase());

  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] || '';
    });
    return obj;
  });
}

/**
 * Attempt to listen on the specified port. 
 * If the port is in use, try the next available port.
 */
function tryListen(port) {
  server.removeAllListeners("error");
  server.removeAllListeners("listening");

  server.once("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      tryListen(port + 1);
    } else {
      throw err;
    }
  });

  server.once("listening", () => {
    boundPort = server.address().port;
    console.log(`Reply chat POC: http://localhost:${boundPort}`);
  });

  server.listen(port, "127.0.0.1");
}

// ------------------------------------------------------------------
// Continuous Learning Automation
// Periodically sync messaging history so the RAG Persona stays up to date.
// ------------------------------------------------------------------
const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
setInterval(() => {
  console.log("[Auto-Sync] Running background sync for continuous learning...");
  Promise.all([
    syncWhatsApp().catch(err => console.error("[Auto-Sync] WhatsApp failed:", err.message)),
    syncIMessage().catch(err => console.error("[Auto-Sync] iMessage failed:", err.message))
  ]).then(() => {
    console.log("[Auto-Sync] Background sync complete.");
  });
}, SYNC_INTERVAL_MS);

applyOpenClawWhatsAppGuard(true);
tryListen(PORT_MIN);

