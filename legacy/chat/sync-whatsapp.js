const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { addDocuments } = require('./vector-store.js');
const { enqueueSuggestionDraftsFromDocBatch } = require('./suggestion-draft-queue.js');
const { ensureDataHome, dataPath } = require('./app-paths.js');
ensureDataHome();

const statusManager = require('./status-manager.js');
const { withDefaults, readSettings } = require('./settings-store.js');
const { resolveWhatsAppChatStoragePath } = require('./utils/whatsapp-db-path.js');

const WA_DB_PATH = resolveWhatsAppChatStoragePath();
const STATE_FILE = dataPath('whatsapp_sync_state.json');

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
        const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        return {
            lastDate: Number(parsed?.lastDate) || 0,
            lastPk: Number(parsed?.lastPk) || 0
        };
    }
    return { lastDate: 0, lastPk: 0 };
}

function saveState(next) {
    const state = {
        lastDate: Number(next?.lastDate) || 0,
        lastPk: Number(next?.lastPk) || 0,
        lastSync: new Date().toISOString()
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    return state;
}

function convertWADate(waTime) {
    // WhatsApp on Mac uses Core Data timestamp (seconds since 2001-01-01 00:00:00 UTC)
    const CORE_DATA_EPOCH_OFFSET = 978307200;
    return new Date((waTime + CORE_DATA_EPOCH_OFFSET) * 1000).toISOString();
}

function buildWhatsAppBody(row) {
    const text = String(row?.ZTEXT || '').trim();
    if (text) {
        return text;
    }
    if (row?.ZMEDIAITEM != null) {
        return "[Media attachment]";
    }
    return "";
}

function normalizeWhatsAppIdentity(value) {
    return String(value || "")
        .replace('@s.whatsapp.net', '')
        .replace('@g.us', '')
        .split('@')[0]
        .trim();
}

async function syncWhatsApp() {
    if (!WA_DB_PATH || !fs.existsSync(WA_DB_PATH)) {
        console.error("WhatsApp database not found at:", WA_DB_PATH || "(no path)");
        updateStatus({ state: "error", message: "Database not found" });
        return;
    }

    const db = new sqlite3.Database(WA_DB_PATH, sqlite3.OPEN_READONLY);
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA synchronous = NORMAL");
    const state = loadState();

    console.log(`Starting WhatsApp sync from PK > ${state.lastPk || 0}...`);
    updateStatus({ state: "running", message: "Reading WhatsApp database..." });

    const settings = withDefaults(readSettings());
    const batchLimit = Math.max(1, Math.min(Number(settings?.worker?.quantities?.whatsapp) || 5000, 10000));

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
        WHERE m.Z_PK > ?
        AND (
            (m.ZTEXT IS NOT NULL AND TRIM(m.ZTEXT) != '') OR
            m.ZMEDIAITEM IS NOT NULL
        )
        ORDER BY m.Z_PK ASC
        LIMIT ?
    `;

    return new Promise((resolve, reject) => {
        db.all(query, [state.lastPk || 0, batchLimit], async (err, rows) => {
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
                const body = buildWhatsAppBody(row);
                const sessionIdentity = normalizeWhatsAppIdentity(row.ZSESSIONCONTACTJID || row.ZSESSIONCONTACTIDENTIFIER || jid || handle);
                const isGroup = String(jid || row.ZSESSIONCONTACTJID || '').includes('@g.us');

                return {
                    id: `wa-${row.Z_PK}`,
                    text: `[${formattedDate}] ${row.ZISFROMME ? 'Me' : (pushName || handle)}: ${body}`,
                    source: 'WhatsApp',
                    path: `whatsapp://${handle}`,
                    _meta: {
                        formattedDate,
                        handle,
                        pushName,
                        body,
                        sessionIdentity,
                        isGroup,
                    }
                };
            });

            try {
                updateStatus({ state: "running", progress: 50, message: `Vectorizing ${docs.length} messages...` });

                // 1. Vectorize for search
                const vectorDocs = docs.map(({ _meta, ...d }) => d);
                await addDocuments(vectorDocs);
                enqueueSuggestionDraftsFromDocBatch(vectorDocs);

                // 2. Save to unified chat.db
                const { saveMessages } = require('./message-store.js');
                const unifiedDocs = docs.map(d => ({
                    id: d.id,
                    text: d._meta?.body || d.text.split(': ').slice(1).join(': '),
                    source: 'WhatsApp',
                    handle: d._meta?.handle || d.path.replace('whatsapp://', ''),
                    timestamp: d._meta?.formattedDate,
                    path: d.path,
                    is_from_me: String(d.text || '').includes('] Me:') ? 1 : 0,
                    metadata: {
                        providerMessageKey: d.id,
                        channel: 'whatsapp',
                        externalThreadKey: d._meta?.sessionIdentity || d._meta?.handle || null,
                        externalThreadKind: d._meta?.isGroup ? 'group' : 'direct',
                        externalThreadTitle: d._meta?.pushName || null,
                        senderIdentity: d._meta?.handle || null,
                        participantIdentities: d._meta?.handle ? [d._meta.handle] : [],
                        recipientIdentities: d._meta?.handle ? [d._meta.handle] : [],
                    }
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

                    // 4. Mark inbound channels verified
                    for (const r of rows) {
                        if (!r.ZISFROMME) {
                            let jid = r.ZFROMJID;
                            if (jid && typeof jid === 'string' && jid.endsWith('@lid')) {
                                const sessionJid = r.ZSESSIONCONTACTJID;
                                if (sessionJid && typeof sessionJid === 'string' && sessionJid.includes('@s.whatsapp.net')) {
                                    jid = sessionJid;
                                }
                            }
                            if (jid) {
                                const handle = jid.replace('@s.whatsapp.net', '').replace('@g.us', '').split('@')[0];
                                const date = convertWADate(r.ZMESSAGEDATE);
                                await contactStore.markChannelInboundVerified(handle, handle, date);
                            }
                        }
                    }

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
                saveState({
                    lastDate: lastRow.ZMESSAGEDATE,
                    lastPk: lastRow.Z_PK
                });

                console.log(`WhatsApp Sync complete. Last PK: ${lastRow.Z_PK}`);

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
