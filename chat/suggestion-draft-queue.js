/**
 * Background suggestion drafts: queue handles on inbound, process one draft per interval
 * (default 5 minutes) from newest-queued toward older, using latest inbound text + history.
 */

const fs = require("fs");
const { getHistory } = require("./vector-store.js");
const { pathPrefixesForHandle, pickLatestInboundFromVectorDocs } = require("./utils/chat-utils.js");
const { dataPath, ensureDataHome } = require("./app-paths.js");

const QUEUE_PATH = dataPath("pending-suggestion-draft-queue.json");
const MAX_ITEMS = 500;

function readQueue() {
  try {
    if (!fs.existsSync(QUEUE_PATH)) return { items: [] };
    const j = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
    return { items: Array.isArray(j.items) ? j.items : [] };
  } catch {
    return { items: [] };
  }
}

function writeQueue(items) {
  ensureDataHome();
  fs.writeFileSync(QUEUE_PATH, JSON.stringify({ items: items.slice(0, MAX_ITEMS) }, null, 2), "utf8");
}

/**
 * New inbound activity: move handle to front of queue (newest-first).
 * @param {string} handle
 */
function enqueueSuggestionDraft(handle) {
  const h = String(handle || "").trim();
  if (!h) return;
  const q = readQueue();
  const next = q.items.filter((x) => x.handle !== h);
  next.unshift({ handle: h, queuedAt: new Date().toISOString() });
  writeQueue(next);
}

/** `path` from vector docs: imessage://, whatsapp://, mailto:, etc. */
function extractHandleFromVectorPath(pathStr) {
  const p = String(pathStr || "").trim();
  if (!p) return "";
  const lower = p.toLowerCase();
  if (lower.startsWith("imessage://")) return p.slice("imessage://".length).trim();
  if (lower.startsWith("whatsapp://")) return p.slice("whatsapp://".length).trim();
  if (lower.startsWith("mailto:")) return p.slice("mailto:".length).trim();
  if (lower.startsWith("email://")) return p.slice("email://".length).trim();
  return "";
}

/**
 * True if vector line looks like an inbound (contact) message, not "] Me:".
 * Matches `[ISO] Me:` / `[localdate] Me:` (iMessage, Gmail, IMAP, WhatsApp).
 */
function vectorDocLooksInboundFromContact(text) {
  const t = String(text || "");
  const m = t.match(/^\[[^\]]+\]\s*([^:]+):\s*/);
  if (!m) return Boolean(t.trim());
  const who = String(m[1] || "").trim();
  if (!who) return true;
  if (who === "Me" || /^me$/i.test(who)) return false;
  return true;
}

/**
 * After `addDocuments` from channel sync, queue background drafting for inbound rows.
 * @param {Array<{ text?: string, path?: string, source?: string }>} docs
 */
