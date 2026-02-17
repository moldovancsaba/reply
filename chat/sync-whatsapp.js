const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { addDocuments } = require('./vector-store.js');

const statusManager = require('./status-manager.js');
const { withDefaults, readSettings } = require('./settings-store.js');

const WA_DB_PATH = path.join(process.env.HOME, 'Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite');
const STATE_FILE = path.join(__dirname, 'data', 'whatsapp_sync_state.json');

// Ensure data dir exists
if (!fs.existsSync(path.dirname(STATE_FILE))) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
}

function updateStatus(status) {
    statusManager.update('whatsapp', status);
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
    const state = loadState();

    console.log(`Starting WhatsApp sync from date > ${state.lastDate}...`);
    updateStatus({ state: "running", message: "Reading WhatsApp database..." });

    const settings = withDefaults(readSettings());
    const batchLimit = Math.max(1, Math.min(Number(settings?.worker?.quantities?.whatsapp) || 500, 2000));

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
        LIMIT ${batchLimit}
    `;

    return new Promise((resolve, reject) => {
        db.all(query, [state.lastDate], async (err, rows) => {
            if (err) {
                console.error("WhatsApp Sync Error:", err);
                updateStatus({ state: "error", message: err.message });
                db.close();
                return reject(err);
            }

            if (rows.length === 0) {
                console.log("WhatsApp up to date.");

                // Don't set 'processed' - server reads from database
                updateStatus({
                    state: "idle",
                    lastSync: new Date().toISOString(),
                    message: "No new messages"
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
                await addDocuments(docs.map(({ _meta, ...d }) => d));

                // Update contact last contacted?
                // The contact-store expects a handle it can match. WhatsApp handles are phone numbers.
                // If we want to merge identities, we need logic for that. For now, we update strictly by handle.
                const contactStore = require('./contact-store.js');
                docs.forEach(d => {
                    const handle = d._meta?.handle || d.path.replace('whatsapp://', '');
                    const formattedDate = d._meta?.formattedDate || null;
                    if (handle && handle !== 'unknown' && formattedDate) {
                        contactStore.updateLastContacted(handle, formattedDate, { channel: 'whatsapp' });

                        const pushName = (d._meta?.pushName || '').trim();
                        if (pushName) {
                            const existing = contactStore.findContact(handle);
                            const existingName = (existing?.displayName || '').trim();
                            const looksAuto = !existingName || existingName === handle || /^\d+$/.test(existingName);
                            if (looksAuto) {
                                contactStore.updateContact(handle, { displayName: pushName });
                            }
                        }
                    }
                });

                const lastRow = rows[rows.length - 1];
                const maxDate = lastRow.ZMESSAGEDATE;
                saveState(maxDate);

                console.log(`WhatsApp Sync complete. Last Date: ${maxDate}`);

                // Don't set 'processed' - server reads from database
                updateStatus({
                    state: "idle",
                    lastSync: new Date().toISOString()
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
