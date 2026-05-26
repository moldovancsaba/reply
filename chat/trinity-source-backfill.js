const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { dataPath } = require("./app-paths.js");
const contactStore = require("./contact-store.js");
const draftLearningStore = require("./draft-learning-store.js");
const {
  buildDocumentRegistration,
  buildDraftOutcomeEvent,
  buildMemoryEvent,
  resolveTrinityPythonBin,
  resolveTrinityRuntimeRoot,
} = require("./brain-runtime.js");
const { buildRuntimeDocumentRegistrations } = require("./vector-store.js");
const { buildRuntimeMemoryEventsForContacts } = require("./contact-store.js");
const { buildRuntimeMemoryEventsForMessages } = require("./message-store.js");

const CHAT_DB_PATH = process.env.REPLY_CHAT_DB_PATH || dataPath("chat.db");
const SQLITE_BUSY_TIMEOUT_MS = 20000;
const DOCUMENT_SOURCE_ALIASES = {
  notes: ["apple-notes"],
  calendar: ["apple-calendar"],
  "apple-notes": ["apple-notes"],
  "apple-calendar": ["apple-calendar"],
};
const CONVERSATION_SOURCE_ALIASES = {
  mail: ["mail", "gmail", "imap"],
  email: ["mail", "gmail", "imap"],
  imessage: ["imessage", "imessage-live"],
  whatsapp: ["whatsapp"],
  linkedin: ["linkedin"],
};
const MEMORY_SOURCE_ALIASES = {
  contacts: ["contacts"],
  "contact-intelligence": ["contact-intelligence"],
  kyc: ["contact-intelligence"],
  "accepted-outcome": ["accepted-outcome"],
};
const SUPERVISION_READY_DISPOSITIONS = new Set([
  "SENT_AS_IS",
  "EDITED_THEN_SENT",
  "MANUAL_REPLACEMENT",
]);
const GENERIC_SUPERVISION_MARKERS = [
  "thank you for asking",
  "i've taken note",
  "let's proceed with",
  "i saw this",
  "move this forward",
  "confirm the exact outcome",
  "my read is",
  "you have a child",
  "contact the pediatrician",
  "develop a plan",
];
const OUTBOUND_CHANNEL_SOURCE_MAP = {
  email: ["mail", "gmail", "imap"],
  imessage: ["imessage", "imessage-live"],
  whatsapp: ["whatsapp"],
  linkedin: ["linkedin"],
};

function openDb() {
  const db = new sqlite3.Database(CHAT_DB_PATH, sqlite3.OPEN_READONLY);
  try {
    db.configure("busyTimeout", SQLITE_BUSY_TIMEOUT_MS);
  } catch {
    // Ignore if unsupported.
  }
  return db;
}

function allDb(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function normalizeRequestedSources(rawSources = []) {
  const requested = Array.isArray(rawSources) && rawSources.length
    ? rawSources
    : ["notes", "calendar", "contacts", "contact-intelligence"];
  return Array.from(new Set(requested.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)));
}

function normalizeDocumentSources(requestedSources) {
  const values = new Set();
  for (const source of requestedSources) {
    for (const mapped of DOCUMENT_SOURCE_ALIASES[source] || []) {
      values.add(mapped);
    }
  }
  return Array.from(values);
}

function normalizeMemorySources(requestedSources) {
  const values = new Set();
  for (const source of requestedSources) {
    for (const mapped of MEMORY_SOURCE_ALIASES[source] || []) {
      values.add(mapped);
    }
  }
  return Array.from(values);
}

function normalizeConversationSources(requestedSources) {
  const values = new Set();
  for (const source of requestedSources) {
    for (const mapped of CONVERSATION_SOURCE_ALIASES[source] || []) {
      values.add(mapped);
    }
  }
  return Array.from(values);
}

async function listBackfillDocuments(documentSources, limit = null) {
  if (!documentSources.length) return [];
  const db = openDb();
  try {
    const placeholders = documentSources.map(() => "?").join(", ");
    const params = [...documentSources];
    let sql = `
      SELECT id, text, source, path, timestamp
      FROM unified_messages
      WHERE lower(source) IN (${placeholders})
      ORDER BY timestamp DESC, id DESC
    `;
    if (Number(limit) > 0) {
      sql += " LIMIT ?";
      params.push(Number(limit));
    }
    return await allDb(db, sql, params);
  } finally {
    await closeDb(db).catch(() => null);
  }
}

