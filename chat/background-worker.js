const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Log Rotation
const LOG_FILE = path.join(__dirname, 'worker.out.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

if (fs.existsSync(LOG_FILE)) {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size > MAX_LOG_SIZE) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.renameSync(LOG_FILE, `${LOG_FILE}.${timestamp}.old`);
        console.log(`Rotated log file: ${LOG_FILE}.${timestamp}.old`);
    }
}

// Redirect stdout/stderr to log file manually if not managed by PM2
// const access = fs.createWriteStream(LOG_FILE, { flags: 'a' });
// process.stdout.write = process.stderr.write = access.write.bind(access);
const { addDocuments } = require('./vector-store.js');
const contactStore = require('./contact-store.js');
const { generateReply, extractKYC } = require('./reply-engine.js');
const { getSnippets } = require('./knowledge.js');
const { sync: syncIMessage } = require('./sync-imessage.js');
const { syncWhatsApp } = require('./sync-whatsapp.js');
const triageEngine = require('./triage-engine.js');

/**
 * Optimized Background Worker (SQLite version)
 * 
 * Responsibilities:
 * 1. Poll Apple Messages (chat.db) for new activity.
 * 2. Vectorize new messages for semantic search.
 * 3. Proactively generate drafts for unanswered messages.
 * 4. Extract KYC information from incoming text.
 */

const PID_FILE = path.join(__dirname, 'data', 'worker.pid');

// Singleton Lock
if (fs.existsSync(PID_FILE)) {
    try {
        const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
        // Check if process actually exists
        try {
            process.kill(pid, 0);
            console.error(`Worker already running (PID ${pid}). Exiting.`);
            process.exit(0);
        } catch (e) {
            // Process doesn't exist
            console.log("Found stale lock file. Taking over.");
        }
    } catch (e) {
        console.log("Invalid lock file. Taking over.");
    }
}

// Write current PID
fs.writeFileSync(PID_FILE, process.pid.toString());

// Cleanup on exit
process.on('exit', () => {
    try { fs.unlinkSync(PID_FILE); } catch (e) { }
});
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());

const os = require('os');
const POLL_INTERVAL_MS = 60000; // Check every 60 seconds (1 minute)
const MESSAGE_LOOKBACK_SECONDS = 310;
const CHAT_DB_PATH = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');

// Simple bounded cache to prevent memory leaks
const MAX_SEEN_IDS = 1000;
let seenIds = new Set();
let isProcessing = false;

async function poll() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        // 1. Sync Messages
        console.log("Running iMessage sync...");
        await syncIMessage();

        console.log("Running WhatsApp sync...");
        await syncWhatsApp();
    } catch (e) {
        console.error("Sync Error:", e);
    }

    console.log(`[Worker] Polling chat.db at: ${CHAT_DB_PATH}`);
    const db = new sqlite3.Database(CHAT_DB_PATH, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.error("Failed to open chat.db:", err.message);
            isProcessing = false;
            return;
        }
    });

    const query = `
        SELECT 
            m.guid, 
            m.text, 
            h.id as handle, 
            m.is_from_me, 
            datetime(m.date / 1000000000 + 978307200, 'unixepoch', 'localtime') as formatted_date
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.rowid
        WHERE m.text IS NOT NULL 
          AND datetime(m.date / 1000000000 + 978307200, 'unixepoch') > datetime('now', '-${MESSAGE_LOOKBACK_SECONDS} seconds')
        ORDER BY m.date DESC
    `;

    db.all(query, [], async (err, rows) => {
        if (err) {
            console.error("SQL Query Error:", err.message);
            db.close();
            isProcessing = false;
            return;
        }

        try {
            for (const row of rows) {
                const { guid: id, text, handle, is_from_me, formatted_date: date } = row;
                const fromMe = is_from_me === 1;

                if (seenIds.has(id)) continue;

                // Maintain bounded cache
                if (seenIds.size >= MAX_SEEN_IDS) {
                    const it = seenIds.values();
                    seenIds.delete(it.next().value);
                }
                seenIds.add(id);

                console.log(`[Worker] New Message: ${text.substring(0, 50)}...`);

                // 1. Vectorize (Always)
                await addDocuments([{
                    id: `live-${id}`,
                    text: `[${date}] ${fromMe ? 'Me' : handle}: ${text}`,
                    source: 'iMessage-live',
                    path: `imessage://${handle}`
                }]);

                // 2. Track activity
                if (handle) {
                    contactStore.updateLastContacted(handle, date);
                }

                // 3. Intelligence Pipeline (Only if NOT from me)
                if (!fromMe && handle) {
                    await runIntelligencePipeline(handle, text);
                }
            }
        } catch (e) {
            console.error("Worker Core Error:", e);
        } finally {
            db.close();
            isProcessing = false;
        }
    });
}

async function runIntelligencePipeline(handle, text) {
    try {
        const contact = contactStore.findContact(handle);
        if (!contact) return;
        if (contact.status === 'closed') return;

        console.log(`[Worker] Running intelligence for ${contact.displayName}...`);

        // 0. Triage Check
        const triageResult = triageEngine.evaluate(text, handle);
        if (triageResult) {
            console.log(`[Worker] Triage Action: ${triageResult.action} (${triageResult.tag})`);
            // If action is NOT just log, we might want to do more here (e.g., notify)
        }

        // A. KYC Extraction
        const kycInfo = await extractKYC(text);
        if (kycInfo && (kycInfo.profession || kycInfo.relationship || kycInfo.notes)) {
            const isNew =
                (kycInfo.profession && kycInfo.profession !== contact.profession) ||
                (kycInfo.relationship && kycInfo.relationship !== contact.relationship) ||
                (kycInfo.notes && !contact.notes?.some(n => n.text === kycInfo.notes));

            if (isNew) {
                contactStore.setPendingKYC(handle, kycInfo);
                console.log(`[Worker] KYC suggestions staged.`);
            }
        }

        // B. Proactive Drafting
        if (!contact.draft) {
            const snippets = await getSnippets(text, 3);
            const draft = await generateReply(text, snippets, handle);

            if (draft && !draft.startsWith("Error")) {
                contactStore.setDraft(handle, draft);
                console.log(`[Worker] Proactive draft created.`);
            }
        }
    } catch (e) {
        console.error("Intelligence Pipeline Error:", e);
    }
}

console.log("==========================================");
console.log("🚀 REPLY BACKGROUND WORKER ACTIVE (SQLITE)");
console.log(`Interval: ${POLL_INTERVAL_MS / 1000}s`);
console.log("==========================================");

setInterval(poll, POLL_INTERVAL_MS);
poll();
