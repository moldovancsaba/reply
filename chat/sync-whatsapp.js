const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { addDocuments } = require('./vector-store.js');

const statusManager = require('./status-manager.js');
const { withDefaults, readSettings } = require('./settings-store.js');

const WA_DB_PATH = process.env.REPLY_WHATSAPP_DB_PATH || path.join(process.env.HOME, 'Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite');
const STATE_FILE = path.join(__dirname, 'data', 'whatsapp_sync_state.json');

// Ensure data dir exists
if (!fs.existsSync(path.dirname(STATE_FILE))) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
}

function updateStatus(status) {
    statusManager.update('whatsapp', status);
}

function readCurrentProcessed() {
    try {
        const cur = statusManager.get('whatsapp') || {};
        const n = Number(cur.processed);
        return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch {
        return 0;
    }
}

function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return { lastDate: 0 };
}

function saveState(lastDate) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastDate, lastSync: new Date().toISOString() }, null, 2));
}

function convertWADate(waTime) {
    // WhatsApp on Mac uses Core Data timestamp (seconds since 2001-01-01 00:00:00 UTC)
    const CORE_DATA_EPOCH_OFFSET = 978307200;
    return new Date((waTime + CORE_DATA_EPOCH_OFFSET) * 1000).toISOString();
}

