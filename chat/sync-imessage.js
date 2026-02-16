const { addDocuments } = require('./vector-store.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'chat.db');
const STATE_FILE = path.join(__dirname, 'data', 'sync_state.json');

// Ensure DB exists
if (!fs.existsSync(DB_PATH)) {
    console.error("Database not found. Please copy chat.db to chat/data/");
    process.exit(1);
}

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

/**
 * Load sync state to resume from last message.
 */
function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return { lastProcessedId: 0 };
}

function saveState(lastId) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastProcessedId: lastId, lastSync: new Date().toISOString() }, null, 2));
}

function convertDate(value) {
    if (!value) return null;
    let seconds = value;
    if (value > 100000000000000) seconds = value / 1000000000;
    const UNIX_EPOCH_OFFSET = 978307200;
    return new Date((seconds + UNIX_EPOCH_OFFSET) * 1000).toISOString();
}

/**
 * Sync messages in batches.
 */
async function sync() {
    const state = loadState();
    console.log(`Starting iMessage sync from ROWID > ${state.lastProcessedId}...`);

    const query = `
        SELECT 
            message.ROWID, 
            message.text, 
            message.date, 
            message.is_from_me, 
            handle.id as handle_id 
        FROM message 
        LEFT JOIN handle ON message.handle_id = handle.ROWID 
        WHERE message.ROWID > ?
        AND message.text IS NOT NULL 
        AND message.text != ""
        ORDER BY message.ROWID ASC
        LIMIT 1000
    `;

    return new Promise((resolve, reject) => {
        db.all(query, [state.lastProcessedId], async (err, rows) => {
            if (err) return reject(err);
            if (rows.length === 0) {
                console.log("Everything is already in sync!");
                return resolve();
            }

            console.log(`Processing ${rows.length} new messages...`);

            const docs = rows.map(row => ({
                id: `msg-${row.ROWID}`,
                text: `[${convertDate(row.date)}] ${row.is_from_me ? 'Me' : row.handle_id}: ${row.text}`,
                source: 'iMessage',
                path: `imessage://${row.handle_id || 'unknown'}`
            }));

            try {
                await addDocuments(docs);

                // Update LastContacted in the store
                const contactStore = require('./contact-store.js');
                rows.forEach(row => {
                    contactStore.updateLastContacted(row.handle_id, convertDate(row.date));
                });

                const maxId = rows[rows.length - 1].ROWID;
                saveState(maxId);
                console.log(`Sync complete. Last ID: ${maxId}`);
                resolve();
            } catch (syncErr) {
                reject(syncErr);
            }
        });
    });
}

sync().then(() => {
    db.close();
}).catch(err => {
    console.error("Sync failed:", err);
    db.close();
});
