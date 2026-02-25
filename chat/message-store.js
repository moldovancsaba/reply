const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DB_PATH = path.join(__dirname, 'data', 'chat.db');

/**
 * Initialize the unified messages table
 */
function initialize() {
    const db = new sqlite3.Database(DB_PATH);
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
                path TEXT
            )
        `);
    });
    db.close();
}

/**
 * Save a batch of messages to the unified store
 * @param {Array} messages - List of {id, text, source, handle, timestamp, path}
 */
async function saveMessages(messages) {
    if (!messages || messages.length === 0) return;

    const db = new sqlite3.Database(DB_PATH);
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("PRAGMA journal_mode = WAL");
            db.run("PRAGMA busy_timeout = 5000");

            const stmt = db.prepare(`
                INSERT OR REPLACE INTO unified_messages (id, text, source, handle, timestamp, path)
                VALUES (?, ?, ?, ?, ?, ?)
            `);

            db.run("BEGIN TRANSACTION");
            messages.forEach(m => {
                stmt.run(m.id, m.text, m.source, m.handle, m.timestamp, m.path);
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
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
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

module.exports = {
    initialize,
    saveMessages,
    getMessages
};

if (require.main === module) {
    initialize();
    console.log("Unified message store initialized.");
}
