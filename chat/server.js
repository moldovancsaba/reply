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
const { readSettings, writeSettings, maskSettingsForClient, isImapConfigured, isGmailConfigured, withDefaults } = require("./settings-store.js");
const { buildAuthUrl, connectGmailFromCallback, disconnectGmail } = require("./gmail-connector.js");

// Default to port 3000 if not specified in environment variables.
const PORT_MIN = parseInt(process.env.PORT || "3000", 10);
const HTML_PATH = path.join(__dirname, "index.html");
let gmailOauthState = null;

let boundPort = PORT_MIN;
const analysisInFlightByHandle = new Map();

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
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
    try {
      await disconnectGmail();
      writeJson(res, 200, { status: "ok" });
    } catch (e) {
      writeJson(res, 500, { error: e.message || "Failed to disconnect Gmail" });
    }
    return;
  }
  if (url.pathname === "/api/sync-mail") {
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
  if (url.pathname === "/api/conversations") {
    const limit = parseInt(url.searchParams.get("limit")) || 20;
    const offset = parseInt(url.searchParams.get("offset")) || 0;

    try {
      // Build a stable in-memory index (avoid re-reading contacts.json repeatedly)
      const contactsSnapshot = contactStore.contacts || [];
      const contactIndex = (() => {
        const byHandle = new Map();
        const byEmail = new Map();
        const byPhone = new Map();
        const byAlias = new Map();

        for (const c of contactsSnapshot) {
          if (!c) continue;
          if (c.handle) byHandle.set(String(c.handle).trim().toLowerCase(), c);
          const emails = c.channels?.email || [];
          for (const e of emails) {
            const key = normalizeEmail(e);
            if (key) byEmail.set(key, c);
          }
          const phones = c.channels?.phone || [];
          for (const p of phones) {
            const key = normalizePhone(p);
            if (key) byPhone.set(key, c);
          }
          const aliases = c.aliases || [];
          for (const a of aliases) {
            const key = String(a || "").trim().toLowerCase();
            if (key) byAlias.set(key, c);
          }
        }
        return { byHandle, byEmail, byPhone, byAlias };
      })();

      function resolveContact(identifier) {
        if (!identifier) return null;
        const raw = String(identifier).trim();
        if (!raw) return null;
        const key = raw.toLowerCase();
        if (contactIndex.byHandle.has(key)) return contactIndex.byHandle.get(key);
        if (contactIndex.byAlias.has(key)) return contactIndex.byAlias.get(key);
        const emailKey = normalizeEmail(raw);
        if (emailKey && contactIndex.byEmail.has(emailKey)) return contactIndex.byEmail.get(emailKey);
        const phoneKey = normalizePhone(raw);
        if (phoneKey && contactIndex.byPhone.has(phoneKey)) return contactIndex.byPhone.get(phoneKey);
        return null;
      }

      // Query LanceDB directly for contact list (database-level pagination)
      const { connect } = require('./vector-store.js');
      const db = await connect();
      const table = await db.openTable("documents");

      // Get distinct handles with their latest message timestamp
      // Note: LanceDB doesn't support GROUP BY, so we query and dedupe in JS
      // but limit data transfer by querying only recent messages
      // Use 384-dimension zero vector for full scan (all-MiniLM-L6-v2 embedding size)
      const zeroVector = new Array(384).fill(0);
      const results = await table
        .search(zeroVector)
        .where(`source IN ('iMessage', 'iMessage-live', 'WhatsApp', 'Mail')`)
        .limit(10000)  // Get more than needed for deduplication
        .execute();

      // Convert results to array (LanceDB returns async iterator)
      let docs = [];
      if (Array.isArray(results)) {
        docs = results;
      } else {
        for await (const batch of results) {
          for (const row of batch) {
            docs.push(row.toJSON ? row.toJSON() : row);
          }
        }
      }

      // Map WhatsApp linked-device IDs ("...@lid") to their real phone JIDs for stable display/merging.
      const waLidCandidates = new Set();
      for (const d of docs) {
        const p = (d?.path || "").toString();
        if (!p.toLowerCase().startsWith("whatsapp://")) continue;
        const h = p.replace(/^whatsapp:\/\//i, "").trim();
        if (/^\d{13,}$/.test(h)) waLidCandidates.add(h);
      }
      const waLidMeta = await whatsAppIdResolver.phoneForLids(Array.from(waLidCandidates));

      // Group by contact (if known) and get latest message time
      const contactMap = new Map();
      const countMap = new Map();
      for (const doc of docs) {
        if (!doc?.path) continue;
        const rawHandle = doc.path.replace(/^(imessage:\/\/|whatsapp:\/\/|mailto:)/, '');
        const isWhatsApp = (doc.path || "").toString().toLowerCase().startsWith("whatsapp://") || (doc.source || "").toString().toLowerCase().includes("whatsapp");
        const waMeta = isWhatsApp ? waLidMeta.get(rawHandle) : null;
        const identityHandle = waMeta?.phone || rawHandle;

        const resolved = resolveContact(identityHandle);
        const groupKey = (resolved?.id || resolved?.handle || identityHandle).toString();
        const canonicalHandle = (resolved?.handle || identityHandle).toString();

        const nextCount = (countMap.get(groupKey) || 0) + 1;
        countMap.set(groupKey, nextCount);

        const previewText = stripMessagePrefix(doc.text || "").trim();
        const previewDate = extractDateFromText(doc.text || "");
        const messageTime = previewDate ? previewDate.getTime() : 0;
        const lastChannel = channelFromDoc(doc);

        if (!contactMap.has(groupKey) || messageTime > (contactMap.get(groupKey).lastMessageTime || 0)) {
          contactMap.set(groupKey, {
            key: groupKey,
            handle: canonicalHandle,
            latestHandle: identityHandle,
            lastMessageTime: messageTime,
            path: doc.path,
            source: doc.source,
            channel: lastChannel,
            waPartnerName: waMeta?.partnerName || null,
            preview: previewText,
            previewDate: previewDate ? previewDate.toISOString() : null,
            count: nextCount,
            contact: resolved || null
          });
        } else {
          // Keep count updated even if this isn't the latest item
          const existing = contactMap.get(groupKey);
          if (existing) existing.count = nextCount;
        }
      }

      // Convert to array and sort by last message time
      const contacts = Array.from(contactMap.values())
        .sort((a, b) => b.lastMessageTime - a.lastMessageTime)
        .slice(offset, offset + limit);

      // Enrich with contact store data
      const enriched = contacts.map(c => {
        const contact = c.contact || resolveContact(c.handle);
        const hasDraft = contact?.status === "draft" && contact?.draft;
        const lastChannel = c.channel || channelFromDoc(c);
        const contactName = (contact?.displayName || contact?.name || "").toString();
        const displayName = (/^\d+$/.test(contactName) && c.waPartnerName) ? c.waPartnerName : (contactName || c.handle);
        return {
          id: contact?.id || c.handle,
          displayName,
          // Use the handle from the latest message so actions (like sending) default to the latest channel.
          handle: c.latestHandle || c.handle,
          count: c.count || countMap.get(c.key) || 0,
          lastMessage: hasDraft
            ? `Draft: ${contact.draft.slice(0, 50)}...`
            : (c.preview ? c.preview.slice(0, 80) : "Click to see history"),
          status: contact?.status || "open",
          draft: contact?.draft || null,
          channel: lastChannel,
          lastChannel,
          lastSource: c.source || null,
          latestHandle: c.latestHandle || c.handle,
          lastContacted: contact?.lastContacted || (c.previewDate || new Date(c.lastMessageTime || 0).toISOString())
        };
      });

	      res.writeHead(200, { "Content-Type": "application/json" });
	      res.end(JSON.stringify({
	        contacts: enriched,
	        hasMore: contactMap.size > offset + limit,
	        total: contactMap.size,
	        meta: { mode: "db" },
	      }));
    } catch (err) {
      console.error("Error loading conversations from database:", err);
      // Fallback to contact store if database query fails
      const { getHistory } = require("./vector-store.js");

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
            lastContacted: c.lastContacted || stats.previewDate
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
    serveSyncNotes(req, res);
    return;
  }
  if (url.pathname === "/api/sync-imessage") {
    console.log("Starting iMessage sync in background...");
    const { exec } = require("child_process");
    exec("node chat/sync-imessage.js", (error, stdout, stderr) => {
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
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const { recipient, text } = JSON.parse(body);
      if (!recipient || !text) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing recipient or text" }));
        return;
      }

      const escapedMessage = text.replace(/"/g, '\\"');
      const appleScript = `
        tell application "Messages"
          set targetService to 1st service whose service type is iMessage
          set targetBuddy to buddy "${recipient}" of targetService
          send "${escapedMessage}" to targetBuddy
        end tell
      `;

      const { exec } = require("child_process");
      exec(`osascript -e '${appleScript}'`, (error, stdout) => {
        if (error) {
          console.error(`Send error: ${error}`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
          return;
        }
        contactStore.clearDraft(recipient); // Clear draft on successful send
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
    });
    return;
  }
	  if (url.pathname === "/api/send-whatsapp") {
	    const { execFile } = require("child_process");
	    const payload = await readJsonBody(req);
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
    set dryRun to (item 3 of argv as boolean)
  end try
  set candidates to {${candidateList}}

  set appName to my pickRunningApp(candidates)
  if appName is "" then error "WhatsApp is not running."

  set the clipboard to msg
  tell application appName to activate
  delay 0.6

  tell application "System Events"
    tell process appName
      set frontmost to true
      delay 0.25
      set p to it

      -- Close any popovers/modals that might steal focus
      key code 53 -- escape
	      delay 0.15
	
	      -- Try to enter search/new chat using shortcuts, but NEVER type the target unless focus is in the top area.
	      set focusedOk to my focusLooksAboveY(p, 260)
	      if focusedOk is false then
	        keystroke "k" using {command down}
	        delay 0.25
	        set focusedOk to my focusLooksAboveY(p, 260)
	      end if
	      if focusedOk is false then
	        keystroke "f" using {command down}
	        delay 0.25
	        set focusedOk to my focusLooksAboveY(p, 260)
	      end if
	      if focusedOk is false then
	        keystroke "n" using {command down}
	        delay 0.25
	        set focusedOk to my focusLooksAboveY(p, 260)
	      end if
	      if focusedOk is false then error "Failed to focus WhatsApp search. Focus=" & my focusDebug(p)

      -- Clear any prior search text
      keystroke "a" using {command down}
      delay 0.05
      key code 51 -- delete
      delay 0.1

      -- Type the recipient and only press enter if we're still in the search area (prevents sending the number as a message).
      if my focusLooksAboveY(p, 260) is false then error "Search focus lost; aborting to avoid sending the recipient. Focus=" & my focusDebug(p)
      keystroke target
      delay 0.25
      if my focusLooksAboveY(p, 260) is false then error "Search focus lost; aborting to avoid sending the recipient. Focus=" & my focusDebug(p)
	      key code 36 -- enter to open the chat
	      delay 0.7
	
	      -- Ensure the message composer is focused before pasting
	      set composerOk to my focusLooksBelowY(p, 360)
	      if composerOk is false then
	        repeat 8 times
	          key code 48 -- tab
	          delay 0.12
	          set composerOk to my focusLooksBelowY(p, 360)
	          if composerOk is true then exit repeat
	        end repeat
	      end if
	      if composerOk is false then error "Failed to focus WhatsApp message composer. Focus=" & my focusDebug(p)

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
    set r to ""
    try
      set r to value of attribute "AXRole" of el
    end try
    if r is not "AXTextField" and r is not "AXSearchField" then return false

    set fr to value of attribute "AXFrame" of el
    set y to item 2 of fr
    if y is not missing value and y < maxY then return true
  end try
  return false
end focusLooksAboveY

on focusLooksBelowY(p, minY)
  try
    set el to value of attribute "AXFocusedUIElement" of p
    set r to ""
    try
      set r to value of attribute "AXRole" of el
    end try
    if r is not "AXTextArea" and r is not "AXTextField" then return false

    set fr to value of attribute "AXFrame" of el
    set y to item 2 of fr
    if y is not missing value and y > minY then return true
  end try
  return false
end focusLooksBelowY

on focusDebug(p)
  try
    set el to value of attribute "AXFocusedUIElement" of p
    set r to ""
    try
      set r to value of attribute "AXRole" of el
    end try
    set fr to {}
    try
      set fr to value of attribute "AXFrame" of el
    end try
    if fr is {} then return r
    return r & " y=" & (item 2 of fr as string)
  on error
    return "unknown"
  end try
end focusDebug

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
	        console.error("Send WhatsApp error:", shortErr);
	        // Common cases: missing Accessibility permissions, WhatsApp not installed, UI not focused.
	        writeJson(res, 500, {
	          error: shortErr,
	          hint:
	            "Ensure WhatsApp Desktop is installed and logged in, and enable Accessibility for the process running this server (System Settings → Privacy & Security → Accessibility).",
	        });
	        return;
	      }
      contactStore.clearDraft(recipientRaw);
      writeJson(res, 200, { status: "ok", result: (stdout || "").trim() });
    });
    return;
  }
  if (url.pathname === "/api/send-email") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      const { recipient, text } = JSON.parse(body);
      if (!recipient || !text) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing recipient or text" }));
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
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", provider: "gmail" }));
          return;
        }
      } catch (e) {
        console.error("Gmail send failed, falling back to Mail.app:", e.message);
      }

      // Fallback: AppleScript to send via Mail.app (opens compose window).
      const escapedMessage = text.replace(/"/g, '\\"');
      const appleScript = `
        tell application "Mail"
          set newMessage to make new outgoing message with properties {subject:"Follow-up from {reply}", content:"${escapedMessage}", visible:true}
          tell newMessage
            make new to recipient at end of to recipients with properties {address:"${recipient}"}
            -- send -- Uncomment to send automatically, keeping visible:true for safety now
          end tell
          activate
        end tell
      `;

      const { exec } = require("child_process");
      exec(`osascript -e '${appleScript}'`, (error, stdout) => {
        if (error) {
          console.error(`Send Mail error: ${error}`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
          return;
        }
        contactStore.clearDraft(recipient);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
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

    // Read actual counts from sync_state files (source of truth)
    const getImessageCount = () => {
      const stateFile = path.join(DATA_DIR, "sync_state.json");
      if (fs.existsSync(stateFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
          return state.lastProcessedId || 0;
        } catch (e) {
          return 0;
        }
      }
      return 0;
    };

    const getWhatsappCount = () => {
      const dbPath = path.join(process.env.HOME, 'Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite');
      // For now, read from status file (will be replaced with direct DB query)
      const status = readStatus("whatsapp_sync_status.json");
      return status.processed || 0;
    };

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

    const health = {
      uptime: Math.floor(process.uptime()),
      status: "online",
      channels: {
        imessage: {
          ...imessageStatus,
          processed: getImessageCount(),  // Override with actual database count
          total: getImessageCount()
        },
        whatsapp: {
          ...whatsappStatus,
          processed: getWhatsappCount(),
          total: getWhatsappCount()
        },
        notes: {
          ...notesStatus,
          processed: getNotesCount(),
          total: getNotesCount()
        },
        mail: {
          ...mailStatus,
          provider: mailProvider,
          account: mailAccount,
          connected: !!(gmailOk || imapOk),
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
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const { handle } = JSON.parse(body);
        if (!handle) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing handle" }));
          return;
        }

        const profile = await analyzeContactDeduped(handle);
        let updatedContact = null;
        if (profile) {
          updatedContact = await mergeProfile(profile);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          contact: updatedContact,
          message: profile ? "Analysis complete" : "Not enough data for analysis"
        }));
      } catch (e) {
        console.error("Analysis error:", e);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
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