async function listBackfillConversationMessages(conversationSources, limit = null) {
  if (!conversationSources.length) return [];
  const db = openDb();
  try {
    const placeholders = conversationSources.map(() => "?").join(", ");
    const params = [...conversationSources];
    let sql = `
      SELECT id, text, source, handle, timestamp, path, is_from_me
      FROM unified_messages
      WHERE lower(source) IN (${placeholders})
      ORDER BY timestamp DESC, id DESC
    `;
    if (Number(limit) > 0) {
      sql += " LIMIT ?";
      params.push(Number(limit));
    }
    return await allDb(db, sql, params);
  } finally {
    await closeDb(db).catch(() => null);
  }
}

async function listBackfillOutboundMessages(limit = null) {
  const db = openDb();
  try {
    let sql = `
      SELECT id, text, source, handle, timestamp, path, is_from_me
      FROM unified_messages
      WHERE is_from_me = 1
      ORDER BY timestamp DESC, id DESC
    `;
    const params = [];
    if (Number(limit) > 0) {
      sql += " LIMIT ?";
      params.push(Number(limit));
    }
    return await allDb(db, sql, params);
  } finally {
    await closeDb(db).catch(() => null);
  }
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
}

function isReplayableOutcomeDisposition(value) {
  return SUPERVISION_READY_DISPOSITIONS.has(String(value || "").trim().toUpperCase());
}

function hasMeaningfulOutcomeText(value) {
  return String(value || "").trim().length > 0;
}

function isGenericSupervisionText(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  if (/^thanks\s+[0-9]{6,}/i.test(normalized)) return true;
  return GENERIC_SUPERVISION_MARKERS.some((marker) => normalized.includes(marker));
}

function normalizeOutcomeHandle(row = {}) {
  const direct = String(row?.contact_handle || "").trim();
  if (direct) return direct.toLowerCase();
  const threadRef = String(row?.thread_ref || "").trim();
  if (!threadRef) return "";
  const parts = threadRef.split(":");
  return String(parts.slice(2).join(":") || "").trim().toLowerCase();
}

function buildOutboundMessageIndex(rows) {
  const byChannelHandle = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const source = String(row?.source || "").trim().toLowerCase();
    const handle = String(row?.handle || "").trim().toLowerCase();
    const text = String(row?.text || "");
    const timestamp = String(row?.timestamp || "").trim();
    if (!source || !handle || !timestamp || !hasMeaningfulOutcomeText(text)) continue;
    const entry = { source, handle, text, timestamp };
    for (const [channel, sources] of Object.entries(OUTBOUND_CHANNEL_SOURCE_MAP)) {
      if (!sources.includes(source)) continue;
      const key = `${channel}::${handle}`;
      const bucket = byChannelHandle.get(key) || [];
      bucket.push(entry);
      byChannelHandle.set(key, bucket);
    }
  }
  for (const bucket of byChannelHandle.values()) {
    bucket.sort((left, right) => Date.parse(String(right.timestamp || 0)) - Date.parse(String(left.timestamp || 0)));
  }
  return byChannelHandle;
}

function resolveOutcomeFinalText(row = {}, outboundIndex = new Map()) {
  const channel = String(row?.channel || "").trim().toLowerCase();
  const handle = normalizeOutcomeHandle(row);
  const occurredAt = Date.parse(String(row?.created_at || ""));
  if (!channel || !handle || !Number.isFinite(occurredAt)) return null;
  const candidates = outboundIndex.get(`${channel}::${handle}`) || [];
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const candidateTime = Date.parse(String(candidate.timestamp || ""));
    if (!Number.isFinite(candidateTime)) continue;
    const distance = Math.abs(candidateTime - occurredAt);
    if (distance > 30 * 60 * 1000) continue;
    const text = String(candidate.text || "");
    if (!hasMeaningfulOutcomeText(text) || isGenericSupervisionText(text)) continue;
    if (distance < bestDistance) {
      best = text;
      bestDistance = distance;
    }
  }
  return best;
}

function normalizedEditDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a && !b) return 0;
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length] / Math.max(a.length, b.length);
}

