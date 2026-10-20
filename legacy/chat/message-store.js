const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { ensureDataHome, dataPath } = require('./app-paths.js');
const {
    channelFromDoc,
    hasUsableConversationHandle,
    isConversationDataSource,
} = require('./utils/chat-utils.js');

ensureDataHome();
const DB_PATH = dataPath('chat.db');
const SQLITE_BUSY_RETRY_ATTEMPTS = 80;
const SQLITE_BUSY_RETRY_DELAY_MS = 250;
const SQLITE_BUSY_TIMEOUT_MS = 20000;
let conversationIndexReadyPromise = null;
let storeReadyPromise = null;
let messageWriteQueue = Promise.resolve();
let maintenanceQueue = Promise.resolve();

function openMessageStoreDb(mode) {
    const db =
        mode === undefined
            ? new sqlite3.Database(DB_PATH)
            : new sqlite3.Database(DB_PATH, mode);
    try {
        db.configure("busyTimeout", SQLITE_BUSY_TIMEOUT_MS);
    } catch {
        // ignore if unsupported
    }
    db.on('error', (err) => {
        console.error('[message-store] SQLite error:', err.message);
    });
    return db;
}

function closeMessageStoreDb(db, cb) {
    if (typeof cb === "function") {
        db.close((err) => cb(err));
        return;
    }
    return new Promise((resolve, reject) => {
        db.close((err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function safeJsonStringify(value) {
    if (value == null) return null;
    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
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

const CONVERSATION_INDEX_SORT_MAP = {
    newest: { column: "latest_timestamp_ms", direction: "DESC" },
    oldest: { column: "first_timestamp_ms", direction: "ASC" },
    freq: { column: "sort_freq", direction: "DESC" },
    volume_in: { column: "message_count_in", direction: "DESC" },
    volume_out: { column: "message_count_out", direction: "DESC" },
    volume_total: { column: "message_count_total", direction: "DESC" },
    recommendation: { column: "sort_recommendation", direction: "DESC" },
};

function normalizeConversationSort(sort) {
    const key = String(sort || "newest").trim().toLowerCase();
    return CONVERSATION_INDEX_SORT_MAP[key] ? key : "newest";
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

function getDb(db, sql, params = []) {
    return retryBusy(() => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    }));
}

async function retryBusy(fn, attempts = SQLITE_BUSY_RETRY_ATTEMPTS, delayMs = SQLITE_BUSY_RETRY_DELAY_MS) {
    let lastError = null;
    for (let i = 0; i < attempts; i += 1) {
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

function safeTimestampMs(value) {
    const ms = Date.parse(String(value || ""));
    return Number.isFinite(ms) ? ms : 0;
}

function enqueueMessageWrite(task) {
    const run = messageWriteQueue.then(() => task());
    messageWriteQueue = run.catch(() => null);
    return run;
}

function enqueueMaintenance(task) {
    const run = maintenanceQueue.then(() => task());
    maintenanceQueue = run.catch(() => null);
    return run;
}

function normalizeConversationHandle(value) {
    return String(value || "").trim().toLowerCase();
}

function computeConversationSorts(row) {
    const latest = Number(row?.latest_timestamp_ms) || 0;
    const first = Number(row?.first_timestamp_ms) || latest || 0;
    const total = Number(row?.message_count_total) || 0;
    const ageDays = Math.max(1, (Date.now() - latest) / 86400000);
    const spanDays = Math.max(1, (latest - first) / 86400000);
    const freq = total / spanDays;
    const recency = 1 / ageDays;
    const recommendation = (0.45 * recency) + (0.35 * Math.log1p(freq)) + (0.2 * Math.log1p(total));
    return {
        sort_freq: freq,
        sort_recommendation: recommendation
    };
}

async function rebuildConversationIndex(handles = null) {
    const contactStore = require("./contact-store.js");
    await contactStore.waitUntilReady();
    await contactStore.refreshIfChanged();

    const db = openMessageStoreDb();
    try {
        db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

        const rawHandles = Array.isArray(handles) ? handles : [];
        const expandedHandles = [];
        for (const raw of rawHandles) {
            const handle = String(raw || "").trim();
            if (!handle) continue;
            const aliases = contactStore.getAllHandles(handle);
            if (Array.isArray(aliases) && aliases.length) {
                expandedHandles.push(...aliases);
            } else {
                expandedHandles.push(handle);
            }
        }
        const uniqueHandles = Array.from(new Set(
            expandedHandles.map((h) => String(h || "").trim()).filter(Boolean)
        ));
        const handleFilterSql = uniqueHandles.length
            ? ` AND handle IN (${uniqueHandles.map(() => '?').join(', ')})`
            : "";
        const aggregateRows = await allDb(db, `
            SELECT
                handle,
                MIN(path) AS path,
                MIN(source) AS source,
                MIN(timestamp) AS first_timestamp,
                MAX(timestamp) AS latest_timestamp,
                SUM(CASE WHEN is_from_me = 1 THEN 1 ELSE 0 END) AS message_count_out,
                SUM(CASE WHEN is_from_me = 1 THEN 0 ELSE 1 END) AS message_count_in,
                COUNT(*) AS message_count_total
            FROM unified_messages
            WHERE ${CONVERSATION_SOURCE_SQL}
            ${handleFilterSql}
            GROUP BY handle
        `, uniqueHandles);

        const latestRows = await allDb(db, `
            WITH ranked AS (
                SELECT
                    handle,
                    text,
                    source,
                    path,
                    timestamp,
                    ROW_NUMBER() OVER (PARTITION BY handle ORDER BY timestamp DESC, id DESC) AS rn
                FROM unified_messages
                WHERE ${CONVERSATION_SOURCE_SQL}
                ${handleFilterSql}
            )
            SELECT handle, text, source, path, timestamp
            FROM ranked
            WHERE rn = 1
        `, uniqueHandles);

        const latestByHandle = new Map(
            latestRows.map((row) => [String(row.handle || "").trim(), row])
        );

        const groupedRows = new Map();
        for (const row of aggregateRows) {
            const handle = String(row.handle || "").trim();
            if (!handle) continue;
            const latestRow = latestByHandle.get(handle) || row;
            const latestTimestamp = String(latestRow.timestamp || row.latest_timestamp || "");
            const firstTimestamp = String(row.first_timestamp || latestTimestamp || "");
            const latestMs = safeTimestampMs(latestTimestamp);
            const firstMs = safeTimestampMs(firstTimestamp) || latestMs;
            const preview = String(latestRow.text || "").trim() || "No recent messages";
            const counts = {
                message_count_total: Number(row.message_count_total) || 0,
                message_count_in: Number(row.message_count_in) || 0,
                message_count_out: Number(row.message_count_out) || 0,
            };
            const contact = contactStore.findContact(handle);
            const canonicalKey = contact?.id
                ? `contact:${contact.id}`
                : `handle:${normalizeConversationHandle(handle)}`;
            const current = groupedRows.get(canonicalKey);
            if (!current) {
                groupedRows.set(canonicalKey, {
                    canonicalKey,
                    handle,
                    path: String(latestRow.path || row.path || ""),
                    source: String(latestRow.source || row.source || ""),
                    preview,
                    latestTimestamp,
                    latestMs,
                    firstTimestamp,
                    firstMs,
                    counts,
                });
                continue;
            }

            current.counts.message_count_total += counts.message_count_total;
            current.counts.message_count_in += counts.message_count_in;
            current.counts.message_count_out += counts.message_count_out;
            if (!current.firstMs || (firstMs && firstMs < current.firstMs)) {
                current.firstMs = firstMs;
                current.firstTimestamp = firstTimestamp;
            }
            if (!current.latestMs || latestMs > current.latestMs) {
                current.handle = handle;
                current.path = String(latestRow.path || row.path || "");
                current.source = String(latestRow.source || row.source || "");
                current.preview = preview;
                current.latestTimestamp = latestTimestamp;
                current.latestMs = latestMs;
            }
        }

        await runDb(db, "BEGIN TRANSACTION");
        if (uniqueHandles.length) {
            const keysToDelete = Array.from(new Set(
                uniqueHandles.map((handle) => {
                    const contact = contactStore.findContact(handle);
                    return contact?.id
                        ? `contact:${contact.id}`
                        : `handle:${normalizeConversationHandle(handle)}`;
                }).filter(Boolean)
            ));
            const handlePlaceholders = uniqueHandles.map(() => '?').join(', ');
            const keyPlaceholders = keysToDelete.map(() => '?').join(', ');
            await runDb(
                db,
                `
                DELETE FROM conversation_index
                WHERE handle IN (${handlePlaceholders})
                   OR canonical_key IN (${keyPlaceholders})
                `,
                [...uniqueHandles, ...keysToDelete]
            );
        } else {
            await runDb(db, "DELETE FROM conversation_index");
        }

        const insertStmt = db.prepare(`
            INSERT OR REPLACE INTO conversation_index (
                canonical_key,
                handle,
                path,
                source,
                preview,
                latest_timestamp,
                latest_timestamp_ms,
                first_timestamp,
                first_timestamp_ms,
                message_count_total,
                message_count_in,
                message_count_out,
                sort_freq,
                sort_recommendation
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        await new Promise((resolve, reject) => {
            const rows = Array.from(groupedRows.values());
            if (!rows.length) {
                insertStmt.finalize((err) => {
                    if (err) return reject(err);
                    resolve();
                });
                return;
            }
            let pending = rows.length;
            let failed = false;
            const finish = (err) => {
                if (failed) return;
                if (err) {
                    failed = true;
                    insertStmt.finalize(() => reject(err));
                    return;
                }
                pending -= 1;
                if (pending === 0) {
                    insertStmt.finalize((finalizeErr) => {
                        if (finalizeErr) return reject(finalizeErr);
                        resolve();
                    });
                }
            };
            for (const row of rows) {
                const sorts = computeConversationSorts({
                    latest_timestamp_ms: row.latestMs,
                    first_timestamp_ms: row.firstMs,
                    message_count_total: row.counts.message_count_total,
                });
                insertStmt.run(
                    row.canonicalKey,
                    row.handle,
                    row.path,
                    row.source,
                    row.preview,
                    row.latestTimestamp || null,
                    row.latestMs,
                    row.firstTimestamp || null,
                    row.firstMs,
                    row.counts.message_count_total,
                    row.counts.message_count_in,
                    row.counts.message_count_out,
                    sorts.sort_freq,
                    sorts.sort_recommendation,
                    finish,
                );
            }
        });
        await runDb(db, "COMMIT");
    } catch (err) {
        try { await runDb(db, "ROLLBACK"); } catch { }
        throw err;
    } finally {
        await closeMessageStoreDb(db);
    }
}

async function ensureConversationIndexReady() {
    if (!conversationIndexReadyPromise) {
        conversationIndexReadyPromise = (async () => {
            const db = openMessageStoreDb(sqlite3.OPEN_READONLY);
            try {
                db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
                const row = await getDb(db, `
                    SELECT
                        COUNT(*) AS total_count,
                        SUM(CASE WHEN canonical_key IS NULL OR TRIM(canonical_key) = '' THEN 1 ELSE 0 END) AS blank_keys,
                        COUNT(DISTINCT handle) AS distinct_handles
                    FROM conversation_index
                `);
                const totalCount = Number(row?.total_count) || 0;
                const blankKeys = Number(row?.blank_keys) || 0;
                const distinctHandles = Number(row?.distinct_handles) || 0;
                const duplicateHandles = totalCount > distinctHandles;
                if (totalCount === 0 || blankKeys > 0 || duplicateHandles) {
                    await rebuildConversationIndex();
                }
            } finally {
                await closeMessageStoreDb(db);
            }
        })().catch((err) => {
            conversationIndexReadyPromise = null;
            throw err;
        });
    }
    return conversationIndexReadyPromise;
}

/**
 * Initialize the unified messages table
 */
function initialize() {
    if (storeReadyPromise) return storeReadyPromise;
    const db = openMessageStoreDb();
    storeReadyPromise = new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
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
            db.run(`
                CREATE TABLE IF NOT EXISTS unified_message_metadata (
                    message_id TEXT PRIMARY KEY,
                    provider_message_key TEXT,
                    channel TEXT,
                    external_thread_key TEXT,
                    external_thread_kind TEXT,
                    external_thread_title TEXT,
                    sender_identity TEXT,
                    participant_identities_json TEXT,
                    recipient_identities_json TEXT,
                    metadata_json TEXT
                )
            `);
            db.run(`
                CREATE TABLE IF NOT EXISTS conversation_index (
                    canonical_key TEXT PRIMARY KEY,
                    handle TEXT,
                    path TEXT,
                    source TEXT,
                    preview TEXT,
                    latest_timestamp TEXT,
                    latest_timestamp_ms INTEGER,
                    first_timestamp TEXT,
                    first_timestamp_ms INTEGER,
                    message_count_total INTEGER,
                    message_count_in INTEGER,
                    message_count_out INTEGER,
                    sort_freq REAL,
                    sort_recommendation REAL
                )
            `);
            db.run(`CREATE INDEX IF NOT EXISTS idx_conversation_index_latest ON conversation_index(latest_timestamp_ms DESC)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_conversation_index_oldest ON conversation_index(first_timestamp_ms ASC)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_unified_messages_handle_timestamp ON unified_messages(handle, timestamp DESC)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_unified_messages_timestamp ON unified_messages(timestamp DESC)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_unified_message_metadata_thread ON unified_message_metadata(channel, external_thread_key)`);
            db.all("PRAGMA table_info(conversation_index)", (convErr, convRows) => {
                if (convErr) {
                    closeMessageStoreDb(db, () => reject(convErr));
                    return;
                }
                const convCols = new Set((convRows || []).map((r) => String(r.name || "").toLowerCase()));
                const ensureUnifiedSchema = () => db.all("PRAGMA table_info(unified_messages)", (err, rows) => {
                    if (err) {
                        closeMessageStoreDb(db, () => reject(err));
                        return;
                    }
                    const cols = new Set((rows || []).map((r) => String(r.name || "").toLowerCase()));
                    if (!cols.has("is_from_me")) {
                        db.run(`ALTER TABLE unified_messages ADD COLUMN is_from_me INTEGER`, (alterErr) => {
                            closeMessageStoreDb(db, () => {
                            if (alterErr) return reject(alterErr);
                            resolve();
                            });
                        });
                        return;
                    }
                    closeMessageStoreDb(db, (closeErr) => {
                        if (closeErr) return reject(closeErr);
                        resolve();
                    });
                });

                if (!convCols.has("canonical_key")) {
                    db.serialize(() => {
                        db.run("DROP TABLE IF EXISTS conversation_index");
                        db.run(`
                            CREATE TABLE conversation_index (
                                canonical_key TEXT PRIMARY KEY,
                                handle TEXT,
                                path TEXT,
                                source TEXT,
                                preview TEXT,
                                latest_timestamp TEXT,
                                latest_timestamp_ms INTEGER,
                                first_timestamp TEXT,
                                first_timestamp_ms INTEGER,
                                message_count_total INTEGER,
                                message_count_in INTEGER,
                                message_count_out INTEGER,
                                sort_freq REAL,
                                sort_recommendation REAL
                            )
                        `);
                        db.run(`CREATE INDEX IF NOT EXISTS idx_conversation_index_latest ON conversation_index(latest_timestamp_ms DESC)`);
                        db.run(`CREATE INDEX IF NOT EXISTS idx_conversation_index_oldest ON conversation_index(first_timestamp_ms ASC)`);
                        ensureUnifiedSchema();
                    });
                    return;
                }
                ensureUnifiedSchema();
            });
        });
    });
    return storeReadyPromise;
}

/**
 * Run the read-model and runtime side effects that follow a durable unified-message write.
 * This is intentionally split from the SQLite insert path so some callers can defer the
 * heavier rebuild work without skipping it entirely.
 * @param {Array} messages - List of unified message rows
 */
async function runPostSaveMaintenance(messages) {
    await rebuildConversationIndex(messages.map((m) => m.handle));
    try {
        const conversationFoundationStore = require("./conversation-foundation-store.js");
        await conversationFoundationStore.rebuildConversationFoundation(messages.map((m) => m.handle));
    } catch (err) {
        console.warn("[message-store] failed to rebuild canonical conversation foundation:", err.message);
    }
    try {
        const preparedContextStore = require("./prepared-context-store.js");
        await preparedContextStore.rebuildDraftContextSnapshots(messages.map((m) => m.handle));
    } catch (err) {
        console.warn("[message-store] failed to rebuild draft context snapshots:", err.message);
    }
    try {
        await emitRuntimeMemoryEventsForMessages(messages);
    } catch (err) {
        console.warn("[message-store] failed to emit Trinity memory events:", err.message);
    }
}

/**
 * Save a batch of messages to the unified store
 * @param {Array} messages - List of {id, text, source, handle, timestamp, path, is_from_me, metadata}
 * @param {{ deferMaintenance?: boolean }} [options]
 */
async function saveMessages(messages, options = {}) {
    if (!messages || messages.length === 0) return;
    await initialize();

    await enqueueMessageWrite(() => retryBusy(() => {
        const db = openMessageStoreDb();
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO unified_messages (id, text, source, handle, timestamp, path, is_from_me)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `);
                const metadataStmt = db.prepare(`
                    INSERT OR REPLACE INTO unified_message_metadata (
                        message_id,
                        provider_message_key,
                        channel,
                        external_thread_key,
                        external_thread_kind,
                        external_thread_title,
                        sender_identity,
                        participant_identities_json,
                        recipient_identities_json,
                        metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                db.run("BEGIN TRANSACTION");
                const operations = [];
                messages.forEach((m) => {
                    operations.push((done) => {
                        stmt.run(
                            m.id,
                            m.text,
                            m.source,
                            m.handle,
                            m.timestamp,
                            m.path,
                            m.is_from_me == null ? null : (m.is_from_me ? 1 : 0),
                            done,
                        );
                    });
                    if (m.metadata && typeof m.metadata === "object") {
                        operations.push((done) => {
                            metadataStmt.run(
                                m.id,
                                m.metadata.providerMessageKey || null,
                                m.metadata.channel || null,
                                m.metadata.externalThreadKey || null,
                                m.metadata.externalThreadKind || null,
                                m.metadata.externalThreadTitle || null,
                                m.metadata.senderIdentity || null,
                                safeJsonStringify(m.metadata.participantIdentities || []),
                                safeJsonStringify(m.metadata.recipientIdentities || []),
                                safeJsonStringify(m.metadata),
                                done,
                            );
                        });
                    }
                });

                let index = 0;
                const rollbackAndClose = (err) => {
                    db.run("ROLLBACK", () => {
                        stmt.finalize(() => {
                            metadataStmt.finalize(() => {
                                db.close(() => reject(err));
                            });
                        });
                    });
                };
                const commitAndClose = () => {
                    db.run("COMMIT", (err) => {
                        stmt.finalize(() => {
                            metadataStmt.finalize(() => {
                                if (err) {
                                    db.close(() => reject(err));
                                    return;
                                }
                                db.close((closeErr) => {
                                    if (closeErr) return reject(closeErr);
                                    resolve();
                                });
                            });
                        });
                    });
                };
                const runNext = () => {
                    if (index >= operations.length) {
                        commitAndClose();
                        return;
                    }
                    const operation = operations[index++];
                    operation((err) => {
                        if (err) {
                            rollbackAndClose(err);
                            return;
                        }
                        runNext();
                    });
                };
                runNext();
            });
        });
    }));

    if (options.deferMaintenance) {
        setImmediate(() => {
            enqueueMaintenance(() => runPostSaveMaintenance(messages)).catch((err) => {
                console.warn("[message-store] deferred post-save maintenance failed:", err.message);
            });
        });
        return;
    }
    await enqueueMaintenance(() => runPostSaveMaintenance(messages));
}

async function emitRuntimeMemoryEventsForMessages(messages) {
    const normalized = buildRuntimeMemoryEventsForMessages(messages);
    if (!normalized.length) return;
    const trinityEventOutbox = require("./trinity-event-outbox.js");
    const { buildMemoryEvent, drainTrinityEventOutbox } = require("./brain-runtime.js");
    for (const event of normalized) {
        await trinityEventOutbox.enqueueEvent("memory_event", buildMemoryEvent(event));
    }
    if (!trinityOutboxDrainEnabled()) return;
    drainTrinityEventOutbox(Math.max(10, normalized.length)).catch((err) => {
        console.warn("[message-store] Trinity outbox drain failed:", err.message);
    });
}

function buildRuntimeMemoryEventsForMessages(messages) {
    const companyId = resolveReplyRuntimeCompanyId();
    const nowIso = new Date().toISOString();
    return (Array.isArray(messages) ? messages : [])
        .filter((message) => isConversationMessageRow(message))
        .filter((message) => hasUsableConversationHandle(message?.handle, {
            channel: channelFromDoc(message),
            source: message?.source || "",
        }))
        .map((message) => {
            const channel = channelFromDoc(message);
            const handle = String(message.handle || "").trim();
            const sourceRef = String(message.id || "").trim()
                ? `message:${String(message.id).trim()}`
                : `message:${channel}:${handle}:${String(message.timestamp || nowIso).trim()}`;
            return {
                company_id: companyId,
                event_kind: message.is_from_me ? "outbound_message_recorded" : "inbound_message_recorded",
                source_ref: sourceRef,
                occurred_at: normalizeIsoTimestamp(message.timestamp, nowIso),
                thread_ref: buildThreadRef(handle, channel),
                channel,
                contact_handle: handle,
                content_text: message.text == null ? null : String(message.text),
                metadata: {
                    message_id: String(message.id || "").trim() || null,
                    source: String(message.source || "").trim() || null,
                    path: String(message.path || "").trim() || null,
                    provider_message_key: message?.metadata?.providerMessageKey || null,
                    external_thread_key: message?.metadata?.externalThreadKey || null,
                    external_thread_kind: message?.metadata?.externalThreadKind || null,
                },
            };
        });
}

function normalizeIsoTimestamp(value, fallbackIso) {
    const raw = String(value || "").trim();
    if (!raw) return fallbackIso;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return fallbackIso;
    return parsed.toISOString();
}

function buildThreadRef(handle, channel) {
    return `reply:${String(channel || "other").trim().toLowerCase()}:${String(handle || "unknown").trim()}`;
}

function resolveReplyRuntimeCompanyId() {
    const explicit = String(process.env.REPLY_RUNTIME_COMPANY_ID || "").trim();
    if (explicit) return explicit;
    return uuidFromStableText("reply.local.runtime");
}

function trinityOutboxDrainEnabled() {
    const raw = String(process.env.REPLY_DISABLE_TRINITY_OUTBOX_DRAIN || "").trim().toLowerCase();
    return !(raw === "1" || raw === "true" || raw === "yes");
}

function uuidFromStableText(text) {
    const crypto = require("crypto");
    const hash = crypto.createHash("sha1").update(String(text || "")).digest("hex");
    const chars = hash.slice(0, 32).split("");
    chars[12] = "5";
    chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
    return [
        chars.slice(0, 8).join(""),
        chars.slice(8, 12).join(""),
        chars.slice(12, 16).join(""),
        chars.slice(16, 20).join(""),
        chars.slice(20, 32).join(""),
    ].join("-");
}

/**
 * Query messages from the unified store
 * @param {Object} filter - {source, handle, limit, offset}
 */
async function getMessages(filter = {}) {
    await initialize();
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
    await initialize();
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
    await initialize();
    await ensureConversationIndexReady();

    const db = openMessageStoreDb(sqlite3.OPEN_READONLY);
    db.run("PRAGMA busy_timeout = 5000");

    const sort = normalizeConversationSort(filter.sort);
    const sortSpec = CONVERSATION_INDEX_SORT_MAP[sort];
    const params = [];
    const where = [];
    if (filter.q) {
        const q = `%${String(filter.q).trim()}%`;
        where.push("(handle LIKE ? OR preview LIKE ? OR source LIKE ?)");
        params.push(q, q, q);
    }
    const query = `
        SELECT
            handle,
            preview AS text,
            source,
            latest_timestamp AS timestamp,
            path,
            first_timestamp,
            message_count_total AS total_count,
            message_count_in,
            message_count_out,
            latest_timestamp_ms,
            first_timestamp_ms,
            sort_freq,
            sort_recommendation
        FROM conversation_index
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY ${sortSpec.column} ${sortSpec.direction}, handle ASC
    `;

    return allDb(db, query, params).finally(() => db.close());
}

async function getConversationIndexStats() {
    await initialize();
    await ensureConversationIndexReady();

    const db = openMessageStoreDb(sqlite3.OPEN_READONLY);
    db.run("PRAGMA busy_timeout = 5000");

    const totalRow = await getDb(
        db,
        `SELECT COUNT(*) AS total FROM conversation_index`
    );
    const channelRows = await allDb(
        db,
        `
        SELECT
            CASE
                WHEN LOWER(COALESCE(path, '')) LIKE 'linkedin://%' THEN 'linkedin'
                WHEN LOWER(COALESCE(path, '')) LIKE 'mailto:%' OR LOWER(COALESCE(path, '')) LIKE 'email://%' THEN 'email'
                WHEN LOWER(COALESCE(path, '')) LIKE 'whatsapp://%' THEN 'whatsapp'
                WHEN LOWER(COALESCE(path, '')) LIKE 'imessage://%' THEN 'imessage'
                WHEN LOWER(COALESCE(path, '')) LIKE 'telegram://%' THEN 'telegram'
                WHEN LOWER(COALESCE(path, '')) LIKE 'discord://%' THEN 'discord'
                WHEN LOWER(COALESCE(path, '')) LIKE 'signal://%' THEN 'signal'
                WHEN LOWER(COALESCE(path, '')) LIKE 'viber://%' THEN 'viber'
                ELSE LOWER(COALESCE(source, ''))
            END AS channel,
            COUNT(*) AS total
        FROM conversation_index
        GROUP BY 1
        `
    ).finally(() => db.close());

    const byChannel = {};
    for (const row of channelRows) {
        const key = String(row?.channel || "").trim().toLowerCase();
        if (!key) continue;
        byChannel[key] = Number(row?.total) || 0;
    }
    return {
        total: Number(totalRow?.total) || 0,
        byChannel,
    };
}

async function getLatestContextForHandles(handles = [], options = {}) {
    await initialize();
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
    await initialize();
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

async function getMessagesForHandlesSince(handles = [], filter = {}) {
    await initialize();
    const uniqueHandles = Array.from(
        new Set(
            (Array.isArray(handles) ? handles : [])
                .map((h) => String(h || "").trim())
                .filter(Boolean)
        )
    );
    if (!uniqueHandles.length) return { rows: [], order: "asc" };

    const db = openMessageStoreDb(sqlite3.OPEN_READONLY);
    db.run("PRAGMA busy_timeout = 5000");

    const limit = Math.max(1, Math.min(Number(filter.limit) || 100, 1000));
    const afterTimestampMs = Math.max(0, Number(filter.afterTimestampMs) || 0);
    const afterIso = afterTimestampMs ? new Date(afterTimestampMs).toISOString() : null;
    const placeholders = uniqueHandles.map(() => '?').join(', ');
    const clauses = [
        `handle IN (${placeholders})`,
        CONVERSATION_SOURCE_SQL,
    ];
    const params = [...uniqueHandles];
    if (afterIso) {
        clauses.push("timestamp > ?");
        params.push(afterIso);
    }
    params.push(limit);

    const rowsQuery = `
        SELECT id, text, source, handle, timestamp, path, is_from_me
        FROM unified_messages
        WHERE ${clauses.join("\n          AND ")}
        ORDER BY timestamp ASC
        LIMIT ?
    `;

    return new Promise((resolve, reject) => {
        db.all(rowsQuery, params, (rowsErr, rows) => {
            db.close();
            if (rowsErr) return reject(rowsErr);
            resolve({
                rows: Array.isArray(rows) ? rows : [],
                order: "asc",
            });
        });
    });
}

async function messageExists(messageId) {
    const id = String(messageId || "").trim();
    if (!id) return false;
    await initialize();
    const db = openMessageStoreDb(sqlite3.OPEN_READONLY);
    try {
        db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
        const row = await getDb(db, "SELECT 1 AS found FROM unified_messages WHERE id = ? LIMIT 1", [id]);
        return Boolean(row?.found);
    } finally {
        await closeMessageStoreDb(db).catch(() => null);
    }
}

module.exports = {
    initialize,
    saveMessages,
    messageExists,
    buildRuntimeMemoryEventsForMessages,
    getMessages,
    getRecentConversations,
    getConversationIndexRows,
    getConversationIndexStats,
    getLatestContextForHandles,
    getMessagesForHandles,
    getMessagesForHandlesSince,
    rebuildConversationIndex,
    ensureConversationIndexReady,
    waitUntilReady: initialize
};

initialize();

if (require.main === module) {
    console.log("Unified message store initialized.");
}
