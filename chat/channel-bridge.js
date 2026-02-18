const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { addDocuments, connect } = require("./vector-store.js");
const contactStore = require("./contact-store.js");

const SUPPORTED_CHANNELS = new Set([
  "imessage",
  "whatsapp",
  "email",
  "telegram",
  "discord",
  "messenger",
  "instagram",
  "linkedin",
  "signal",
  "sms",
]);

const CHANNEL_ALIASES = {
  imsg: "imessage",
  text: "sms",
  mail: "email",
  gmail: "email",
  imap: "email",
  wa: "whatsapp",
  tg: "telegram",
};

const DOC_ID_EXISTS_CACHE = new Set();
const DOC_ID_EXISTS_CACHE_MAX = 5000;
const inflightByDocId = new Map();
const DATA_DIR = path.join(__dirname, "data");
const SEEN_DOC_IDS_PATH = path.join(DATA_DIR, "channel_bridge_seen.json");
const BRIDGE_EVENTS_LOG_PATH = path.join(DATA_DIR, "channel_bridge_events.jsonl");
const SEEN_DOC_IDS_MAX = 100000;
const SEEN_DOC_IDS_TRIM_TARGET = 80000;

let seenDocIdsLoaded = false;
const seenDocIds = new Set();

function markDocIdCached(docId) {
  if (!docId) return;
  DOC_ID_EXISTS_CACHE.add(docId);
  if (DOC_ID_EXISTS_CACHE.size <= DOC_ID_EXISTS_CACHE_MAX) return;
  const oldest = DOC_ID_EXISTS_CACHE.values().next();
  if (!oldest.done) DOC_ID_EXISTS_CACHE.delete(oldest.value);
}

function ensureSeenDocIdsLoaded() {
  if (seenDocIdsLoaded) return;
  seenDocIdsLoaded = true;
  try {
    if (!fs.existsSync(SEEN_DOC_IDS_PATH)) return;
    const parsed = JSON.parse(fs.readFileSync(SEEN_DOC_IDS_PATH, "utf8"));
    if (!Array.isArray(parsed)) return;
    for (const id of parsed) {
      const value = String(id || "").trim();
      if (!value) continue;
      seenDocIds.add(value);
      markDocIdCached(value);
    }
  } catch {
    // Best-effort load; continue without hard failure.
  }
}

function trimSeenDocIdsIfNeeded() {
  if (seenDocIds.size <= SEEN_DOC_IDS_MAX) return;
  while (seenDocIds.size > SEEN_DOC_IDS_TRIM_TARGET) {
    const oldest = seenDocIds.values().next();
    if (oldest.done) break;
    seenDocIds.delete(oldest.value);
  }
}

function persistSeenDocIds() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    trimSeenDocIdsIfNeeded();
    const tmp = `${SEEN_DOC_IDS_PATH}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Array.from(seenDocIds), null, 2), { mode: 0o600 });
    fs.renameSync(tmp, SEEN_DOC_IDS_PATH);
    fs.chmodSync(SEEN_DOC_IDS_PATH, 0o600);
  } catch {
    // Best-effort persist; ingestion should continue even if this fails.
  }
}

function appendBridgeEvent(record) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...(record || {}) })}\n`;
    fs.appendFileSync(BRIDGE_EVENTS_LOG_PATH, line, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(BRIDGE_EVENTS_LOG_PATH, 0o600);
  } catch {
    // Best-effort audit trail.
  }
}

