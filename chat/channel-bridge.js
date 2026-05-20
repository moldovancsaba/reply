const crypto = require("crypto");
const fs = require("fs");
const { addDocuments, connect } = require("./vector-store.js");
const contactStore = require("./contact-store.js");
const { saveMessages, messageExists } = require("./message-store.js");
const triageEngine = require("./triage-engine.js");
const { normalizeLinkedInHandle } = require("./linkedin-utils.js");
const { generateReply } = require("./brain-runtime.js");
const { getSnippets } = require("./vector-store.js");
const { dataPath, ensureDataHome } = require("./app-paths.js");
const statusManager = require("./status-manager.js");

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label || "operation"} timeout after ${timeoutMs}ms`)), timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function persistLocalNbaForInbound({ doc, event }) {
  if (event.direction !== "inbound") return;

  const start = Date.now();
  const snippets = await getSnippets(event.text, 3);
  const draftResult = await withTimeout(
    generateReply(event.text, snippets, event.peer.handle),
    12000,
    "local_nba",
  );
  const suggestion =
    typeof draftResult === "string" ? draftResult : String(draftResult?.suggestion || "").trim();

  let added = 0;
  if (suggestion) {
    await contactStore.addSuggestion(event.peer.handle, "Draft", suggestion);
    added += 1;
  }

  appendBridgeEvent({
    status: "nba_generated",
    channel: event.channel,
    messageId: event.messageId,
    peer: event.peer,
    suggestionsAdded: added,
    latencyMs: Date.now() - start,
  });
}

function scheduleBridgeTask(label, task, event) {
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((err) => {
        const message = err?.message || String(err);
        console.warn(`[Bridge] ${label} failed:`, message);
        appendBridgeEvent({
          status: "async_error",
          stage: label,
          channel: event?.channel,
          messageId: event?.messageId,
          peer: event?.peer,
          error: message,
        });
      });
  });
}

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
  "viber",
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
  vb: "viber",
};

const DOC_ID_EXISTS_CACHE = new Set();
const DOC_ID_EXISTS_CACHE_MAX = 5000;
const inflightByDocId = new Map();
const SEEN_DOC_IDS_PATH = dataPath("channel_bridge_seen.json");
const BRIDGE_SYNC_STATE_PATH = dataPath("channel_bridge_sync.json");
const BRIDGE_EVENTS_LOG_PATH = dataPath("channel_bridge_events.jsonl");
const BRIDGE_PENDING_WRITES_PATH = dataPath("channel_bridge_pending.json");
const SEEN_DOC_IDS_MAX = 100000;
const SEEN_DOC_IDS_TRIM_TARGET = 80000;
const BRIDGE_MESSAGE_WRITE_TIMEOUT_MS = Math.max(
  250,
  parseInt(process.env.REPLY_BRIDGE_MESSAGE_WRITE_TIMEOUT_MS || "2000", 10) || 2000
);
const BRIDGE_PENDING_WRITE_RETRY_TIMEOUT_MS = Math.max(
  BRIDGE_MESSAGE_WRITE_TIMEOUT_MS,
  parseInt(process.env.REPLY_BRIDGE_PENDING_WRITE_RETRY_TIMEOUT_MS || "15000", 10) || 15000
);
const BRIDGE_PENDING_DRAIN_INTERVAL_MS = Math.max(
  5000,
  parseInt(process.env.REPLY_BRIDGE_PENDING_DRAIN_INTERVAL_MS || "15000", 10) || 15000
);

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
    ensureDataHome();
    trimSeenDocIdsIfNeeded();
    const tmp = `${SEEN_DOC_IDS_PATH}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Array.from(seenDocIds), null, 2), { mode: 0o600 });
    fs.renameSync(tmp, SEEN_DOC_IDS_PATH);
    fs.chmodSync(SEEN_DOC_IDS_PATH, 0o600);
  } catch {
    // Best-effort persist; ingestion should continue even if this fails.
  }
}

function trimBridgeEventLogIfNeeded() {
  try {
    if (!fs.existsSync(BRIDGE_EVENTS_LOG_PATH)) return;
    const stats = fs.statSync(BRIDGE_EVENTS_LOG_PATH);
    const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB limit
    if (stats.size > MAX_LOG_SIZE) {
      console.log("[Bridge] Trimming event log...");
      const content = fs.readFileSync(BRIDGE_EVENTS_LOG_PATH, "utf8");
      const lines = content.split("\n").filter(Boolean);
      // Keep last 1000 lines
      const kept = lines.slice(-1000);
      fs.writeFileSync(BRIDGE_EVENTS_LOG_PATH, kept.join("\n") + "\n", { mode: 0o600 });
    }
  } catch (e) {
    console.warn("[Bridge] Log trim failed:", e.message);
  }
}