function inferDraftOutcomeRowsFromGenerated(rows, outboundIndex = new Map(), options = {}) {
  const maxDistance = Number(options.maxEditDistance) > 0 ? Number(options.maxEditDistance) : 0.45;
  const maxWindowMs = Number(options.maxWindowMs) > 0 ? Number(options.maxWindowMs) : 90 * 60 * 1000;
  const existingSourceRefs = new Set();
  const existingCycles = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const eventKind = String(row?.event_kind || "").trim().toLowerCase();
    if (eventKind !== "draft_outcome") continue;
    existingSourceRefs.add(String(row?.source_ref || "").trim());
    const cycleId = String(row?.cycle_id || "").trim();
    if (cycleId) existingCycles.add(cycleId);
  }

  const inferred = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const eventKind = String(row?.event_kind || "").trim().toLowerCase();
    if (eventKind !== "draft_generated") continue;
    const cycleId = String(row?.cycle_id || "").trim();
    const candidateId = String(row?.candidate_id || "").trim();
    const threadRef = String(row?.thread_ref || "").trim();
    const channel = String(row?.channel || "").trim().toLowerCase();
    const contactHandle = String(row?.contact_handle || "").trim().toLowerCase();
    const suggestionText = String(row?.suggestion_text || "").trim();
    const createdAt = String(row?.created_at || "").trim();
    const createdAtMs = Date.parse(createdAt);
    if (!cycleId || !candidateId || !threadRef || !channel || !contactHandle || !createdAt) continue;
    if (existingCycles.has(cycleId)) continue;
    if (!isUuidLike(cycleId) || !isUuidLike(candidateId)) continue;
    if (!hasMeaningfulOutcomeText(suggestionText) || isGenericSupervisionText(suggestionText)) continue;
    if (!Number.isFinite(createdAtMs)) continue;
    const outboundCandidates = outboundIndex.get(`${channel}::${contactHandle}`) || [];
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const outbound of outboundCandidates) {
      const outboundMs = Date.parse(String(outbound?.timestamp || ""));
      const outboundText = String(outbound?.text || "");
      if (!Number.isFinite(outboundMs)) continue;
      if (outboundMs < createdAtMs || outboundMs - createdAtMs > maxWindowMs) continue;
      if (!hasMeaningfulOutcomeText(outboundText) || isGenericSupervisionText(outboundText)) continue;
      const distance = normalizedEditDistance(suggestionText, outboundText);
      if (distance > maxDistance) continue;
      if (distance < bestDistance) {
        best = {
          finalText: outboundText,
          occurredAt: String(outbound.timestamp || createdAt).trim() || createdAt,
          editDistance: distance,
        };
        bestDistance = distance;
      }
    }
    if (!best) continue;
    const disposition = best.editDistance === 0 ? "SENT_AS_IS" : "EDITED_THEN_SENT";
    const sourceRef = `draft-outcome-inferred:${cycleId}:${candidateId}:${disposition.toLowerCase()}:${best.occurredAt}`;
    if (existingSourceRefs.has(sourceRef)) continue;
    inferred.push({
      event_kind: "draft_outcome",
      source_ref: sourceRef,
      cycle_id: cycleId,
      candidate_id: candidateId,
      thread_ref: threadRef,
      channel,
      contact_handle: contactHandle,
      runtime_mode: String(row?.runtime_mode || "").trim() || "trinity",
      suggestion_text: suggestionText,
      final_text: best.finalText,
      reason: disposition,
      metadata: {
        source_product: "reply",
        inferred_from: "draft_generated_outbound_match",
        edit_distance: best.editDistance,
        send_result: "ok",
        notes: "historical_outbound_match",
      },
      created_at: best.occurredAt,
    });
    existingSourceRefs.add(sourceRef);
    existingCycles.add(cycleId);
  }
  return inferred;
}

function buildReplayableOutcomeTexts(row = {}) {
  const suggestionText = row?.suggestion_text == null ? null : String(row.suggestion_text);
  const finalText = row?.final_text == null ? null : String(row.final_text);
  const disposition = String(row?.reason || "").trim().toUpperCase();
  if (!hasMeaningfulOutcomeText(finalText) && disposition === "SENT_AS_IS" && hasMeaningfulOutcomeText(suggestionText)) {
    return {
      originalDraftText: suggestionText,
      finalText: suggestionText,
    };
  }
  return {
    originalDraftText: suggestionText,
    finalText,
  };
}

