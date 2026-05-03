const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { ensureDataHome, dataPath } = require('./app-paths.js');
const { isConversationDataSource } = require('./utils/chat-utils.js');

ensureDataHome();
const DB_PATH = dataPath('chat.db');

function openMessageStoreDb(mode) {
    const db =
        mode === undefined
            ? new sqlite3.Database(DB_PATH)
            : new sqlite3.Database(DB_PATH, mode);
    db.on('error', (err) => {
        console.error('[message-store] SQLite error:', err.message);
    });
    return db;
}

function isConversationMessageRow(row) {
    return isConversationDataSource({
        path: row?.path,
        source: row?.source
    });
}

const CONVERSATION_SOURCE_SQL = `
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
`;

/**
 * Initialize the unified messages table
 */
function initialize() {
    const db = openMessageStoreDb();
    db.serialize(() => {
        db.run("PRAGMA journal_mode = WAL");
        db.run("PRAGMA busy_timeout = 5000");
        db.run(`
            CREATE TABLE IF NOT EXISTS unified_messages (
                id TEXT PRIMARY KEY,
                text TEXT,
                source TEXT,
                handle TEXT,
                timestamp TEXT,
                path TEXT,
                is_from_me INTEGER
            )
        `);
        db.run(`CREATE INDEX IF NOT EXISTS idx_unified_messages_handle_timestamp ON unified_messages(handle, timestamp DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_unified_messages_timestamp ON unified_messages(timestamp DESC)`);
        db.all("PRAGMA table_info(unified_messages)", (err, rows) => {
            if (err) {
                db.close();
                return;
            }
            const cols = new Set((rows || []).map((r) => String(r.name || "").toLowerCase()));
            if (!cols.has("is_from_me")) {
                db.run(`ALTER TABLE unified_messages ADD COLUMN is_from_me INTEGER`, () => db.close());
                return;
            }
            db.close();
        });
    });
}

/**
 * Save a batch of messages to the unified store
 * @param {Array} messages - List of {id, text, source, handle, timestamp, path, is_from_me}
 */
