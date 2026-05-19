/**
 * Background suggestion drafts: queue handles on inbound, process drafts from
 * newest-queued toward older, using latest inbound text + history.
 */

const fs = require("fs");
const preparedContextStore = require("./prepared-context-store.js");
const { dataPath, ensureDataHome } = require("./app-paths.js");

const QUEUE_PATH = dataPath("pending-suggestion-draft-queue.json");
const MAX_ITEMS = 500;

function contactEligibleForInbox(contactStore, contact) {
  if (!contact) return false;
  if (typeof contactStore?.isInboxEligible === "function") {
    return contactStore.isInboxEligible(contact);
  }
  if (typeof contactStore?.isVisibleInInbox === "function") {
    return contactStore.isVisibleInInbox(contact);
  }
  return true;
}

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
      contactEligibleForInbox(contactStore, c) &&
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
 * Prepared local draft context for suggest-style drafting.
 * @param {string} handle
 * @param {{ contactStore?: { getAllHandles?: (h: string) => string[] } }} [opts]
 */
async function getPreparedDraftContext(handle, opts = {}) {
  const { contactStore } = opts;
  const handles =
    contactStore && typeof contactStore.getAllHandles === "function"
      ? contactStore.getAllHandles(handle)
      : [handle];
  const snapshots = await preparedContextStore.getDraftContextSnapshots(handles);
  const bestSnapshot = snapshots
    .filter((row) => row.latestInboundText)
    .sort((a, b) => Date.parse(String(b.latestInboundTimestamp || 0)) - Date.parse(String(a.latestInboundTimestamp || 0)))[0] || null;
  return {
    message: String(bestSnapshot?.latestInboundText || "").trim(),
    snippets: Array.isArray(bestSnapshot?.snippetCandidates) ? bestSnapshot.snippetCandidates.slice(0, 3) : [],
  };
}

/**
 * Process at most one queued suggestion draft.
 * @param {{ contactStore: object, generateReply: Function, getPreparedDraft?: Function, buildThreadSnapshot?: Function, getPreparedDraftContext?: Function, isBusy?: () => boolean }} opts
 * @returns {Promise<{ ok: boolean, handle?: string, reason?: string, skipped?: boolean }>}
 */
async function processOneSuggestionDraft(opts) {
  const {
    contactStore,
    generateReply,
    getPreparedDraft,
    buildThreadSnapshot,
    getPreparedDraftContext: resolvePreparedDraftContext,
    isBusy,
  } = opts;
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
  if (!contact || contact.status === "closed" || !contactEligibleForInbox(contactStore, contact)) {
    return { ok: false, handle, reason: "no_contact_or_closed" };
  }

  let message = "";
  let snippets = [];
  try {
    const prepared = typeof resolvePreparedDraftContext === "function"
      ? await resolvePreparedDraftContext(handle, { contactStore })
      : await getPreparedDraftContext(handle, { contactStore });
    message = prepared.message;
    snippets = prepared.snippets;
  } catch (e) {
    enqueueSuggestionDraft(handle);
    return { ok: false, handle, reason: `prepared_context_error:${e.message}` };
  }

  if (!message) {
    return { ok: false, handle, reason: "no_inbound_text" };
  }

  if (
    typeof getPreparedDraft === "function"
    && typeof buildThreadSnapshot === "function"
    && String(process.env.REPLY_SUGGEST_REGENERATE_IF_DRAFT || "") !== "1"
  ) {
    try {
      const threadSnapshot = await buildThreadSnapshot(message, snippets, handle);
      const prepared = await getPreparedDraft({
        companyId: threadSnapshot.company_id,
        threadRef: threadSnapshot.thread_ref,
      }).catch(() => ({ status: "missing" }));
      const rankedDraftSet = prepared?.prepared_draft_set?.ranked_draft_set || null;
      const top = Array.isArray(rankedDraftSet?.drafts) ? rankedDraftSet.drafts[0] : null;
      if (prepared?.status === "ok" && prepared?.stale !== true && String(top?.draft_text || "").trim()) {
        await contactStore.setDraft(handle, String(top.draft_text || "").trim());
        return { ok: true, handle, reason: "prepared_draft_ready" };
      }
    } catch (e) {
      return { ok: false, handle, reason: `prepared_draft_check_failed:${e.message}` };
    }
  }

  try {
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
  return 60 * 1000;
}

function getSuggestionDraftBatchSize() {
  const raw = process.env.REPLY_SUGGEST_DRAFT_BATCH_SIZE;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return Math.min(Math.floor(n), 12);
    }
  }
  return 3;
}

module.exports = {
  enqueueSuggestionDraft,
  enqueueSuggestionDraftsFromDocBatch,
  processOneSuggestionDraft,
  seedQueueFromUndraftedContacts,
  getSuggestionDraftIntervalMs,
  getSuggestionDraftBatchSize,
  readQueue,
  writeQueue,
  getPreparedDraftContext,
  extractHandleFromVectorPath,
  vectorDocLooksInboundFromContact,
  QUEUE_PATH,
};