async function syncWhatsApp() {
    if (!fs.existsSync(WA_DB_PATH)) {
        console.error("WhatsApp database not found at:", WA_DB_PATH);
        updateStatus({ state: "error", message: "Database not found" });
        return;
    }

    const db = new sqlite3.Database(WA_DB_PATH, sqlite3.OPEN_READONLY);
    db.run("PRAGMA busy_timeout = 5000");
    const state = loadState();

    console.log(`Starting WhatsApp sync from date > ${state.lastDate}...`);
    updateStatus({ state: "running", message: "Reading WhatsApp database..." });

    const settings = withDefaults(readSettings());
    const batchLimit = Math.max(1, Math.min(Number(settings?.worker?.quantities?.whatsapp) || 5000, 10000));

    // Query to get messages joined with session info could be complex.
    // simpler to just query ZWAMESSAGE for now and structure JIDs.
    // ZMESSAGEDATE is the sort key.

    const query = `
        SELECT 
            m.Z_PK,
            m.ZTEXT,
            m.ZMESSAGEDATE,
            m.ZISFROMME,
            m.ZFROMJID,
            m.ZTOJID,
            m.ZCHATSESSION,
            m.ZPUSHNAME,
            s.ZCONTACTJID AS ZSESSIONCONTACTJID,
            s.ZPARTNERNAME AS ZSESSIONPARTNERNAME,
            s.ZCONTACTIDENTIFIER AS ZSESSIONCONTACTIDENTIFIER
        FROM ZWAMESSAGE m
        LEFT JOIN ZWACHATSESSION s ON s.Z_PK = m.ZCHATSESSION
        WHERE m.ZMESSAGEDATE > ?
        AND m.ZTEXT IS NOT NULL 
        ORDER BY m.ZMESSAGEDATE ASC
        LIMIT ?
    `;

    return new Promise((resolve, reject) => {
        db.all(query, [state.lastDate, batchLimit], async (err, rows) => {
            if (err) {
                console.error("WhatsApp Sync Error:", err);
                updateStatus({ state: "error", message: err.message });
                db.close();
                return reject(err);
            }

            if (rows.length === 0) {
                console.log("WhatsApp up to date.");

                updateStatus({
                    state: "idle",
                    lastSync: new Date().toISOString(),
                    message: "No new messages",
                    processed: readCurrentProcessed()
                });

                db.close();
                resolve();
                return;
            }

            console.log(`Processing ${rows.length} new WhatsApp messages...`);
            updateStatus({ state: "running", progress: 20, message: `Processing ${rows.length} messages...` });

            const docs = rows.map(row => {
                // Determine handle (JID). If it's from me, handle is TOJID. If from them, handle is FROMJID.
                // JIDs may look like "36205631691@s.whatsapp.net", "1203...@g.us" (group), or "<digits>@lid" (linked device id).
                let jid = row.ZISFROMME ? row.ZTOJID : row.ZFROMJID;

                // If the message references a @lid identity, prefer the chat session's contact JID which points to the real phone JID.
                if (jid && typeof jid === 'string' && jid.endsWith('@lid')) {
                    const sessionJid = row.ZSESSIONCONTACTJID;
                    if (sessionJid && typeof sessionJid === 'string' && sessionJid.includes('@s.whatsapp.net')) {
                        jid = sessionJid;
                    }
                }

                let handle = jid;
                if (handle) {
                    handle = handle.replace('@s.whatsapp.net', '').replace('@g.us', '');
                    handle = handle.split('@')[0];
                } else {
                    handle = 'unknown';
                }

                const formattedDate = convertWADate(row.ZMESSAGEDATE);
                const pushName = (row.ZPUSHNAME || row.ZSESSIONPARTNERNAME || '').trim();

                return {
                    id: `wa-${row.Z_PK}`,
                    text: `[${formattedDate}] ${row.ZISFROMME ? 'Me' : (pushName || handle)}: ${row.ZTEXT}`,
                    source: 'WhatsApp',
                    path: `whatsapp://${handle}`,
                    _meta: {
                        formattedDate,
                        handle,
                        pushName,
                    }
                };
            });

            try {
                updateStatus({ state: "running", progress: 50, message: `Vectorizing ${docs.length} messages...` });

                // 1. Vectorize for search
                await addDocuments(docs.map(({ _meta, ...d }) => d));

                // 2. Save to unified chat.db
                const { saveMessages } = require('./message-store.js');
                const unifiedDocs = docs.map(d => ({
                    id: d.id,
                    text: d.text.split(': ').slice(1).join(': '), // Strip the [Date] Name: prefix if possible or just store text
                    source: 'WhatsApp',
                    handle: d._meta?.handle || d.path.replace('whatsapp://', ''),
                    timestamp: d._meta?.formattedDate,
                    path: d.path
                }));
                await saveMessages(unifiedDocs);

                // Update contact last contacted?
                // Using batch update to prevent SQLITE_BUSY locks
                const contactStore = require('./contact-store.js');
                const contactUpdates = docs.map(d => ({
                    handle: d._meta?.handle || d.path.replace('whatsapp://', ''),
                    timestamp: d._meta?.formattedDate || null,
                    meta: { channel: 'whatsapp' }
                })).filter(u => u.handle && u.handle !== 'unknown' && u.timestamp);

                if (contactUpdates.length > 0) {
                    await contactStore.updateLastContactedBatch(contactUpdates);

                    // Also update pushNames for auto-suggested contacts
                    for (const u of contactUpdates) {
                        const d = docs.find(doc => (doc._meta?.handle || doc.path.replace('whatsapp://', '')) === u.handle);
                        const pushName = (d?._meta?.pushName || '').trim();
                        if (pushName) {
                            const existing = contactStore.findContact(u.handle);
                            const existingName = (existing?.displayName || '').trim();
                            const looksAuto = !existingName || existingName === u.handle || /^\d+$/.test(existingName);
                            if (looksAuto) {
                                await contactStore.updateContact(u.handle, { displayName: pushName });
                            }
                        }
                    }
                }

                const lastRow = rows[rows.length - 1];
                const maxDate = lastRow.ZMESSAGEDATE;
                saveState(maxDate);

                console.log(`WhatsApp Sync complete. Last Date: ${maxDate}`);

                const nextProcessed = readCurrentProcessed() + docs.length;
                updateStatus({
                    state: "idle",
                    lastSync: new Date().toISOString(),
                    processed: nextProcessed
                });

                db.close();
                resolve();
            } catch (syncErr) {
                console.error("Vectorization Error:", syncErr);
                updateStatus({ state: "error", message: syncErr.message });
                db.close();
                reject(syncErr);
            }
        });
    });
}

module.exports = { syncWhatsApp };

if (require.main === module) {
    syncWhatsApp().catch(console.error);
}