function buildOutcomeBackfillEvents(rows, options = {}) {
  const resolveFinalText = typeof options.resolveFinalText === "function" ? options.resolveFinalText : null;
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.event_kind || "").trim().toLowerCase() === "draft_outcome")
    .filter((row) => {
      const runtimeMode = String(row?.runtime_mode || "").trim().toLowerCase();
      return runtimeMode === "trinity" || runtimeMode === "";
    })
    .filter((row) => isUuidLike(row?.cycle_id))
    .filter((row) => isUuidLike(row?.candidate_id))
    .filter((row) => String(row?.thread_ref || "").trim())
    .filter((row) => String(row?.channel || "").trim())
    .filter((row) => isReplayableOutcomeDisposition(row?.reason))
    .map((row) => {
      const metadata = (() => {
        try {
          return JSON.parse(String(row?.metadata_json || "{}"));
        } catch {
          return {};
        }
      })();
      const candidateId = String(row.candidate_id).trim();
      const disposition = String(row?.reason || "").trim().toUpperCase();
      const texts = buildReplayableOutcomeTexts(row);
      const recoveredFinalText = resolveFinalText ? resolveFinalText(row) : null;
      if (hasMeaningfulOutcomeText(recoveredFinalText) && !isGenericSupervisionText(recoveredFinalText)) {
        texts.finalText = recoveredFinalText;
      }
      const supervisionText = texts.finalText || texts.originalDraftText;
      if (!disposition || !hasMeaningfulOutcomeText(supervisionText)) {
        return null;
      }
      if (isGenericSupervisionText(supervisionText)) {
        return null;
      }
      return buildDraftOutcomeEvent({
        cycle_id: String(row.cycle_id).trim(),
        thread_ref: String(row.thread_ref || "").trim(),
        channel: String(row.channel || "").trim(),
        disposition,
        occurred_at: String(row.created_at || "").trim(),
        candidate_id: candidateId,
        original_draft_text: texts.originalDraftText,
        final_text: texts.finalText,
        edit_distance: metadata.edit_distance ?? null,
        latency_ms: metadata.latency_ms ?? null,
        send_result: metadata.send_result ?? null,
        notes: metadata.notes ?? null,
      });
    })
    .filter(Boolean);
}

function buildContactIntelligenceEvents(contacts) {
  return (Array.isArray(contacts) ? contacts : [])
    .filter((contact) => contact && typeof contact === "object")
    .map((contact) => {
      const notes = Array.isArray(contact.notes)
        ? contact.notes.map((note) => String(note?.text || "").trim()).filter(Boolean)
        : [];
      const pendingSuggestions = Array.isArray(contact.pendingSuggestions)
        ? contact.pendingSuggestions
          .map((item) => ({
            type: String(item?.type || "").trim() || null,
            content: String(item?.content || "").trim() || null,
            timestamp: String(item?.timestamp || "").trim() || null,
          }))
          .filter((item) => item.content)
        : [];
      const hasIntelligence = Boolean(
        String(contact.profession || "").trim()
        || String(contact.relationship || "").trim()
        || String(contact.company || "").trim()
        || String(contact.linkedinUrl || "").trim()
        || String(contact.intro || "").trim()
        || notes.length
        || pendingSuggestions.length
        || (contact.kycAnalysis && typeof contact.kycAnalysis === "object")
      );
      if (!hasIntelligence) return null;
      const summaryLines = [
        String(contact.displayName || contact.handle || "").trim() ? `Contact: ${String(contact.displayName || contact.handle || "").trim()}` : "",
        String(contact.profession || "").trim() ? `Profession: ${String(contact.profession || "").trim()}` : "",
        String(contact.relationship || "").trim() ? `Relationship: ${String(contact.relationship || "").trim()}` : "",
        String(contact.company || "").trim() ? `Company: ${String(contact.company || "").trim()}` : "",
        String(contact.linkedinUrl || "").trim() ? `LinkedIn: ${String(contact.linkedinUrl || "").trim()}` : "",
        String(contact.intro || "").trim() ? `Intro: ${String(contact.intro || "").trim()}` : "",
        notes.length ? `Notes: ${notes.join(" | ")}` : "",
        pendingSuggestions.length
          ? `Suggestions: ${pendingSuggestions.map((item) => `${item.type || "suggestion"}=${item.content}`).join(" | ")}`
          : "",
      ].filter(Boolean);
      const occurredAt = String(contact.lastContacted || "").trim() || new Date().toISOString();
      const sourceKey = [
        contact.id || contact.handle || "unknown",
        occurredAt,
        summaryLines.join("||"),
        JSON.stringify(contact.kycAnalysis || null),
      ].join("::");
      return {
        company_id: process.env.REPLY_RUNTIME_COMPANY_ID || undefined,
        event_kind: "contact_intelligence_upserted",
        source_ref: `contact-intelligence:${crypto.createHash("sha1").update(sourceKey).digest("hex")}`,
        occurred_at: occurredAt,
        thread_ref: null,
        channel: String(contact.lastChannel || "").trim().toLowerCase() || null,
        contact_handle: String(contact.handle || "").trim() || null,
        content_text: summaryLines.join("\n"),
        metadata: {
          contact_id: String(contact.id || "").trim() || null,
          display_name: String(contact.displayName || "").trim() || null,
          notes,
          profession: String(contact.profession || "").trim() || null,
          relationship: String(contact.relationship || "").trim() || null,
          company: String(contact.company || "").trim() || null,
          linkedin_url: String(contact.linkedinUrl || "").trim() || null,
          intro: String(contact.intro || "").trim() || null,
          pending_suggestions: pendingSuggestions,
          rejected_suggestions: Array.isArray(contact.rejectedSuggestions) ? contact.rejectedSuggestions : [],
          kyc_analysis: contact.kycAnalysis && typeof contact.kycAnalysis === "object" ? contact.kycAnalysis : null,
          source_product: "reply",
        },
      };
    })
    .filter(Boolean);
}

