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
        "CREATE INDEX IF NOT EXISTS idx_reply_draft_learning_events_kind ON reply_draft_learning_events(event_kind, created_at)",
        (err) => {
          db.close();
          if (err) {
            readyPromise = null;
            reject(err);
            return;
          }
          resolve();
        },
      );
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
  try {
    await runDb(
      db,
      `
        INSERT OR REPLACE INTO reply_draft_learning_events (
          event_kind,
          source_ref,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        String(event.event_kind || "").trim(),
        String(event.source_ref || "").trim(),
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
    return {
      status: "recorded",
      event_kind: String(event.event_kind || "").trim(),
      source_ref: String(event.source_ref || "").trim(),
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

module.exports = {
  appendLearningEvent,
  listLearningEvents,
  waitUntilReady,
};
