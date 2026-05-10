const sqlite3 = require("sqlite3").verbose();
const { ensureDataHome, dataPath } = require("./app-paths.js");
const { channelFromDoc, isConversationDataSource } = require("./utils/chat-utils.js");

ensureDataHome();

const DB_PATH = dataPath("chat.db");
const GOLDEN_EXAMPLES_PATH = dataPath("prepared-golden-examples.json");
let storeReadyPromise = null;

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

function getDb(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(String(raw || ""));
  } catch {
    return fallback;
  }
}

function waitUntilReady() {
  if (storeReadyPromise) return storeReadyPromise;
  const db = openDb();
  storeReadyPromise = new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("PRAGMA journal_mode = WAL");
      db.run("PRAGMA busy_timeout = 5000");
      db.run(`
        CREATE TABLE IF NOT EXISTS draft_context_snapshots (
          handle TEXT PRIMARY KEY,
          latest_inbound_text TEXT,
          latest_inbound_timestamp TEXT,
          latest_inbound_channel TEXT,
          recent_thread_json TEXT,
          snippet_candidates_json TEXT,
          prepared_at TEXT
        )
      `, (err) => {
        db.close();
        if (err) return reject(err);
        resolve();
      });
    });
  }).catch((err) => {
    storeReadyPromise = null;
    throw err;
  });
  return storeReadyPromise;
}

function normalizeThreadRows(rows) {
  return rows.map((row) => ({
    id: row.id || null,
    text: String(row.text || ""),
    timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : null,
    source: row.source || null,
    path: row.path || null,
    channel: channelFromDoc({ path: row.path, source: row.source }),
    is_from_me: row.is_from_me == null ? false : Boolean(row.is_from_me),
    role: row.is_from_me ? "me" : "contact",
  }));
}

