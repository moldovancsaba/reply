const sqlite3 = require("sqlite3").verbose();
const { ensureDataHome, dataPath } = require("./app-paths.js");

ensureDataHome();

const DB_PATH = process.env.REPLY_CHAT_DB_PATH || dataPath("chat.db");
const SQLITE_BUSY_RETRY_ATTEMPTS = 80;
const SQLITE_BUSY_RETRY_DELAY_MS = 250;
const SQLITE_BUSY_TIMEOUT_MS = 20000;
let readyPromise = null;

function openDb(mode) {
  const db = mode == null
    ? new sqlite3.Database(DB_PATH)
    : new sqlite3.Database(DB_PATH, mode);
  try {
    db.configure("busyTimeout", SQLITE_BUSY_TIMEOUT_MS);
  } catch {
    // Ignore if the sqlite binding does not expose configure().
  }
  return db;
}

function runDb(db, sql, params = []) {
  return retryBusy(() => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  }));
}

function allDb(db, sql, params = []) {
  return retryBusy(() => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  }));
}

async function retryBusy(fn, attempts = SQLITE_BUSY_RETRY_ATTEMPTS, delayMs = SQLITE_BUSY_RETRY_DELAY_MS) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (String(err?.code || "") !== "SQLITE_BUSY") throw err;
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError || new Error("SQLITE_BUSY");
}

function waitUntilReady() {
  if (readyPromise) return readyPromise;
  const db = openDb();
  readyPromise = new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("PRAGMA journal_mode = WAL");
      db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
      db.run(`
        CREATE TABLE IF NOT EXISTS trinity_event_outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          delivered_at TEXT
        )
      `);
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_trinity_event_outbox_pending ON trinity_event_outbox(status, created_at)",
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

async function enqueueEvent(eventType, payload) {
  await waitUntilReady();
  const db = openDb();
  try {
    const now = new Date().toISOString();
    const result = await runDb(
      db,
      `
        INSERT INTO trinity_event_outbox (
          event_type, payload_json, status, attempt_count, last_error, created_at, updated_at, delivered_at
        ) VALUES (?, ?, 'pending', 0, NULL, ?, ?, NULL)
      `,
      [String(eventType || "").trim(), JSON.stringify(payload || {}), now, now],
    );
    return {
      id: result.lastID,
      eventType: String(eventType || "").trim(),
      payload,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
  } finally {
    db.close();
  }
}

async function listPendingEvents(limit = 25) {
  await waitUntilReady();
  const db = openDb(sqlite3.OPEN_READONLY);
  try {
    const rows = await allDb(
      db,
      `
        SELECT id, event_type, payload_json, status, attempt_count, last_error, created_at, updated_at
        FROM trinity_event_outbox
        WHERE status IN ('pending', 'failed')
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      `,
      [Math.max(1, Number(limit) || 25)],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      eventType: String(row.event_type || "").trim(),
      payload: safeJsonParse(row.payload_json, {}),
      status: String(row.status || "").trim() || "pending",
      attemptCount: Number(row.attempt_count) || 0,
      lastError: row.last_error == null ? null : String(row.last_error),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    }));
  } finally {
    db.close();
  }
}

async function markDelivered(id) {
  await waitUntilReady();
  const db = openDb();
  try {
    const now = new Date().toISOString();
    await runDb(
      db,
      `
        UPDATE trinity_event_outbox
        SET status = 'delivered',
            delivered_at = ?,
            updated_at = ?,
            last_error = NULL
        WHERE id = ?
      `,
      [now, now, Number(id)],
    );
  } finally {
    db.close();
  }
}

async function markFailed(id, errorText) {
  await waitUntilReady();
  const db = openDb();
  try {
    const now = new Date().toISOString();
    await runDb(
      db,
      `
        UPDATE trinity_event_outbox
        SET status = 'failed',
            attempt_count = attempt_count + 1,
            last_error = ?,
            updated_at = ?
        WHERE id = ?
      `,
      [String(errorText || "").trim() || "unknown_error", now, Number(id)],
    );
  } finally {
    db.close();
  }
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(String(raw || ""));
  } catch {
    return fallback;
  }
}

module.exports = {
  enqueueEvent,
  listPendingEvents,
  markDelivered,
  markFailed,
  waitUntilReady,
};
