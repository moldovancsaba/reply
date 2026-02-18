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
require("dotenv").config(); // Load environment variables

const { generateReply, extractKYC } = require('./reply-engine.js');
const { getSnippets } = require("./knowledge.js");
const { sync: syncIMessage } = require('./sync-imessage.js');
const { syncNotes } = require('./sync-notes.js');
const { syncWhatsApp } = require('./sync-whatsapp.js');
const triageEngine = require('./triage-engine.js');
const { refineReply } = require("./gemini-client.js");
const contactStore = require("./contact-store.js");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { mergeProfile } = require("./kyc-merge.js");
const {
  readSettings,
  writeSettings,
  maskSettingsForClient,
  isImapConfigured,
  isGmailConfigured,
  withDefaults,
  getChannelBridgeInboundMode,
} = require("./settings-store.js");
const { buildAuthUrl, connectGmailFromCallback, disconnectGmail } = require("./gmail-connector.js");
const {
  ingestInboundEvent,
  ingestInboundEvents,
  normalizeInboundEvent,
  toVectorDoc,
  readBridgeEventLog,
} = require("./channel-bridge.js");
const {
  getSecurityPolicy,
  isLocalRequest,
  hasValidOperatorToken,
  isHumanApproved,
  appendSecurityAudit,
  resolveClientIp,
} = require("./security-policy.js");

// Default to port 3000 if not specified in environment variables.
const PORT_MIN = parseInt(process.env.PORT || "3000", 10);
const HTML_PATH = path.join(__dirname, "index.html");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
let gmailOauthState = null;

let boundPort = PORT_MIN;
const analysisInFlightByHandle = new Map();
const securityPolicy = getSecurityPolicy(process.env);

// Conversation list helpers
const conversationsIndexCache = {
  builtAtMs: 0,
  ttlMs: 5 * 1000,
  buildPromise: null,
  items: [],
};

const conversationStatsCache = new Map(); // key -> { builtAtMs, lastContacted, stats }
const CONVERSATION_STATS_TTL_MS = 60 * 1000;
const CONVERSATION_PREVIEW_SAMPLE_ROWS = 200;

let docsTablePromise = null;

function invalidateConversationCaches() {
  conversationsIndexCache.items = [];
  conversationsIndexCache.builtAtMs = 0;
  conversationStatsCache.clear();
}

function escapeSqlString(value) {
  return String(value ?? "").replace(/'/g, "''");
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
  return null;
}

function getBridgePolicyForChannel(channel, settingsSnapshot = null) {
  const key = String(channel || "").trim().toLowerCase();
  if (!key) return null;
  if (key !== "telegram" && key !== "discord") return null;
  const inboundMode = getChannelBridgeInboundMode(settingsSnapshot, key);
  return {
    managed: true,
    channel: key,
    inboundMode,
    label: `${key} ${inboundMode}`,
  };
}

function buildChannelBridgeSummary(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 200, 2000));
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
    rollout: {
      telegram: getChannelBridgeInboundMode(settings, "telegram"),
      discord: getChannelBridgeInboundMode(settings, "discord"),
    },
    lastEventAt,
    lastErrorAt,
  };
}