async function saveMessages(messages) {
    if (!messages || messages.length === 0) return;

    const db = openMessageStoreDb();
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("PRAGMA journal_mode = WAL");
            db.run("PRAGMA busy_timeout = 5000");

            const stmt = db.prepare(`
                INSERT OR REPLACE INTO unified_messages (id, text, source, handle, timestamp, path, is_from_me)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            db.run("BEGIN TRANSACTION");
            messages.forEach(m => {
                stmt.run(m.id, m.text, m.source, m.handle, m.timestamp, m.path, m.is_from_me == null ? null : (m.is_from_me ? 1 : 0));
            });
            db.run("COMMIT", (err) => {
                stmt.finalize();
                db.close();
                if (err) return reject(err);
                resolve();
            });
        });
    });
}

/**
 * Query messages from the unified store
 * @param {Object} filter - {source, handle, limit, offset}
 */
async function getMessages(filter = {}) {
    const db = openMessageStoreDb(sqlite3.OPEN_READONLY);
    db.run("PRAGMA busy_timeout = 5000");
    let query = "SELECT * FROM unified_messages WHERE 1=1";
    const params = [];

    if (filter.source) {
        query += " AND source = ?";
        params.push(filter.source);
    }
    if (filter.handle) {
        query += " AND handle = ?";
        params.push(filter.handle);
    }

    query += " ORDER BY timestamp DESC";

    if (filter.limit) {
        query += " LIMIT ?";
        params.push(filter.limit);
    }
    if (filter.offset) {
        query += " OFFSET ?";
        params.push(filter.offset);
    }

    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            db.close();
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

/**
 * Get a list of unique handles with their most recent message details.
 * Highly optimized for conversation list rendering.
 * @param {Object} filter - {limit, offset, q}
 */
async function getRecentConversations(filter = {}) {
    const db = openMessageStoreDb(sqlite3.OPEN_READONLY);
    db.run("PRAGMA busy_timeout = 5000");

    let query = `
        WITH LatestMessages AS (
            SELECT 
                handle, 
                text, 
                source, 
                timestamp, 
                path,
                ROW_NUMBER() OVER (PARTITION BY handle ORDER BY timestamp DESC) as rn
            FROM unified_messages
        )
        SELECT handle, text, source, timestamp, path
        FROM LatestMessages
        WHERE rn = 1
    `;

    const params = [];
    if (filter.q) {
        query = `
            WITH FilteredMessages AS (
                SELECT * FROM unified_messages 
                WHERE handle LIKE ? OR text LIKE ?
            ),
            LatestMessages AS (
                SELECT 
                    handle, 
                    text, 
                    source, 
                    timestamp, 
                    path,
                    ROW_NUMBER() OVER (PARTITION BY handle ORDER BY timestamp DESC) as rn
                FROM FilteredMessages
            )
            SELECT handle, text, source, timestamp, path
            FROM LatestMessages
            WHERE rn = 1
        `;
        params.push(`%${filter.q}%`, `%${filter.q}%`);
    }

    query += " ORDER BY timestamp DESC";

    if (filter.limit) {
        query += " LIMIT ?";
        params.push(filter.limit);
    }
    if (filter.offset) {
        query += " OFFSET ?";
        params.push(filter.offset);
    }

    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            db.close();
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

async function getConversationIndexRows(filter = {}) {
    const db = openMessageStoreDb(sqlite3.OPEN_READONLY);
    db.run("PRAGMA busy_timeout = 5000");

    const params = [];
    let whereClause = "";
    if (filter.q) {
        whereClause = "WHERE handle LIKE ? OR text LIKE ?";
        const q = `%${filter.q}%`;
        params.push(q, q);
    }

    const query = `
        WITH ranked AS (
            SELECT
                handle,
                text,
                source,
                timestamp,
                path,
                ROW_NUMBER() OVER (PARTITION BY handle ORDER BY timestamp DESC) AS rn,
                MIN(timestamp) OVER (PARTITION BY handle) AS first_timestamp,
                COUNT(*) OVER (PARTITION BY handle) AS total_count
            FROM unified_messages
            ${whereClause ? `${whereClause} AND ${CONVERSATION_SOURCE_SQL}` : `WHERE ${CONVERSATION_SOURCE_SQL}`}
        )
        SELECT
            handle,
            text,
            source,
            timestamp,
            path,
            first_timestamp,
            total_count
        FROM ranked
        WHERE rn = 1
        ORDER BY timestamp DESC
    `;

    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            db.close();
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

async function getLatestContextForHandles(handles = [], options = {}) {
    const uniqueHandles = Array.from(
        new Set(
            (Array.isArray(handles) ? handles : [])
                .map((h) => String(h || '').trim())
                .filter(Boolean)
        )
    );
    if (!uniqueHandles.length) return null;

    const db = openMessageStoreDb(sqlite3.OPEN_READONLY);
    db.run("PRAGMA busy_timeout = 5000");

    const limit = Math.max(1, Math.min(Number(options.limit) || 100, 500));
    const placeholders = uniqueHandles.map(() => '?').join(', ');
    const query = `
        SELECT handle, text, source, timestamp, path
        FROM unified_messages
        WHERE handle IN (${placeholders})
          AND ${CONVERSATION_SOURCE_SQL}
          AND text IS NOT NULL
          AND TRIM(text) != ''
        ORDER BY timestamp DESC
        LIMIT ?
    `;

    return new Promise((resolve, reject) => {
        db.all(query, [...uniqueHandles, limit], (err, rows) => {
            db.close();
            if (err) return reject(err);
            const candidates = Array.isArray(rows) ? rows : [];
            if (!candidates.length) return resolve(null);

            const likelyInbound = candidates.find((row) => {
                const raw = String(row.text || '').trim();
                if (!raw) return false;
                if (/^\[[^\]]+\]\s*me:\s*/i.test(raw)) return false;
                if (/^\[[^\]]+\]\s*[^:\n]+:\s*/i.test(raw)) return true;
                return true;
            });

            resolve(likelyInbound || candidates[0] || null);
        });
    });
}

async function getMessagesForHandles(handles = [], filter = {}) {
    const uniqueHandles = Array.from(
        new Set(
            (Array.isArray(handles) ? handles : [])
                .map((h) => String(h || "").trim())
                .filter(Boolean)
        )
    );
    if (!uniqueHandles.length) return { rows: [], total: 0 };

    const db = openMessageStoreDb(sqlite3.OPEN_READONLY);
    db.run("PRAGMA busy_timeout = 5000");

    const limit = Math.max(1, Math.min(Number(filter.limit) || 30, 1000));
    const offset = Math.max(0, Number(filter.offset) || 0);
    const order = String(filter.order || "desc").trim().toLowerCase() === "asc" ? "ASC" : "DESC";
    const placeholders = uniqueHandles.map(() => '?').join(', ');

    const countQuery = `
        SELECT COUNT(*) as total
        FROM unified_messages
        WHERE handle IN (${placeholders})
          AND ${CONVERSATION_SOURCE_SQL}
    `;

    const rowsQuery = `
        SELECT id, text, source, handle, timestamp, path, is_from_me
        FROM unified_messages
        WHERE handle IN (${placeholders})
          AND ${CONVERSATION_SOURCE_SQL}
        ORDER BY timestamp ${order}
        LIMIT ?
        OFFSET ?
    `;

    return new Promise((resolve, reject) => {
        db.get(countQuery, uniqueHandles, (countErr, countRow) => {
            if (countErr) {
                db.close();
                return reject(countErr);
            }
            db.all(rowsQuery, [...uniqueHandles, limit, offset], (rowsErr, rows) => {
                db.close();
                if (rowsErr) return reject(rowsErr);
                resolve({
                    rows: Array.isArray(rows) ? rows : [],
                    total: Number(countRow?.total) || 0,
                    order: order.toLowerCase()
                });
            });
        });
    });
}

module.exports = {
    initialize,
    saveMessages,
    getMessages,
    getRecentConversations,
    getConversationIndexRows,
    getLatestContextForHandles,
    getMessagesForHandles
};

initialize();

if (require.main === module) {
    console.log("Unified message store initialized.");
}