function appendBridgeEvent(record) {
  try {
    ensureDataHome();
    trimBridgeEventLogIfNeeded();
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...(record || {}) })}\n`;
    fs.appendFileSync(BRIDGE_EVENTS_LOG_PATH, line, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(BRIDGE_EVENTS_LOG_PATH, 0o600);
  } catch {
    // Best-effort audit trail.
  }
}

function recordChannelSync(channel) {
  try {
    ensureDataHome();
    let state = {};
    if (fs.existsSync(BRIDGE_SYNC_STATE_PATH)) {
      state = JSON.parse(fs.readFileSync(BRIDGE_SYNC_STATE_PATH, "utf8"));
    }
    state[channel] = new Date().toISOString();
    fs.writeFileSync(BRIDGE_SYNC_STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (e) {
    console.warn("[Bridge] Failed to record channel sync:", e.message);
  }
}

function updateChannelBridgeStatus(channel, status = {}) {
  const normalized = String(channel || "").trim().toLowerCase();
  if (!normalized) return;
  const payload = {
    state: "idle",
    message: "Browser bridge event ingested.",
    lastSync: new Date().toISOString(),
    lastSuccessfulSync: new Date().toISOString(),
    ingestMode: normalized === "linkedin" ? "browser_bridge" : undefined,
    ...status,
  };
  statusManager.update(normalized, payload);
}

function readChannelSyncState() {
  try {
    if (!fs.existsSync(BRIDGE_SYNC_STATE_PATH)) return {};
    return JSON.parse(fs.readFileSync(BRIDGE_SYNC_STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function readBridgeEventLog(limit = 50) {
  const max = Math.max(1, Math.min(Number(limit) || 50, 5000));
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

function readPendingBridgeWrites() {
  try {
    if (!fs.existsSync(BRIDGE_PENDING_WRITES_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(BRIDGE_PENDING_WRITES_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingBridgeWrites(items) {
  try {
    ensureDataHome();
    const payload = Array.isArray(items) ? items : [];
    const tmp = `${BRIDGE_PENDING_WRITES_PATH}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, BRIDGE_PENDING_WRITES_PATH);
    fs.chmodSync(BRIDGE_PENDING_WRITES_PATH, 0o600);
  } catch (e) {
    console.warn("[Bridge] Failed to persist pending writes:", e.message);
  }
}

function enqueuePendingBridgeWrite(item) {
  const items = readPendingBridgeWrites();
  items.push({
    queuedAt: new Date().toISOString(),
    ...item,
  });
  writePendingBridgeWrites(items);
  return items.length;
}

async function drainPendingBridgeWrites(limit = 10) {
  const items = readPendingBridgeWrites();
  if (!items.length) return { drained: 0, remaining: 0 };

  const keep = [];
  let drained = 0;
  for (const item of items) {
    if (drained >= limit) {
      keep.push(item);
      continue;
    }
    if (await messageExists(item?.message?.id)) {
      drained += 1;
      updateChannelBridgeStatus(item?.event?.channel, {
        state: "idle",
        message: "Browser bridge event ingested.",
        lastAttemptedSync: item?.event?.timestamp || new Date().toISOString(),
        lastSuccessfulSync: item?.event?.timestamp || new Date().toISOString(),
        lastSync: item?.event?.timestamp || new Date().toISOString(),
        ingestMode: item?.event?.channel === "linkedin" ? "browser_bridge" : undefined,
      });
      appendBridgeEvent({
        status: "pending_reconciled",
        channel: item?.event?.channel,
        messageId: item?.event?.messageId,
        peer: item?.event?.peer,
      });
      continue;
    }
    try {
      await withTimeout(
        saveMessages([item.message], { deferMaintenance: true }),
        BRIDGE_PENDING_WRITE_RETRY_TIMEOUT_MS,
        "bridge_pending_save"
      );
      drained += 1;
      updateChannelBridgeStatus(item?.event?.channel, {
        state: "idle",
        message: "Browser bridge event ingested.",
        lastAttemptedSync: item?.event?.timestamp || new Date().toISOString(),
        lastSuccessfulSync: item?.event?.timestamp || new Date().toISOString(),
        lastSync: item?.event?.timestamp || new Date().toISOString(),
        ingestMode: item?.event?.channel === "linkedin" ? "browser_bridge" : undefined,
      });
      appendBridgeEvent({
        status: "pending_drained",
        channel: item?.event?.channel,
        messageId: item?.event?.messageId,
        peer: item?.event?.peer,
      });
    } catch (err) {
      keep.push(item);
      appendBridgeEvent({
        status: "pending_retry",
        channel: item?.event?.channel,
        messageId: item?.event?.messageId,
        peer: item?.event?.peer,
        error: err?.message || String(err),
      });
    }
  }

  writePendingBridgeWrites(keep);
  return { drained, remaining: keep.length };
}

