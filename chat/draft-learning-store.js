const sqlite3 = require("sqlite3").verbose();

const { ensureDataHome, dataPath } = require("./app-paths.js");

ensureDataHome();

const DB_PATH = process.env.REPLY_CHAT_DB_PATH || dataPath("chat.db");
let readyPromise = null;

function openDb(mode) {
  return mode == null
    ? new sqlite3.Database(DB_PATH)
    : new sqlite3.Database(DB_PATH, mode);
}

function runDb(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function allDb(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function waitUntilReady() {
  if (readyPromise) return readyPromise;
  const db = openDb();
  readyPromise = new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("PRAGMA journal_mode = WAL");
      db.run("PRAGMA busy_timeout = 5000");
      db.run(`
        CREATE TABLE IF NOT EXISTS reply_draft_learning_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_kind TEXT NOT NULL,
          source_ref TEXT NOT NULL UNIQUE,
          generation_id TEXT,
          cycle_id TEXT,
          candidate_id TEXT,
          thread_ref TEXT,
          channel TEXT,
          contact_handle TEXT,
          runtime_mode TEXT,
          suggestion_text TEXT,
          final_text TEXT,
          rating INTEGER,
          reason TEXT,
          metadata_json TEXT,
          created_at TEXT NOT NULL
        )
      `);
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_reply_draft_learning_events_cycle ON reply_draft_learning_events(cycle_id, created_at)",
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_reply_draft_learning_events_generation ON reply_draft_learning_events(generation_id, created_at)",
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_reply_draft_learning_events_kind ON reply_draft_learning_events(event_kind, created_at)",
      );
      db.all("PRAGMA table_info(reply_draft_learning_events)", (schemaErr, rows) => {
        if (schemaErr) {
          db.close();
          readyPromise = null;
          reject(schemaErr);
          return;
        }
        const columns = new Set((rows || []).map((row) => String(row?.name || "").trim()));
        const finish = (err = null) => {
          db.close();
          if (err) {
            readyPromise = null;
            reject(err);
            return;
          }
          resolve();
        };
        if (!columns.has("generation_id")) {
          db.run("ALTER TABLE reply_draft_learning_events ADD COLUMN generation_id TEXT", (alterErr) => {
            if (alterErr) return finish(alterErr);
            db.run(
              "CREATE INDEX IF NOT EXISTS idx_reply_draft_learning_events_generation ON reply_draft_learning_events(generation_id, created_at)",
              finish,
            );
          });
          return;
        }
        finish();
      });
    });
  });
  return readyPromise;
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value == null ? {} : value);
  } catch {
    return "{}";
  }
}