function readBridgeEventLog(limit = 50) {
  const max = Math.max(1, Math.min(Number(limit) || 50, 500));
  try {
    if (!fs.existsSync(BRIDGE_EVENTS_LOG_PATH)) return [];
    const raw = fs.readFileSync(BRIDGE_EVENTS_LOG_PATH, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const sliced = lines.slice(-max);
    const out = [];
    for (const line of sliced) {
      try {
        out.push(JSON.parse(line));
      } catch {
        // Skip malformed lines.
      }
    }
    return out;
  } catch {
    return [];
  }
}

function rememberDocId(docId, options = {}) {
  const persist = options.persist !== false;
  const value = String(docId || "").trim();
  if (!value) return;
  ensureSeenDocIdsLoaded();
  markDocIdCached(value);
  seenDocIds.add(value);
  if (persist) persistSeenDocIds();
}

function escapeSqlString(value) {
  return String(value ?? "").replace(/'/g, "''");
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

async function docExists(docId) {
  if (!docId) return false;
  if (DOC_ID_EXISTS_CACHE.has(docId)) return true;
  ensureSeenDocIdsLoaded();
  if (seenDocIds.has(docId)) return true;
  try {
    const db = await connect();
    const table = await db.openTable("documents");
    const rows = await collectRows(
      await table
        .query()
        .where(`id = '${escapeSqlString(docId)}'`)
        .limit(1)
        .select(["id"])
        .execute()
    );
    const found = Array.isArray(rows) && rows.length > 0;
    if (found) rememberDocId(docId, { persist: false });
    return found;
  } catch {
    return false;
  }
}

function toNonEmptyString(value) {
  if (value === undefined || value === null) return "";
  const s = String(value).trim();
  return s;
}

function normalizeChannel(value) {
  const raw = toNonEmptyString(value).toLowerCase();
  const normalized = CHANNEL_ALIASES[raw] || raw;
  if (!normalized || !SUPPORTED_CHANNELS.has(normalized)) {
    throw new Error(`Unsupported or missing channel: ${value}`);
  }
  return normalized;
}

function normalizeTimestamp(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }

  const raw = toNonEmptyString(value);
  if (!raw) return new Date().toISOString();

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      const ms = numeric > 1e12 ? numeric : numeric * 1000;
      return new Date(ms).toISOString();
    }
  }

  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function normalizeHandleForChannel(channel, value) {
  let handle = toNonEmptyString(value);
  if (!handle) return "";

  handle = handle
    .replace(/^(imessage:\/\/|whatsapp:\/\/|mailto:|telegram:\/\/|discord:\/\/)/i, "")
    .trim();

  if (channel === "email") {
    return handle.toLowerCase();
  }

  if (channel === "whatsapp") {
    return handle
      .replace(/@s\.whatsapp\.net$/i, "")
      .replace(/@g\.us$/i, "")
      .replace(/@lid$/i, "")
      .trim();
  }

  if (channel === "telegram") {
    return handle.replace(/^@+/, "").trim().toLowerCase();
  }

  return handle;
}

function normalizePeer(rawPeer, channel) {
  if (typeof rawPeer === "string" || typeof rawPeer === "number") {
    const handle = normalizeHandleForChannel(channel, rawPeer);
    if (!handle) throw new Error("Missing peer handle");
    return {
      id: handle,
      handle,
      displayName: "",
    };
  }

  const peer = rawPeer && typeof rawPeer === "object" ? rawPeer : {};
  const peerId = toNonEmptyString(peer.id || peer.externalId || peer.userId || peer.uid);
  const handle = normalizeHandleForChannel(
    channel,
    peer.handle || peer.username || peer.email || peer.phone || peerId || peer.name
  );
  if (!handle) throw new Error("Missing peer handle");
  const displayName = toNonEmptyString(peer.displayName || peer.name || peer.label || "");

  return {
    id: peerId || handle,
    handle,
    displayName,
  };
}

function normalizeAttachments(raw) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((item, idx) => {
      if (typeof item === "string") {
        const value = toNonEmptyString(item);
        if (!value) return null;
        return {
          id: `att-${idx + 1}`,
          type: "file",
          name: "",
          url: value,
          mimeType: "",
          size: null,
        };
      }

      const obj = item && typeof item === "object" ? item : null;
      if (!obj) return null;

      const id = toNonEmptyString(obj.id || obj.attachmentId || `att-${idx + 1}`);
      const mimeType = toNonEmptyString(obj.mimeType || obj.mimetype || obj.mime || "");
      let type = toNonEmptyString(obj.type || "");
      if (!type && mimeType.startsWith("image/")) type = "image";
      if (!type && mimeType.startsWith("video/")) type = "video";
      if (!type && mimeType.startsWith("audio/")) type = "audio";
      if (!type) type = "file";

      const name = toNonEmptyString(obj.name || obj.filename || obj.title || "");
      const url = toNonEmptyString(obj.url || obj.href || obj.downloadUrl || "");
      const size = Number.isFinite(Number(obj.size)) ? Number(obj.size) : null;

      if (!name && !url && size === null && !mimeType) return null;

      return {
        id,
        type,
        name,
        url,
        mimeType,
        size,
      };
    })
    .filter(Boolean);
}

function normalizeInboundEvent(rawEvent) {
  const payload = rawEvent && typeof rawEvent === "object" ? rawEvent : {};
  const channel = normalizeChannel(payload.channel || payload.source || payload.platform);
  const timestamp = normalizeTimestamp(
    payload.timestamp || payload.ts || payload.createdAt || payload.created_at || payload.date
  );
  const peer = normalizePeer(
    payload.peer || payload.from || payload.contact || payload.sender || payload.handle,
    channel
  );

  const text = toNonEmptyString(
    payload.text || payload.message || payload.body || payload.content || payload.caption || ""
  );
  const attachments = normalizeAttachments(payload.attachments || payload.files || payload.media);
  if (!text && attachments.length === 0) {
    throw new Error("Inbound event must include text or attachments");
  }

  let messageId = toNonEmptyString(
    payload.messageId || payload.message_id || payload.id || payload.eventId || payload.event_id
  );
  if (!messageId) {
    messageId = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          channel,
          peer: peer.handle,
          timestamp,
          text,
          attachments: attachments.map((a) => a.id || a.url || a.name),
        })
      )
      .digest("hex");
  }

  return {
    channel,
    peer,
    messageId,
    text,
    timestamp,
    attachments,
  };
}