const pendingBridgeDrainTimer = setInterval(() => {
  drainPendingBridgeWrites().catch((err) => {
    console.warn("[Bridge] Periodic pending drain failed:", err.message);
  });
}, BRIDGE_PENDING_DRAIN_INTERVAL_MS);

if (typeof pendingBridgeDrainTimer?.unref === "function") {
  pendingBridgeDrainTimer.unref();
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
    .replace(/^(imessage:\/\/|whatsapp:\/\/|mailto:|telegram:\/\/|discord:\/\/|signal:\/\/|viber:\/\/|linkedin:\/\/|messenger:\/\/|instagram:\/\/|sms:\/\/)/i, "")
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

  if (channel === "linkedin") {
    return normalizeLinkedInHandle(handle);
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
  const rawDirection = toNonEmptyString(payload.direction || payload.dir || payload.type || "inbound").toLowerCase();
  const direction = rawDirection === "outbound" ? "outbound" : "inbound";
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
    direction,
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
    case "viber":
      return "Viber";
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
    recordChannelSync(event.channel);
    updateChannelBridgeStatus(event.channel, {
      message: "Browser bridge duplicate observed.",
      lastAttemptedSync: new Date().toISOString(),
    });
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

    // 2. Try the unified-message write with a short budget. If SQLite is busy,
    // queue the row for background replay instead of holding the bridge request open.
    const messageRow = {
      id: doc.id,
      text: event.text,
      source: doc.source,
      handle: event.peer.handle,
      timestamp: event.timestamp,
      path: doc.path
    };

    let messagePersisted = false;
    try {
      await withTimeout(
        saveMessages([messageRow], { deferMaintenance: true }),
        BRIDGE_MESSAGE_WRITE_TIMEOUT_MS,
        "bridge_message_save"
      );
      messagePersisted = true;
    } catch (err) {
      const queuedCount = enqueuePendingBridgeWrite({ event, message: messageRow });
      appendBridgeEvent({
        status: "queued_persistence",
        channel: event.channel,
        messageId: event.messageId,
        peer: event.peer,
        doc: stableDoc,
        queueDepth: queuedCount,
        error: err?.message || String(err),
      });
      console.warn("[Bridge] Deferred unified message persistence:", err?.message || String(err));
    }

    recordChannelSync(event.channel);
    updateChannelBridgeStatus(event.channel, {
      message: messagePersisted
        ? "Browser bridge event ingested."
        : "Browser bridge event queued for message-store persistence.",
      lastAttemptedSync: event.timestamp,
      lastSuccessfulSync: event.timestamp,
      lastSync: event.timestamp,
    });

    scheduleBridgeTask("contact_update", async () => {
      await contactStore.updateContact(event.peer.handle, {
        lastContacted: event.timestamp,
        lastChannel: event.channel,
        channels: {
          [event.channel]: [event.peer.handle]
        }
      });
    }, event);

    if (event.direction === "inbound") {
      scheduleBridgeTask("inbound_verification", async () => {
        await contactStore.markChannelInboundVerified(event.peer.handle, event.peer.handle, event.timestamp);
      }, event);
    }

    if (event.peer.displayName) {
      scheduleBridgeTask("display_name_update", async () => {
        await maybeUpdateDisplayName(event.peer.handle, event.peer.displayName);
      }, event);
    }

    scheduleBridgeTask("triage", async () => {
      triageEngine.evaluate(event.text, pathForEvent(event));
    }, event);

    scheduleBridgeTask("pending_drain", async () => {
      await drainPendingBridgeWrites();
    }, event);

    // 4. Local Next Best Action (NBA) generation stays fully off the request path.
    // It may still use Trinity-first drafting with local fallback, but bridge ingest
    // should already be acknowledged by then.
    scheduleBridgeTask("local_nba", async () => {
      await persistLocalNbaForInbound({ doc, event });
    }, event);
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
    updateChannelBridgeStatus(event.channel, {
      state: "error",
      message: err?.message || String(err),
      lastAttemptedSync: event.timestamp,
      ingestMode: event.channel === "linkedin" ? "browser_bridge" : undefined,
    });
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
  drainPendingBridgeWrites,
  BRIDGE_EVENTS_LOG_PATH,
  readBridgeEventLog,
  readChannelSyncState,
};