async function backfillTrinitySources(options = {}) {
  const requestedSources = normalizeRequestedSources(options.sources);
  const documentSources = normalizeDocumentSources(requestedSources);
  const conversationSources = normalizeConversationSources(requestedSources);
  const memorySources = normalizeMemorySources(requestedSources);
  const documentLimit = Number(options.documentLimit) > 0 ? Number(options.documentLimit) : null;
  const messageLimit = Number(options.messageLimit) > 0 ? Number(options.messageLimit) : null;
  const contactLimit = Number(options.contactLimit) > 0 ? Number(options.contactLimit) : null;
  const outcomeLimit = Number(options.outcomeLimit) > 0 ? Number(options.outcomeLimit) : null;
  const shouldDrain = options.drain !== false;

  const result = {
    status: "ok",
    requested_sources: requestedSources,
    document_sources: documentSources,
    conversation_sources: conversationSources,
    memory_sources: memorySources,
    queued_document_registrations: 0,
    queued_memory_events: 0,
    replayed_outcomes: 0,
    skipped_outcomes: 0,
    failed_outcomes: 0,
    document_rows_scanned: 0,
    conversation_rows_scanned: 0,
    contacts_scanned: 0,
    outcome_rows_scanned: 0,
    trinity_batch_results: {},
  };

  if (documentSources.length) {
    const rows = await listBackfillDocuments(documentSources, documentLimit);
    const registrations = buildRuntimeDocumentRegistrations(rows);
    result.document_rows_scanned = rows.length;
    if (registrations.length) {
      result.trinity_batch_results.register_documents = runTrinityBatchCommand(
        "register-documents-batch",
        registrations.map((registration) => buildDocumentRegistration(registration)),
      );
    }
    result.queued_document_registrations = registrations.length;
  }

  const memoryEvents = [];
  if (conversationSources.length) {
    const rows = await listBackfillConversationMessages(conversationSources, messageLimit);
    const events = buildRuntimeMemoryEventsForMessages(rows);
    result.conversation_rows_scanned = rows.length;
    memoryEvents.push(...events.map((event) => buildMemoryEvent(event)));
    result.queued_memory_events += events.length;
  }

  if (memorySources.includes("contacts") || memorySources.includes("contact-intelligence")) {
    await contactStore.waitUntilReady();
    await contactStore.refresh();
    const contacts = (Array.isArray(contactStore.contacts) ? contactStore.contacts : [])
      .slice(0, contactLimit || undefined);
    result.contacts_scanned = contacts.length;
    const events = [];
    if (memorySources.includes("contacts")) {
      events.push(...buildRuntimeMemoryEventsForContacts(contacts));
    }
    if (memorySources.includes("contact-intelligence")) {
      events.push(...buildContactIntelligenceEvents(contacts));
    }
    memoryEvents.push(...events.map((event) => buildMemoryEvent(event)));
    result.queued_memory_events += events.length;
  }

  if (memoryEvents.length) {
    result.trinity_batch_results.ingest_memory_events = runTrinityBatchCommand(
      "ingest-memory-events-batch",
      memoryEvents,
    );
  }

  if (memorySources.includes("accepted-outcome")) {
    const rows = await draftLearningStore.listLearningEvents(outcomeLimit || 500);
    const outboundMessages = await listBackfillOutboundMessages(messageLimit || outcomeLimit || 2000);
    const outboundIndex = buildOutboundMessageIndex(outboundMessages);
    const inferredRows = inferDraftOutcomeRowsFromGenerated(rows, outboundIndex);
    for (const row of inferredRows) {
      await draftLearningStore.appendLearningEvent(row).catch(() => null);
    }
    const combinedRows = inferredRows.length ? [...inferredRows, ...rows] : rows;
    const outcomeEvents = buildOutcomeBackfillEvents(combinedRows, {
      resolveFinalText: (row) => resolveOutcomeFinalText(row, outboundIndex),
    });
    result.outcome_rows_scanned = rows.length;
    result.inferred_outcomes = inferredRows.length;
    if (outcomeEvents.length) {
      const batchResult = runTrinityBatchCommand("record-outcomes-batch", outcomeEvents);
      result.trinity_batch_results.record_outcomes = batchResult;
      result.replayed_outcomes = Number(batchResult.processed_count) || 0;
      const errors = Array.isArray(batchResult.errors) ? batchResult.errors : [];
      const skipped = errors.filter((item) => String(item?.message || "").includes("/cycles/")).length;
      result.skipped_outcomes = skipped;
      result.failed_outcomes = Math.max(0, (Number(batchResult.error_count) || 0) - skipped);
      if (errors.length) {
        result.outcome_errors = errors;
      }
    }
  }

  return result;
}

