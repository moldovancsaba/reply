const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'chat.db');

// Check if DB exists
if (!fs.existsSync(DB_PATH)) {
    console.error(`Error: Database not found at ${DB_PATH}`);
    // We don't exit here if imported as a module, but requests will fail.
}

let dbInstance = null;
function getDb() {
    if (!dbInstance) {
        if (!fs.existsSync(DB_PATH)) return null;
        dbInstance = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
    }
    return dbInstance;
}

function convertDate(value) {
    if (!value) return null;
    let seconds = value;
    if (value > 100000000000000) { // Nanoseconds
        seconds = value / 1000000000;
    }
    const UNIX_EPOCH_OFFSET = 978307200;
    return new Date((seconds + UNIX_EPOCH_OFFSET) * 1000).toISOString();
}

function fetchRecentMessages(limit = 50) {
    const db = getDb();
    if (!db) return Promise.reject("Database not found");

    return new Promise((resolve, reject) => {
        const query = `
      SELECT 
        message.ROWID, 
        message.text, 
        message.date, 
        message.is_from_me, 
        handle.id as handle_id 
      FROM message 
      LEFT JOIN handle ON message.handle_id = handle.ROWID 
      WHERE message.text IS NOT NULL 
      AND message.text != ''
      ORDER BY message.date DESC 
      LIMIT ?
    `;

        db.all(query, [limit], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => ({
                ...row,
                date: convertDate(row.date)
            })));
        });
    });
}

function fetchConversation(handleId, limit = 20) {
    const db = getDb();
    if (!db) return Promise.reject("Database not found");

    return new Promise((resolve, reject) => {
        const query = `
      SELECT 
        message.text, 
        message.date, 
        message.is_from_me 
      FROM message 
      JOIN handle ON message.handle_id = handle.ROWID 
      WHERE handle.id = ?
      AND message.text IS NOT NULL
      ORDER BY message.date DESC 
      LIMIT ?
    `;

        db.all(query, [handleId, limit], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.reverse().map(row => ({
                role: row.is_from_me ? 'Me' : 'Contact',
                text: row.text,
                date: convertDate(row.date)
            })));
        });
    });
}

function fetchHandles(limit = 10) {
    const db = getDb();
    if (!db) return Promise.reject("Database not found");

    return new Promise((resolve, reject) => {
        const query = `
        SELECT DISTINCT handle.id, COUNT(message.ROWID) as msg_count
        FROM handle
        JOIN message ON message.handle_id = handle.ROWID
        GROUP BY handle.id
        ORDER BY msg_count DESC
        LIMIT ?
        `;
        db.all(query, [limit], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

module.exports = { fetchRecentMessages, fetchConversation, fetchHandles };