function enqueueSuggestionDraftsFromDocBatch(docs) {
  if (!Array.isArray(docs) || !docs.length) return;
  for (const d of docs) {
    try {
      if (!vectorDocLooksInboundFromContact(d?.text)) continue;
      const handle = extractHandleFromVectorPath(d?.path);
      if (!handle || handle === "unknown") continue;
      enqueueSuggestionDraft(handle);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Contacts with no draft yet, newest activity first; prepend missing handles so queue stays newest-first.
 * @param {object} contactStore
 */
function seedQueueFromUndraftedContacts(contactStore) {
  const contacts = Array.isArray(contactStore.contacts) ? contactStore.contacts : [];
  const pending = contacts
    .filter((c) =>
      c &&
      c.handle &&
      c.status !== "closed" &&
      contactStore.isVisibleInInbox(c) &&
      !String(c.draft || "").trim()
    )
    .sort((a, b) => {
      const da = a.lastContacted ? new Date(a.lastContacted).getTime() : 0;
      const db = b.lastContacted ? new Date(b.lastContacted).getTime() : 0;
      return db - da;
    });
  const q = readQueue();
  const existing = new Set(q.items.map((i) => i.handle));
  const now = new Date().toISOString();
  const additions = [];
  for (let i = pending.length - 1; i >= 0; i--) {
    const h = pending[i].handle;
    if (existing.has(h)) continue;
    existing.add(h);
    additions.push({ handle: h, queuedAt: now });
  }
  if (!additions.length) return;
  writeQueue([...additions, ...q.items].slice(0, MAX_ITEMS));
}

/**
 * Latest inbound message body for suggest-style drafting.
 * @param {string} handle
 * @param {{ contactStore?: { getAllHandles?: (h: string) => string[] } }} [opts]
 */
async function getLatestInboundMessageText(handle, opts = {}) {
  const { contactStore } = opts;
  const handles =
    contactStore && typeof contactStore.getAllHandles === "function"
      ? contactStore.getAllHandles(handle)
      : [handle];
  const prefixes = handles.flatMap((h) => pathPrefixesForHandle(h));
  const batches = await Promise.all(prefixes.map((p) => getHistory(p).catch(() => [])));
  const docs = batches.flat();
  const picked = pickLatestInboundFromVectorDocs(docs);
  return (picked?.text || "").trim();
}

/**
 * Process at most one queued suggestion draft.
 * @param {{ contactStore: object, generateReply: Function, getSnippets: Function, isBusy?: () => boolean }} opts
 * @returns {Promise<{ ok: boolean, handle?: string, reason?: string, skipped?: boolean }>}
 */
async function processOneSuggestionDraft(opts) {
  const { contactStore, generateReply, getSnippets, isBusy } = opts;
  if (typeof isBusy === "function" && isBusy()) {
    return { ok: false, skipped: true, reason: "worker_busy" };
  }

  let q = readQueue();
  if (q.items.length === 0) {
    seedQueueFromUndraftedContacts(contactStore);
    q = readQueue();
  }
  if (q.items.length === 0) {
    return { ok: false, reason: "queue_empty" };
  }

  const job = q.items[0];
  const handle = String(job.handle || "").trim();
  const rest = q.items.slice(1);
  writeQueue(rest);

  if (!handle) {
    return { ok: false, reason: "bad_job" };
  }

  const contact = contactStore.findContact(handle);
  if (!contact || contact.status === "closed" || !contactStore.isVisibleInInbox(contact)) {
    return { ok: false, handle, reason: "no_contact_or_closed" };
  }

  if (String(contact.draft || "").trim() && String(process.env.REPLY_SUGGEST_REGENERATE_IF_DRAFT || "") !== "1") {
    return { ok: false, handle, reason: "already_has_draft" };
  }

  let message = "";
  try {
    message = await getLatestInboundMessageText(handle, { contactStore });
  } catch (e) {
    enqueueSuggestionDraft(handle);
    return { ok: false, handle, reason: `history_error:${e.message}` };
  }

  if (!message) {
    return { ok: false, handle, reason: "no_inbound_text" };
  }

  try {
    const snippets = await getSnippets(message, 3);
    const draftResult = await generateReply(message, snippets, handle);
    const draftText = typeof draftResult === "string" ? draftResult : draftResult?.suggestion || "";
    if (String(draftText || "").trim()) {
      await contactStore.setDraft(handle, draftText);
      return { ok: true, handle };
    }
    enqueueSuggestionDraft(handle);
    return { ok: false, handle, reason: "empty_or_error_suggestion" };
  } catch (e) {
    enqueueSuggestionDraft(handle);
    return { ok: false, handle, reason: e.message || "generate_failed" };
  }
}

function getSuggestionDraftIntervalMs() {
  if (String(process.env.REPLY_SUGGEST_BACKGROUND_DISABLE || "").trim() === "1") {
    return 0;
  }
  const raw = process.env.REPLY_SUGGEST_DRAFT_INTERVAL_MS;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return Math.min(n, 24 * 60 * 60 * 1000);
    }
  }
  return 5 * 60 * 1000;
}

module.exports = {
  enqueueSuggestionDraft,
  enqueueSuggestionDraftsFromDocBatch,
  processOneSuggestionDraft,
  seedQueueFromUndraftedContacts,
  getSuggestionDraftIntervalMs,
  readQueue,
  writeQueue,
  getLatestInboundMessageText,
  extractHandleFromVectorPath,
  vectorDocLooksInboundFromContact,
  QUEUE_PATH,
};