async function appendLearningEvent(event = {}) {
  await waitUntilReady();
  const db = openDb();
  const createdAt = String(event.created_at || event.createdAt || new Date().toISOString()).trim();
  const generationId = resolveGenerationId(event);
  try {
    try {
      await runDb(
        db,
        `
          INSERT OR REPLACE INTO reply_draft_learning_events (
            event_kind,
            source_ref,
            generation_id,
            cycle_id,
            candidate_id,
            thread_ref,
            channel,
            contact_handle,
            runtime_mode,
            suggestion_text,
            final_text,
            rating,
            reason,
            metadata_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          String(event.event_kind || "").trim(),
          String(event.source_ref || "").trim(),
          generationId,
          String(event.cycle_id || "").trim() || null,
          String(event.candidate_id || "").trim() || null,
          String(event.thread_ref || "").trim() || null,
          String(event.channel || "").trim().toLowerCase() || null,
          String(event.contact_handle || "").trim() || null,
          String(event.runtime_mode || "").trim() || null,
          event.suggestion_text == null ? null : String(event.suggestion_text),
          event.final_text == null ? null : String(event.final_text),
          event.rating == null ? null : Number(event.rating),
          event.reason == null ? null : String(event.reason),
          safeJsonStringify(event.metadata),
          createdAt,
        ],
      );
    } catch (error) {
      if (!/no such column:\s*generation_id/i.test(String(error?.message || ""))) {
        throw error;
      }
      readyPromise = null;
      await waitUntilReady();
      await runDb(
        db,
        `
          INSERT OR REPLACE INTO reply_draft_learning_events (
            event_kind,
            source_ref,
            generation_id,
            cycle_id,
            candidate_id,
            thread_ref,
            channel,
            contact_handle,
            runtime_mode,
            suggestion_text,
            final_text,
            rating,
            reason,
            metadata_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          String(event.event_kind || "").trim(),
          String(event.source_ref || "").trim(),
          generationId,
          String(event.cycle_id || "").trim() || null,
          String(event.candidate_id || "").trim() || null,
          String(event.thread_ref || "").trim() || null,
          String(event.channel || "").trim().toLowerCase() || null,
          String(event.contact_handle || "").trim() || null,
          String(event.runtime_mode || "").trim() || null,
          event.suggestion_text == null ? null : String(event.suggestion_text),
          event.final_text == null ? null : String(event.final_text),
          event.rating == null ? null : Number(event.rating),
          event.reason == null ? null : String(event.reason),
          safeJsonStringify(event.metadata),
          createdAt,
        ],
      );
    }
    return {
      status: "recorded",
      event_kind: String(event.event_kind || "").trim(),
      source_ref: String(event.source_ref || "").trim(),
      generation_id: generationId,
      created_at: createdAt,
    };
  } finally {
    db.close();
  }
}

async function listLearningEvents(limit = 50) {
  await waitUntilReady();
  const db = openDb(sqlite3.OPEN_READONLY);
  try {
    return await allDb(
      db,
      `
        SELECT *
        FROM reply_draft_learning_events
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      [Math.max(1, Math.min(Number(limit) || 50, 500))],
    );
  } finally {
    db.close();
  }
}

async function listLearningEventsByKind(eventKind, options = {}) {
  await waitUntilReady();
  const db = openDb(sqlite3.OPEN_READONLY);
  const normalizedKind = String(eventKind || "").trim();
  const normalizedHandle = String(options.contactHandle || "").trim().toLowerCase();
  const normalizedChannel = String(options.channel || "").trim().toLowerCase();
  const createdAfter = String(options.createdAfter || "").trim();
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, 1000));
  try {
    const clauses = ["event_kind = ?"];
    const params = [normalizedKind];
    if (normalizedHandle) {
      clauses.push("lower(contact_handle) = ?");
      params.push(normalizedHandle);
    }
    if (normalizedChannel) {
      clauses.push("lower(channel) = ?");
      params.push(normalizedChannel);
    }
    if (createdAfter) {
      clauses.push("created_at >= ?");
      params.push(createdAfter);
    }
    params.push(limit);
    return await allDb(
      db,
      `
        SELECT *
        FROM reply_draft_learning_events
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      params,
    );
  } finally {
    db.close();
  }
}

function resolveGenerationId(event = {}) {
  const explicit = String(event.generation_id || event.generationId || "").trim();
  if (explicit) return explicit;
  const cycleId = String(event.cycle_id || "").trim();
  const candidateId = String(event.candidate_id || "").trim();
  if (cycleId && candidateId) return `${cycleId}:${candidateId}`;
  if (cycleId) return cycleId;
  const threadRef = String(event.thread_ref || "").trim();
  const channel = String(event.channel || "").trim().toLowerCase();
  const handle = String(event.contact_handle || "").trim().toLowerCase();
  const sourceRef = String(event.source_ref || "").trim();
  if (threadRef && channel) return `${threadRef}:${channel}`;
  if (channel && handle) return `${channel}:${handle}`;
  return sourceRef || null;
}