module.exports = {
  backfillTrinitySources,
  buildOutboundMessageIndex,
  resolveOutcomeFinalText,
  inferDraftOutcomeRowsFromGenerated,
  normalizedEditDistance,
  buildOutcomeBackfillEvents,
  buildContactIntelligenceEvents,
  listBackfillOutboundMessages,
  listBackfillDocuments,
  normalizeRequestedSources,
};

function runTrinityBatchCommand(command, items) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-trinity-batch-"));
  const inputFile = path.join(tempDir, "payload.json");
  fs.writeFileSync(inputFile, `${JSON.stringify({ items }, null, 2)}\n`, "utf-8");
  const pythonBin = resolveTrinityPythonBin();
  const trinityRoot = resolveTrinityRuntimeRoot();
  const env = {
    ...process.env,
    PYTHONPATH: process.env.PYTHONPATH
      ? `${path.join(trinityRoot, "core")}${path.delimiter}${process.env.PYTHONPATH}`
      : path.join(trinityRoot, "core"),
  };
  try {
    const result = spawnSync(
      pythonBin,
      ["-m", "trinity_core.cli", command, "--adapter", "reply", "--input-file", inputFile],
      {
        cwd: trinityRoot,
        env,
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
      },
    );
    if (result.status !== 0) {
      throw new Error(String(result.stderr || result.stdout || `${command} failed`).trim());
    }
    return JSON.parse(String(result.stdout || "{}"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const sources = [];
  let documentLimit = null;
  let messageLimit = null;
  let contactLimit = null;
  let outcomeLimit = null;
  let drain = true;
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim();
    if (arg === "--source") {
      sources.push(String(args[index + 1] || "").trim());
      index += 1;
      continue;
    }
    if (arg === "--document-limit") {
      documentLimit = Number(args[index + 1] || 0) || null;
      index += 1;
      continue;
    }
    if (arg === "--contact-limit") {
      contactLimit = Number(args[index + 1] || 0) || null;
      index += 1;
      continue;
    }
    if (arg === "--message-limit") {
      messageLimit = Number(args[index + 1] || 0) || null;
      index += 1;
      continue;
    }
    if (arg === "--outcome-limit") {
      outcomeLimit = Number(args[index + 1] || 0) || null;
      index += 1;
      continue;
    }
    if (arg === "--no-drain") {
      drain = false;
    }
  }
  backfillTrinitySources({ sources, documentLimit, messageLimit, contactLimit, outcomeLimit, drain })
    .then((payload) => {
      console.log(JSON.stringify(payload, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({ status: "error", message: String(error?.message || error) }, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await Promise.allSettled([
        contactStore.close?.(),
        draftLearningStore.close?.(),
      ]);
    });
}