async function rebuildDraftContextSnapshots(handles = null) {
  await waitUntilReady();
  const db = openDb();
  try {
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA busy_timeout = 5000");
    const rawHandles = Array.isArray(handles) ? handles : [];
    const uniqueHandles = Array.from(new Set(rawHandles.map((h) => String(h || "").trim()).filter(Boolean)));
    const filterSql = uniqueHandles.length
      ? ` AND handle IN (${uniqueHandles.map(() => "?").join(", ")})`
      : "";

    const handlesRows = await allDb(db, `
      SELECT DISTINCT handle
      FROM unified_messages
      WHERE handle IS NOT NULL
        AND TRIM(handle) != ''
        AND ${`
          (
            LOWER(COALESCE(path, '')) LIKE 'imessage://%' OR
            LOWER(COALESCE(path, '')) LIKE 'whatsapp://%' OR
            LOWER(COALESCE(path, '')) LIKE 'mailto:%' OR
            LOWER(COALESCE(path, '')) LIKE 'email://%' OR
            LOWER(COALESCE(path, '')) LIKE 'linkedin://%' OR
            LOWER(COALESCE(path, '')) LIKE 'telegram://%' OR
            LOWER(COALESCE(path, '')) LIKE 'discord://%' OR
            LOWER(COALESCE(path, '')) LIKE 'signal://%' OR
            LOWER(COALESCE(path, '')) LIKE 'viber://%' OR
            LOWER(COALESCE(source, '')) IN ('imessage', 'imessage-live', 'whatsapp', 'mail', 'gmail', 'imap', 'linkedin', 'telegram', 'discord', 'signal', 'viber')
          )
        `}
        ${filterSql}
    `, uniqueHandles);

    await runDb(db, "BEGIN TRANSACTION");
    if (uniqueHandles.length) {
      await runDb(db, `DELETE FROM draft_context_snapshots WHERE handle IN (${uniqueHandles.map(() => "?").join(", ")})`, uniqueHandles);
    } else {
      await runDb(db, "DELETE FROM draft_context_snapshots");
    }

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO draft_context_snapshots (
        handle,
        latest_inbound_text,
        latest_inbound_timestamp,
        latest_inbound_channel,
        recent_thread_json,
        snippet_candidates_json,
        prepared_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const rows = Array.from(handlesRows);
    for (const row of rows) {
      const handle = String(row.handle || "").trim();
      if (!handle) continue;
      const latestInbound = await getDb(db, `
        SELECT text, timestamp, source, path
        FROM unified_messages
        WHERE handle = ?
          AND is_from_me = 0
          AND ${`
            (
              LOWER(COALESCE(path, '')) LIKE 'imessage://%' OR
              LOWER(COALESCE(path, '')) LIKE 'whatsapp://%' OR
              LOWER(COALESCE(path, '')) LIKE 'mailto:%' OR
              LOWER(COALESCE(path, '')) LIKE 'email://%' OR
              LOWER(COALESCE(path, '')) LIKE 'linkedin://%' OR
              LOWER(COALESCE(path, '')) LIKE 'telegram://%' OR
              LOWER(COALESCE(path, '')) LIKE 'discord://%' OR
              LOWER(COALESCE(path, '')) LIKE 'signal://%' OR
              LOWER(COALESCE(path, '')) LIKE 'viber://%' OR
              LOWER(COALESCE(source, '')) IN ('imessage', 'imessage-live', 'whatsapp', 'mail', 'gmail', 'imap', 'linkedin', 'telegram', 'discord', 'signal', 'viber')
            )
          `}
        ORDER BY timestamp DESC, id DESC
        LIMIT 1
      `, [handle]);

      const threadRows = await allDb(db, `
        SELECT id, text, source, handle, timestamp, path, is_from_me
        FROM unified_messages
        WHERE handle = ?
          AND ${`
            (
              LOWER(COALESCE(path, '')) LIKE 'imessage://%' OR
              LOWER(COALESCE(path, '')) LIKE 'whatsapp://%' OR
              LOWER(COALESCE(path, '')) LIKE 'mailto:%' OR
              LOWER(COALESCE(path, '')) LIKE 'email://%' OR
              LOWER(COALESCE(path, '')) LIKE 'linkedin://%' OR
              LOWER(COALESCE(path, '')) LIKE 'telegram://%' OR
              LOWER(COALESCE(path, '')) LIKE 'discord://%' OR
              LOWER(COALESCE(path, '')) LIKE 'signal://%' OR
              LOWER(COALESCE(path, '')) LIKE 'viber://%' OR
              LOWER(COALESCE(source, '')) IN ('imessage', 'imessage-live', 'whatsapp', 'mail', 'gmail', 'imap', 'linkedin', 'telegram', 'discord', 'signal', 'viber')
            )
          `}
        ORDER BY timestamp DESC, id DESC
        LIMIT 12
      `, [handle]);
      const normalizedThread = normalizeThreadRows(threadRows).reverse();
      const snippetCandidates = normalizedThread
        .filter((item) => !item.is_from_me && item.text)
        .slice(-3)
        .map((item) => ({
          text: item.text,
          source: item.source,
          path: item.path,
          score: 1,
        }));

      await new Promise((resolve, reject) => {
        insertStmt.run(
          handle,
          latestInbound ? String(latestInbound.text || "") : "",
          latestInbound?.timestamp || null,
          latestInbound ? channelFromDoc({ path: latestInbound.path, source: latestInbound.source }) : null,
          JSON.stringify(normalizedThread),
          JSON.stringify(snippetCandidates),
          new Date().toISOString(),
          (err) => {
            if (err) return reject(err);
            resolve();
          }
        );
      });
    }

    await new Promise((resolve, reject) => {
      insertStmt.finalize((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    await runDb(db, "COMMIT");
  } catch (err) {
    try { await runDb(db, "ROLLBACK"); } catch { }
    throw err;
  } finally {
    db.close();
  }
}

async function getDraftContextSnapshots(handles = []) {
  await waitUntilReady();
  const uniqueHandles = Array.from(new Set((handles || []).map((h) => String(h || "").trim()).filter(Boolean)));
  if (!uniqueHandles.length) return [];
  const db = openDb(sqlite3.OPEN_READONLY);
  try {
    const rows = await allDb(
      db,
      `SELECT * FROM draft_context_snapshots WHERE handle IN (${uniqueHandles.map(() => "?").join(", ")})`,
      uniqueHandles
    );
    return rows.map((row) => ({
      handle: row.handle,
      latestInboundText: String(row.latest_inbound_text || "").trim(),
      latestInboundTimestamp: row.latest_inbound_timestamp || null,
      latestInboundChannel: row.latest_inbound_channel || null,
      recentThread: safeJsonParse(row.recent_thread_json, []),
      snippetCandidates: safeJsonParse(row.snippet_candidates_json, []),
      preparedAt: row.prepared_at || null,
    }));
  } finally {
    db.close();
  }
}

function readPreparedGoldenExamples() {
  try {
    const raw = require("fs").readFileSync(GOLDEN_EXAMPLES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

async function rebuildPreparedGoldenExamples(limit = 5) {
  const { getGoldenExamples } = require("./vector-store.js");
  const items = await getGoldenExamples(limit);
  require("fs").writeFileSync(
    GOLDEN_EXAMPLES_PATH,
    JSON.stringify({ preparedAt: new Date().toISOString(), items }, null, 2),
    "utf8"
  );
  return items;
}

module.exports = {
  waitUntilReady,
  rebuildDraftContextSnapshots,
  getDraftContextSnapshots,
  readPreparedGoldenExamples,
  rebuildPreparedGoldenExamples,
};