function parseMetadataJson(raw) {
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeImportedRuntimeKnowledgeSummary(value) {
  if (!value || typeof value !== "object") return null;
  const importedRecordCount = Number(value.importedRecordCount ?? value.imported_record_count);
  if (!Number.isFinite(importedRecordCount) || importedRecordCount <= 0) return null;
  const familyCounts = value.familyCounts && typeof value.familyCounts === "object"
    ? value.familyCounts
    : (value.family_counts && typeof value.family_counts === "object" ? value.family_counts : {});
  const importIds = Array.isArray(value.importIds)
    ? value.importIds
    : (Array.isArray(value.import_ids) ? value.import_ids : []);
  const artifactRefs = Array.isArray(value.artifactRefs)
    ? value.artifactRefs
    : (Array.isArray(value.artifact_refs) ? value.artifact_refs : []);
  const topSupport = Array.isArray(value.topSupport)
    ? value.topSupport
    : (Array.isArray(value.top_support) ? value.top_support : []);
  return {
    importedRecordCount,
    familyCounts,
    importIds,
    artifactRefs,
    topSupport,
  };
}

async function listRecentLearningSummary(options = {}) {
  const rows = await listLearningEvents(options.limit || 200);
  const channel = String(options.channel || "").trim().toLowerCase();
  const contactHandle = String(options.contactHandle || "").trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (channel && String(row?.channel || "").trim().toLowerCase() !== channel) return false;
    if (contactHandle && String(row?.contact_handle || "").trim().toLowerCase() !== contactHandle) return false;
    return true;
  });
  const byGeneration = new Map();
  for (const row of filtered) {
    const generationId = String(row?.generation_id || "").trim();
    if (!generationId) continue;
    const entry = byGeneration.get(generationId) || {
      generationId,
      cycleId: String(row?.cycle_id || "").trim() || null,
      candidateId: String(row?.candidate_id || "").trim() || null,
      threadRef: String(row?.thread_ref || "").trim() || null,
      channel: String(row?.channel || "").trim() || null,
      contactHandle: String(row?.contact_handle || "").trim() || null,
      suggestionText: String(row?.suggestion_text || "").trim() || null,
      finalText: null,
      feedbackReasons: [],
      revisionCount: 0,
      outcomeDisposition: null,
      latestAt: String(row?.created_at || "").trim() || null,
    };
    const kind = String(row?.event_kind || "").trim().toLowerCase();
    if (kind === "draft_outcome") {
      entry.finalText = String(row?.final_text || "").trim() || entry.finalText;
      entry.outcomeDisposition = String(row?.reason || "").trim() || entry.outcomeDisposition;
    } else if (kind === "draft_feedback") {
      const reason = String(row?.reason || "").trim();
      if (reason) entry.feedbackReasons.push(reason);
    } else if (kind === "draft_revision") {
      entry.revisionCount += 1;
      entry.finalText = String(row?.final_text || "").trim() || entry.finalText;
    }
    entry.latestAt = String(row?.created_at || "").trim() || entry.latestAt;
    byGeneration.set(generationId, entry);
  }
  return Array.from(byGeneration.values())
    .sort((left, right) => String(right.latestAt || "").localeCompare(String(left.latestAt || "")))
    .slice(0, Math.max(1, Math.min(Number(options.summaryLimit) || 12, 100)));
}