function stripPathScheme(p) {
  return String(p || "").replace(/^(imessage:\/\/|whatsapp:\/\/|mailto:|telegram:\/\/|discord:\/\/)/i, "").trim();
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
    const items = (contactStore.contacts || [])
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

  const table = await getDocsTable();
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
    const filter = `path LIKE '${escapeSqlString(prefix)}%'`;
    const count = await table.countRows(filter);
    totalCount += Number.isFinite(Number(count)) ? Number(count) : 0;
    if (!count) continue;

    const offset = Math.max(0, Number(count) - CONVERSATION_PREVIEW_SAMPLE_ROWS);
    const results = await table
      .query()
      .where(filter)
      .offset(offset)
      .limit(CONVERSATION_PREVIEW_SAMPLE_ROWS)
      .select(["text", "source", "path"])
      .execute();

    const rows = await collectRows(results);
    for (const r of rows) {
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
  variants.add(h);
  const normalized = normalizePhone(h);
  if (normalized) variants.add(normalized);

  const out = [];
  for (const v of variants) {
    out.push(`imessage://${v}`);
    out.push(`whatsapp://${v}`);
    out.push(`telegram://${v}`);
    out.push(`discord://${v}`);
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
  if (s.includes("messenger")) return "messenger";
  if (s.includes("instagram")) return "instagram";
  if (s.includes("linkedin")) return "linkedin";
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
      const placeholders = ids.map(() => "?").join(",");

      let rows = [];
      try {
        rows = await all(
          db,
          `SELECT ZCONTACTIDENTIFIER, ZCONTACTJID, ZPARTNERNAME FROM ZWACHATSESSION WHERE ZCONTACTIDENTIFIER IN (${placeholders})`,
          ids
        );
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
      const placeholders = jids.map(() => "?").join(",");

      let rows = [];
      try {
        rows = await all(
          db,
          `SELECT ZCONTACTJID, ZCONTACTIDENTIFIER FROM ZWACHATSESSION WHERE ZCONTACTJID IN (${placeholders})`,
          jids
        );
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
async function serveKyc(req, res, url) {
  if (req.method === "GET") {
    const handle = url.searchParams.get("handle");
    if (!handle) {
      writeJson(res, 400, { error: "Missing handle" });
      return;
    }

    const contact = contactStore.findContact(handle);
    writeJson(res, 200, {
      handle,
      displayName: contact?.displayName || contact?.name || handle,
      profession: contact?.profession || "",
      relationship: contact?.relationship || "",
      intro: contact?.intro || "",
      notes: Array.isArray(contact?.notes) ? contact.notes : [],
      channels: contact?.channels || { phone: [], email: [] },
      pendingSuggestions: Array.isArray(contact?.pendingSuggestions) ? contact.pendingSuggestions : [],
      rejectedSuggestions: Array.isArray(contact?.rejectedSuggestions) ? contact.rejectedSuggestions : [],
    });
    return;
  }

  if (req.method === "POST") {
    try {
      const json = await readJsonBody(req);
      if (!authorizeSensitiveRoute(req, res, {
        route: "/api/kyc",
        action: "update-kyc",
        payload: json,
      })) {
        return;
      }
      const handle = json.handle;
      if (!handle) {
        writeJson(res, 400, { error: "Missing handle" });
        return;
      }

      const data = {
        displayName: (json.displayName ?? json.name ?? "").trim(),
        profession: (json.profession ?? json.role ?? "").trim(),
        relationship: (json.relationship ?? "").trim(),
        intro: (json.intro ?? "").trim(),
      };

      // Don't overwrite with empty strings
      Object.keys(data).forEach((k) => {
        if (!data[k]) delete data[k];
      });

      const contact = contactStore.updateContact(handle, data);
      writeJson(res, 200, { status: "ok", contact });
    } catch (e) {
      writeJson(res, 500, { error: e.message });
    }
    return;
  }

  writeJson(res, 405, { error: "Method not allowed" });
}

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

// Create the HTTP server and route requests.
const server = http.createServer(async (req, res) => {
  // Use a dummy base URL to parse the path relative to the server root.
  const url = new URL(req.url || "/", `http://localhost:${boundPort}`);
  const pathname = url.pathname;

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
            for (const key of ["imessage", "whatsapp", "email"]) {
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
            for (const key of ["telegram", "discord"]) {
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

      const list = (await Promise.all(
        contactStore.contacts
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
        hasMore: contactStore.contacts.length > offset + limit,
        total: contactStore.contacts.length,
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
    await serveKyc(req, res, url);
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

    execFile("/usr/bin/osascript", ["-e", appleScript, "--", recipient, text], (error) => {
      if (error) {
        console.error(`Send error: ${error}`);
        writeJson(res, 500, { error: error.message });
        return;
      }
      contactStore.clearDraft(recipient);
      writeJson(res, 200, { status: "ok" });
    });
    return;
  }
	  if (url.pathname === "/api/send-whatsapp") {
      if (req.method !== "POST") {
        writeJson(res, 405, { error: "Method not allowed" });
        return;
      }
	    const { execFile } = require("child_process");
	    const payload = await readJsonBody(req);
      if (!authorizeSensitiveRoute(req, res, {
        route: "/api/send-whatsapp",
        action: "send-whatsapp",
        payload,
      })) {
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

	    execFile("/usr/bin/osascript", ["-e", appleScript, "--", recipient, text, String(dryRun)], (error, stdout, stderr) => {
	      if (error) {
	        // Keep logs readable: avoid dumping the full script/command line into the console.
	        const rawErr = (stderr || "").toString().trim();
	        const execErr = (error?.message || "").toString().trim();
	        const shortErr = (() => {
	          const m = rawErr.match(/execution error: ([^\n\r]+)/i);
	          if (m && m[1]) return m[1].trim();
	          if (rawErr) return rawErr.split("\n").slice(-1)[0].trim();
	          if (execErr.includes("Command failed:")) return "WhatsApp automation failed (osascript).";
	          return execErr || "WhatsApp automation failed.";
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
	        });
	        return;
	      }
      contactStore.clearDraft(recipientRaw);
      writeJson(res, 200, { status: "ok", result: (stdout || "").trim() });
    });
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
        await sendGmail({ to: recipient, subject: "Follow-up from {reply}", text });
        contactStore.clearDraft(recipient);
        writeJson(res, 200, { status: "ok", provider: "gmail" });
        return;
      }
    } catch (e) {
      console.error("Gmail send failed, falling back to Mail.app:", e.message);
    }

    // Fallback: AppleScript to send via Mail.app (opens compose window).
    // Use execFile argv to avoid shell-escaping problems and to support multiline text.
    const appleScript = `
on run argv
  set toAddr to item 1 of argv
  set bodyText to item 2 of argv
  tell application "Mail"
    set newMessage to make new outgoing message with properties {subject:"Follow-up from {reply}", content:bodyText, visible:true}
    tell newMessage
      make new to recipient at end of to recipients with properties {address:toAddr}
      -- send -- Uncomment to send automatically, keeping visible:true for safety now
    end tell
    activate
  end tell
end run
      `;

    execFile("/usr/bin/osascript", ["-e", appleScript, "--", String(recipient), String(text)], (error) => {
      if (error) {
        console.error(`Send Mail error: ${error}`);
        writeJson(res, 500, { error: error.message });
        return;
      }
      contactStore.clearDraft(recipient);
      writeJson(res, 200, { status: "ok" });
    });
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
    req.on("end", () => {
      try {
        const { handle, data } = JSON.parse(body);
        if (!handle || !data) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing handle or data" }));
          return;
        }

        const updatedContact = contactStore.updateContact(handle, data);
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
      contactStore.clearPendingKYC(handle);
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
    req.on("end", () => {
      try {
        const { handle, text } = JSON.parse(body);
        if (!handle || !text) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing handle or text" }));
          return;
        }
        contactStore.addNote(handle, text);
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

    const updated = contactStore.updateNote(handle, id, text);
    if (!updated) {
      writeJson(res, 404, { error: "Note not found" });
      return;
    }
    writeJson(res, 200, { status: "ok", note: updated });
    return;
  }
  if (url.pathname === "/api/delete-note") {
    const handle = url.searchParams.get("handle");
    const id = url.searchParams.get("id");
    if (handle && id) {
      contactStore.deleteNote(handle, id);
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

    // "Real" counts: number of ingested docs in LanceDB by channel/source.
    async function countIngested(whereClause) {
      try {
        const { connect } = require("./vector-store.js");
        const db = await connect();
        const table = await db.openTable("documents");
        return await table.countRows(whereClause);
      } catch {
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

    const [imessageCount, whatsappCount, mailCount, notesCountIngested] = await Promise.all([
      countIngested("source IN ('iMessage','iMessage-live')"),
      countIngested("source IN ('WhatsApp')"),
      // Email can come from Gmail OAuth, IMAP, Mail.app, or legacy mbox ingestion.
      countIngested("source IN ('Gmail','IMAP','Mail','mbox')"),
      countIngested("source IN ('apple-notes')"),
    ]);

    const health = {
      uptime: Math.floor(process.uptime()),
      status: "online",
      channels: {
        imessage: {
          ...imessageStatus,
          processed: imessageCount || 0,
          total: imessageCount || 0
        },
        whatsapp: {
          ...whatsappStatus,
          processed: whatsappCount || 0,
          total: whatsappCount || 0
        },
        notes: {
          ...notesStatus,
          processed: notesCountIngested || 0,
          total: getNotesCount()
        },
        mail: {
          ...mailStatus,
          provider: mailProvider,
          account: mailAccount,
          connected: !!(gmailOk || imapOk),
          processed: mailCount || 0,
          total: mailCount || 0,
        },
        contacts: readStatus("sync_state.json") // Legacy sync state compatibility
      },
      stats: contactStore.getStats(),
      lastCheck: new Date().toISOString()
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
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
    req.on("end", () => {
      try {
        const { handle, status } = JSON.parse(body);
        if (!handle || !status) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing handle or status" }));
          return;
        }
        contactStore.updateStatus(handle, status);
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
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "started" }));
    } else {
      res.writeHead(405);
      res.end("Method Not Allowed");
    }
    return;
  }

  if (url.pathname === "/api/analyze-contact") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const payload = await readJsonBody(req);
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/analyze-contact",
      action: "analyze-contact",
      payload,
    })) {
      return;
    }
    try {
      const handle = (payload?.handle || "").toString().trim();
      if (!handle) {
        writeJson(res, 400, { error: "Missing handle" });
        return;
      }

      const profile = await analyzeContactDeduped(handle);
      let updatedContact = null;
      if (profile) {
        updatedContact = await mergeProfile(profile);
      }

      writeJson(res, 200, {
        status: "ok",
        contact: updatedContact,
        message: profile ? "Analysis complete" : "Not enough data for analysis"
      });
    } catch (e) {
      console.error("Analysis error:", e);
      writeJson(res, 500, { error: e.message });
    }
    return;
  }

  if (url.pathname === "/api/accept-suggestion") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { handle, id } = JSON.parse(body);
        const contact = contactStore.acceptSuggestion(handle, id);
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
    req.on("end", () => {
      try {
        const { handle, id } = JSON.parse(body);
        const contact = contactStore.declineSuggestion(handle, id);
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

tryListen(PORT_MIN);