function sourceForChannel(channel) {
  switch (channel) {
    case "imessage":
      return "iMessage";
    case "whatsapp":
      return "WhatsApp";
    case "email":
      return "Mail";
    case "telegram":
      return "Telegram";
    case "discord":
      return "Discord";
    case "messenger":
      return "Messenger";
    case "instagram":
      return "Instagram";
    case "linkedin":
      return "LinkedIn";
    case "signal":
      return "Signal";
    case "sms":
      return "SMS";
    default:
      return channel;
  }
}

function pathForEvent(event) {
  if (event.channel === "email") return `mailto:${event.peer.handle}`;
  return `${event.channel}://${event.peer.handle}`;
}

function toVectorDoc(event) {
  const digest = crypto
    .createHash("sha1")
    .update(`${event.channel}:${event.messageId}`)
    .digest("hex")
    .slice(0, 20);

  const sender = event.peer.displayName || event.peer.handle;
  const body = event.text || "[attachment]";
  const attachmentTail =
    event.attachments.length > 0
      ? `\n[attachments] ${event.attachments
          .map((a) => a.name || a.url || a.id)
          .filter(Boolean)
          .join(" | ")}`
      : "";

  return {
    id: `bridge-${event.channel}-${digest}`,
    text: `[${event.timestamp}] ${sender}: ${body}${attachmentTail}`,
    source: sourceForChannel(event.channel),
    path: pathForEvent(event),
  };
}

function maybeUpdateDisplayName(handle, displayName) {
  if (!displayName) return;
  const existing = contactStore.findContact(handle);
  const existingName = toNonEmptyString(existing?.displayName);
  const looksAuto =
    !existingName ||
    existingName.toLowerCase() === String(handle).toLowerCase() ||
    /^\+?\d+$/.test(existingName);

  if (looksAuto) {
    contactStore.updateContact(handle, { displayName });
  }
}

async function ingestInboundEvent(rawEvent) {
  const event = normalizeInboundEvent(rawEvent);
  const doc = toVectorDoc(event);
  const stableDoc = {
    id: doc.id,
    source: doc.source,
    path: doc.path,
  };

  const asDuplicate = () => ({
    duplicate: true,
    event,
    doc: stableDoc,
  });

  const asAccepted = () => ({
    duplicate: false,
    event,
    doc: stableDoc,
  });

  const prior = inflightByDocId.get(doc.id);
  if (prior) {
    try {
      await prior;
    } catch {
      // If prior attempt failed, fall through and retry normally.
    }
    if (await docExists(doc.id)) {
      const out = asDuplicate();
      appendBridgeEvent({
        status: "duplicate",
        channel: out.event.channel,
        messageId: out.event.messageId,
        peer: out.event.peer,
        doc: out.doc,
        reason: "inflight_duplicate",
      });
      return out;
    }
  }

  const exists = await docExists(doc.id);
  if (exists) {
    const out = asDuplicate();
    appendBridgeEvent({
      status: "duplicate",
      channel: out.event.channel,
      messageId: out.event.messageId,
      peer: out.event.peer,
      doc: out.doc,
      reason: "seen_or_existing",
    });
    return out;
  }

  const ingestPromise = (async () => {
    await addDocuments([doc]);
    rememberDocId(doc.id);
    contactStore.updateLastContacted(event.peer.handle, event.timestamp, {
      channel: event.channel,
    });
    maybeUpdateDisplayName(event.peer.handle, event.peer.displayName);
  })();
  inflightByDocId.set(doc.id, ingestPromise);

  try {
    await ingestPromise;
    const out = asAccepted();
    appendBridgeEvent({
      status: "ingested",
      channel: out.event.channel,
      messageId: out.event.messageId,
      peer: out.event.peer,
      timestamp: out.event.timestamp,
      attachments: out.event.attachments,
      doc: out.doc,
    });
    return out;
  } catch (err) {
    appendBridgeEvent({
      status: "error",
      channel: event.channel,
      messageId: event.messageId,
      peer: event.peer,
      timestamp: event.timestamp,
      doc: stableDoc,
      error: err?.message || String(err),
    });
    throw err;
  } finally {
    if (inflightByDocId.get(doc.id) === ingestPromise) {
      inflightByDocId.delete(doc.id);
    }
  }
}

async function ingestInboundEvents(rawEvents, options = {}) {
  const failFast = options.failFast !== false;
  const items = Array.isArray(rawEvents) ? rawEvents : [rawEvents];
  const results = [];
  let accepted = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < items.length; i += 1) {
    try {
      const out = await ingestInboundEvent(items[i]);
      const status = out.duplicate ? "duplicate" : "ok";
      if (out.duplicate) skipped += 1;
      else accepted += 1;
      results.push({ index: i, status, ...out });
    } catch (err) {
      errors += 1;
      const message = err?.message || String(err);
      results.push({ index: i, status: "error", error: message });
      if (failFast) throw err;
    }
  }

  return {
    accepted,
    skipped,
    errors,
    total: items.length,
    results,
  };
}

module.exports = {
  SUPPORTED_CHANNELS,
  normalizeInboundEvent,
  toVectorDoc,
  ingestInboundEvent,
  ingestInboundEvents,
  BRIDGE_EVENTS_LOG_PATH,
  readBridgeEventLog,
};