async function summarizeImportedRuntimeKnowledgeUsage(options = {}) {
  const rows = await listLearningEvents(options.limit || 500);
  const channel = String(options.channel || "").trim().toLowerCase();
  const contactHandle = String(options.contactHandle || "").trim().toLowerCase();
  const byGeneration = new Map();

  for (const row of rows) {
    const rowChannel = String(row?.channel || "").trim().toLowerCase();
    const rowHandle = String(row?.contact_handle || "").trim().toLowerCase();
    if (channel && rowChannel !== channel) continue;
    if (contactHandle && rowHandle !== contactHandle) continue;

    const generationId = String(row?.generation_id || "").trim();
    if (!generationId) continue;
    const metadata = parseMetadataJson(row?.metadata_json);
    const importedRuntimeKnowledge = normalizeImportedRuntimeKnowledgeSummary(
      metadata.imported_runtime_knowledge || null,
    );
    const existing = byGeneration.get(generationId) || {
      generationId,
      channel: rowChannel || null,
      contactHandle: rowHandle || null,
      cycleId: String(row?.cycle_id || "").trim() || null,
      outcomeDisposition: null,
      revisionCount: 0,
      importedRuntimeKnowledge: null,
      latestAt: String(row?.created_at || "").trim() || null,
    };
    if (importedRuntimeKnowledge && !existing.importedRuntimeKnowledge) {
      existing.importedRuntimeKnowledge = importedRuntimeKnowledge;
    }
    const kind = String(row?.event_kind || "").trim().toLowerCase();
    if (kind === "draft_outcome") {
      existing.outcomeDisposition = String(row?.reason || "").trim() || existing.outcomeDisposition;
    } else if (kind === "draft_revision") {
      existing.revisionCount += 1;
    }
    existing.latestAt = String(row?.created_at || "").trim() || existing.latestAt;
    byGeneration.set(generationId, existing);
  }

  const generations = Array.from(byGeneration.values())
    .filter((entry) => entry.importedRuntimeKnowledge);
  const dispositionCounts = {};
  const familyCounts = {};
  const artifactRefCounts = {};
  const topSupportDocumentCounts = {};
  let revisionCountTotal = 0;
  let importedRecordCountTotal = 0;
  let generationsWithOutcomes = 0;

  for (const generation of generations) {
    revisionCountTotal += generation.revisionCount;
    importedRecordCountTotal += Number(generation.importedRuntimeKnowledge?.importedRecordCount || 0);
    if (generation.outcomeDisposition) {
      generationsWithOutcomes += 1;
      dispositionCounts[generation.outcomeDisposition] = (dispositionCounts[generation.outcomeDisposition] || 0) + 1;
    }
    const runtimeKnowledge = generation.importedRuntimeKnowledge || {};
    for (const [family, count] of Object.entries(runtimeKnowledge.familyCounts || {})) {
      const numericCount = Number(count);
      if (!Number.isFinite(numericCount) || numericCount <= 0) continue;
      familyCounts[family] = (familyCounts[family] || 0) + numericCount;
    }
    for (const artifactRef of runtimeKnowledge.artifactRefs || []) {
      const normalized = String(artifactRef || "").trim();
      if (!normalized) continue;
      artifactRefCounts[normalized] = (artifactRefCounts[normalized] || 0) + 1;
    }
    for (const support of runtimeKnowledge.topSupport || []) {
      const documentTitle = String(support?.documentTitle || support?.document_title || "").trim();
      if (!documentTitle) continue;
      topSupportDocumentCounts[documentTitle] = (topSupportDocumentCounts[documentTitle] || 0) + 1;
    }
  }

  const sortedCounts = (counts, limit = 10) =>
    Object.entries(counts)
      .sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return String(left[0]).localeCompare(String(right[0]));
      })
      .slice(0, limit)
      .map(([key, count]) => ({ key, count }));

  return {
    generationCount: generations.length,
    generationsWithOutcomes,
    outcomeDispositionCounts: dispositionCounts,
    revisionCountTotal,
    avgImportedRecordCount: generations.length ? Number((importedRecordCountTotal / generations.length).toFixed(2)) : 0,
    familyCounts,
    topArtifactRefs: sortedCounts(artifactRefCounts, 8),
    topSupportDocuments: sortedCounts(topSupportDocumentCounts, 8),
  };
}

module.exports = {
  appendLearningEvent,
  listLearningEvents,
  listLearningEventsByKind,
  listRecentLearningSummary,
  summarizeImportedRuntimeKnowledgeUsage,
  resolveGenerationId,
  close,
  waitUntilReady,
};

async function close() {
  readyPromise = null;
}
