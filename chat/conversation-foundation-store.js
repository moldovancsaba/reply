"use strict";

const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
const { ensureDataHome, dataPath } = require("./app-paths.js");
const { channelFromDoc, isConversationDataSource, normalizeEmail, normalizePhone, inferChannelFromHandle } = require("./utils/chat-utils.js");

ensureDataHome();

const DB_PATH = dataPath("chat.db");
let readyPromise = null;

function openDb(mode) {
    const db = mode == null ? new sqlite3.Database(DB_PATH) : new sqlite3.Database(DB_PATH, mode);
    try {
        db.configure("busyTimeout", 20000);
    } catch {
        // ignore if unsupported
    }
    db.on("error", (err) => {
        console.error("[conversation-foundation-store] SQLite error:", err.message);
    });
    return db;
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

async function retryBusy(fn, attempts = 40, delayMs = 100) {
    let lastError = null;
    for (let i = 0; i < attempts; i++) {
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

function closeDb(db) {
    return new Promise((resolve, reject) => {
        db.close((err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

async function initialize() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
        const db = openDb();
        try {
            db.run("PRAGMA journal_mode = WAL");
            db.run("PRAGMA busy_timeout = 5000");

            await runDb(db, `
                CREATE TABLE IF NOT EXISTS external_threads (
                    external_thread_id TEXT PRIMARY KEY,
                    channel TEXT NOT NULL,
                    provider_thread_key TEXT,
                    provider_thread_key_normalized TEXT,
                    thread_kind TEXT NOT NULL,
                    first_seen_at TEXT,
                    last_seen_at TEXT,
                    metadata_json TEXT
                )
            `);
            await runDb(db, `CREATE INDEX IF NOT EXISTS idx_external_threads_provider ON external_threads(channel, provider_thread_key_normalized)`);

            await runDb(db, `
                CREATE TABLE IF NOT EXISTS conversation_snapshots (
                    conversation_id TEXT PRIMARY KEY,
                    external_thread_id TEXT,
                    parent_conversation_id TEXT,
                    superseded_by_conversation_id TEXT,
                    channel TEXT NOT NULL,
                    conversation_kind TEXT NOT NULL,
                    membership_fingerprint TEXT NOT NULL,
                    title TEXT,
                    opened_at TEXT,
                    closed_at TEXT,
                    closure_reason TEXT,
                    latest_message_at TEXT,
                    latest_inbound_at TEXT,
                    latest_outbound_at TEXT,
                    latest_message_id TEXT,
                    last_visible_summary TEXT
                )
            `);
            await runDb(db, `CREATE INDEX IF NOT EXISTS idx_conversation_snapshots_external_thread ON conversation_snapshots(external_thread_id, latest_message_at DESC)`);
            await runDb(db, `CREATE INDEX IF NOT EXISTS idx_conversation_snapshots_parent ON conversation_snapshots(parent_conversation_id)`);
            await runDb(db, `CREATE INDEX IF NOT EXISTS idx_conversation_snapshots_membership ON conversation_snapshots(membership_fingerprint)`);

            await runDb(db, `
                CREATE TABLE IF NOT EXISTS conversation_participants (
                    conversation_id TEXT NOT NULL,
                    participant_id TEXT NOT NULL,
                    contact_id TEXT,
                    raw_address TEXT,
                    normalized_address TEXT,
                    channel_identity_kind TEXT,
                    is_self INTEGER NOT NULL DEFAULT 0,
                    role TEXT,
                    joined_at TEXT,
                    left_at TEXT,
                    PRIMARY KEY (conversation_id, participant_id)
                )
            `);
            await runDb(db, `CREATE INDEX IF NOT EXISTS idx_conversation_participants_contact ON conversation_participants(contact_id)`);
            await runDb(db, `CREATE INDEX IF NOT EXISTS idx_conversation_participants_norm ON conversation_participants(normalized_address)`);

            await runDb(db, `
                CREATE TABLE IF NOT EXISTS conversation_messages (
                    message_id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    external_thread_id TEXT,
                    provider_message_key TEXT,
                    provider_message_key_normalized TEXT,
                    channel TEXT NOT NULL,
                    source TEXT,
                    handle TEXT,
                    from_participant_id TEXT,
                    direction TEXT NOT NULL,
                    sent_at_utc TEXT,
                    received_at_utc TEXT,
                    sort_timestamp_utc TEXT NOT NULL,
                    content_text TEXT,
                    content_summary TEXT,
                    has_attachments INTEGER NOT NULL DEFAULT 0,
                    metadata_json TEXT
                )
            `);
            await runDb(db, `CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_time ON conversation_messages(conversation_id, sort_timestamp_utc ASC, message_id ASC)`);
            await runDb(db, `CREATE INDEX IF NOT EXISTS idx_conversation_messages_external_thread ON conversation_messages(external_thread_id, sort_timestamp_utc ASC)`);
            await runDb(db, `CREATE INDEX IF NOT EXISTS idx_conversation_messages_provider_key ON conversation_messages(channel, provider_message_key_normalized)`);

            await runDb(db, `
                CREATE TABLE IF NOT EXISTS message_recipients (
                    message_id TEXT NOT NULL,
                    participant_id TEXT NOT NULL,
                    recipient_kind TEXT NOT NULL,
                    raw_address TEXT,
                    normalized_address TEXT,
                    PRIMARY KEY (message_id, participant_id, recipient_kind)
                )
            `);
            await runDb(db, `CREATE INDEX IF NOT EXISTS idx_message_recipients_norm ON message_recipients(normalized_address)`);

            await runDb(db, `
                CREATE TABLE IF NOT EXISTS conversation_channel_capabilities (
                    conversation_id TEXT NOT NULL,
                    channel TEXT NOT NULL,
                    can_reply INTEGER NOT NULL DEFAULT 0,
                    can_start INTEGER NOT NULL DEFAULT 0,
                    has_inbound_proof INTEGER NOT NULL DEFAULT 0,
                    last_inbound_at TEXT,
                    last_outbound_at TEXT,
                    last_inbound_identity TEXT,
                    capability_reason TEXT,
                    PRIMARY KEY (conversation_id, channel)
                )
            `);
            await runDb(db, `CREATE INDEX IF NOT EXISTS idx_conversation_capabilities_reply ON conversation_channel_capabilities(channel, can_reply, can_start)`);
        } finally {
            await closeDb(db);
        }
    })().catch((err) => {
        readyPromise = null;
        throw err;
    });
    return readyPromise;
}

async function getSchemaSummary() {
    await initialize();
    const db = openDb(sqlite3.OPEN_READONLY);
    try {
        const rows = await allDb(db, `
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name IN (
                'external_threads',
                'conversation_snapshots',
                'conversation_participants',
                'conversation_messages',
                'message_recipients',
                'conversation_channel_capabilities'
              )
            ORDER BY name ASC
        `);
        return rows.map((row) => row.name);
    } finally {
        await closeDb(db);
    }
}

function stableId(prefix, value) {
    return `${prefix}:${crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24)}`;
}

function normalizeIdentityForChannel(channel, raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    if (channel === "email") return normalizeEmail(value) || value.toLowerCase();
    if (channel === "whatsapp" || channel === "imessage") return normalizePhone(value) || value;
    return value.toLowerCase();
}

function normalizeHandleKey(value) {
    return String(value || "").trim().toLowerCase();
}

function parseTimestamp(value) {
    const iso = String(value || "").trim();
    if (!iso) return "";
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function safeDateMs(value) {
    const ms = Date.parse(String(value || "").trim());
    return Number.isFinite(ms) ? ms : 0;
}

function safeJsonParse(value, fallback) {
    if (typeof value !== "string" || !value.trim()) return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function uniqueStrings(values = []) {
    return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function normalizeParticipantIdentity(channel, identity) {
    const raw = String(identity || "").trim();
    if (!raw) return "";
    return normalizeIdentityForChannel(channel, raw) || raw.toLowerCase();
}

function channelLabel(channel) {
    const lower = String(channel || "").trim().toLowerCase();
    if (!lower) return "Other";
    return lower === "imessage" ? "iMessage" : lower.charAt(0).toUpperCase() + lower.slice(1);
}

function normalizeFoundationMetadata(row) {
    const base = safeJsonParse(row?.foundation_metadata_json, {}) || {};
    const channel = String(base.channel || channelFromDoc({ path: row?.path, source: row?.source }) || inferChannelFromHandle(row?.handle, "other")).trim().toLowerCase() || "other";
    const participantIdentities = uniqueStrings(base.participantIdentities || []);
    const recipientIdentities = uniqueStrings(base.recipientIdentities || []);
    return {
        channel,
        providerMessageKey: String(base.providerMessageKey || row?.id || "").trim() || null,
        externalThreadKey: String(base.externalThreadKey || "").trim() || null,
        externalThreadKind: String(base.externalThreadKind || "").trim().toLowerCase() || null,
        externalThreadTitle: String(base.externalThreadTitle || "").trim() || null,
        senderIdentity: String(base.senderIdentity || "").trim() || null,
        participantIdentities,
        recipientIdentities,
        metadata: base,
    };
}

function buildFallbackParticipantIdentities(row, contact, handles, channel) {
    const identities = new Set();
    for (const handle of handles || []) {
        const normalized = normalizeParticipantIdentity(channel, handle);
        if (normalized) identities.add(normalized);
    }
    if (contact?.handle) {
        const normalized = normalizeParticipantIdentity(channel, contact.handle);
        if (normalized) identities.add(normalized);
    }
    if (row?.handle) {
        const normalized = normalizeParticipantIdentity(channel, row.handle);
        if (normalized) identities.add(normalized);
    }
    return Array.from(identities);
}

function buildGroupTitle(channel, participantIdentities) {
    const labels = uniqueStrings(participantIdentities).slice(0, 3);
    const suffix = participantIdentities.length > 3 ? ` +${participantIdentities.length - 3}` : "";
    return `${channelLabel(channel)} group: ${labels.join(", ")}${suffix}`.trim();
}

async function getConversationRowsForHandles(db, handles) {
    const uniqueHandles = Array.from(new Set((handles || []).map((v) => String(v || "").trim()).filter(Boolean)));
    if (!uniqueHandles.length) return [];
    const placeholders = uniqueHandles.map(() => "?").join(", ");
    return allDb(db, `
        SELECT
            m.id,
            m.text,
            m.source,
            m.handle,
            m.timestamp,
            m.path,
            m.is_from_me,
            md.provider_message_key,
            md.channel AS metadata_channel,
            md.external_thread_key,
            md.external_thread_kind,
            md.external_thread_title,
            md.sender_identity,
            md.participant_identities_json,
            md.recipient_identities_json,
            md.metadata_json AS foundation_metadata_json
        FROM unified_messages m
        LEFT JOIN unified_message_metadata md ON md.message_id = m.id
        WHERE m.handle IN (${placeholders})
        ORDER BY timestamp ASC, id ASC
    `, uniqueHandles);
}

async function getKnownConversationHandles(db, handles = null) {
    const uniqueHandles = Array.isArray(handles)
        ? Array.from(new Set(handles.map((v) => String(v || "").trim()).filter(Boolean)))
        : [];
    if (uniqueHandles.length) {
        const placeholders = uniqueHandles.map(() => "?").join(", ");
        return allDb(db, `
            SELECT DISTINCT handle
            FROM unified_messages
            WHERE handle IN (${placeholders})
        `, uniqueHandles);
    }
    return allDb(db, `
        SELECT DISTINCT handle
        FROM unified_messages
        WHERE handle IS NOT NULL
          AND TRIM(handle) != ''
    `);
}

function chooseSnapshotChannel(channels, latestChannel) {
    const ordered = Array.from(new Set((channels || []).filter(Boolean))).sort();
    if (!ordered.length) return latestChannel || "other";
    if (ordered.length === 1) return ordered[0];
    return latestChannel || ordered[0];
}

function resolveChannelCapabilitiesForConversation(contact, rows) {
    const channelsUsed = new Set();
    const inboundByChannel = new Map();
    const verifiedByChannel = new Map();
    const observedChannelsByIdentity = new Map();

    for (const row of rows) {
        const channel = channelFromDoc({ path: row.path, source: row.source }) || inferChannelFromHandle(row.handle, "other");
        const normalizedIdentity = normalizeIdentityForChannel(channel, row.handle);
        channelsUsed.add(channel);
        if (normalizedIdentity) {
            if (!observedChannelsByIdentity.has(normalizedIdentity)) observedChannelsByIdentity.set(normalizedIdentity, new Set());
            observedChannelsByIdentity.get(normalizedIdentity).add(channel);
        }
        if (!row.is_from_me) {
            inboundByChannel.set(channel, row.timestamp || inboundByChannel.get(channel) || null);
        }
    }

    const verified = contact?.verifiedChannels || {};
    for (const [raw, ts] of Object.entries(verified)) {
        if (!ts) continue;
        const fallbackChannel = inferChannelFromHandle(raw, raw.includes("@") ? "email" : "imessage");
        const normalizedIdentity = normalizeIdentityForChannel(fallbackChannel, raw);
        const observedChannels = Array.from(observedChannelsByIdentity.get(normalizedIdentity) || []);
        const channelsForIdentity = observedChannels.length ? observedChannels : [fallbackChannel];
        for (const channel of channelsForIdentity) {
            if (!verifiedByChannel.has(channel) || String(ts) > String(verifiedByChannel.get(channel))) {
                verifiedByChannel.set(channel, ts);
            }
            channelsUsed.add(channel);
        }
    }

    const knownIdentityChannels = contact?.channels || {};
    for (const [kind, values] of Object.entries(knownIdentityChannels)) {
        if (!Array.isArray(values) || !values.length) continue;
        const channel =
            kind === "email" ? "email" :
            kind === "whatsapp" ? "whatsapp" :
            kind === "linkedin" ? "linkedin" :
            kind === "imessage" ? "imessage" :
            kind === "phone" ? "imessage" :
            null;
        if (channel) channelsUsed.add(channel);
    }

    const channels = Array.from(channelsUsed).sort();
    const capabilities = channels.map((channel) => {
        const inboundAt = inboundByChannel.get(channel) || verifiedByChannel.get(channel) || null;
        const hasInboundProof = Boolean(inboundAt);
        const lastOutbound = rows
            .filter((row) => row.is_from_me && (channelFromDoc({ path: row.path, source: row.source }) || inferChannelFromHandle(row.handle, "other")) === channel)
            .map((row) => row.timestamp)
            .filter(Boolean)
            .sort()
            .at(-1) || null;
        return {
            channel,
            can_reply: hasInboundProof ? 1 : 0,
            can_start: hasInboundProof ? 1 : 0,
            has_inbound_proof: hasInboundProof ? 1 : 0,
            last_inbound_at: inboundAt,
            last_outbound_at: lastOutbound,
            last_inbound_identity: hasInboundProof ? channel : null,
            capability_reason: hasInboundProof ? "inbound_verified_or_observed" : "no_inbound_proof"
        };
    });

    const allowedChannels = capabilities.filter((item) => item.can_reply || item.can_start).map((item) => item.channel);
    return { channels, capabilities, allowedChannels };
}

async function rebuildConversationFoundation(handles = null) {
    await initialize();
    const contactStore = require("./contact-store.js");
    await contactStore.waitUntilReady();
    await contactStore.refreshIfChanged();

    const db = openDb();
    try {
        db.run("PRAGMA busy_timeout = 5000");

        const handleRows = await getKnownConversationHandles(db, handles);
        const grouped = new Map();

        for (const row of handleRows) {
            const handle = String(row?.handle || "").trim();
            if (!handle) continue;
            const contact = contactStore.findContact(handle);
            const canonicalKey = contact?.id ? `contact:${contact.id}` : `handle:${normalizeHandleKey(handle)}`;
            const current = grouped.get(canonicalKey) || {
                canonicalKey,
                contact,
                handles: new Set(),
            };
            current.handles.add(handle);
            if (contact) {
                for (const extra of contactStore.getAllHandles(handle)) {
                    if (extra) current.handles.add(extra);
                }
            }
            grouped.set(canonicalKey, current);
        }

        await runDb(db, "BEGIN TRANSACTION");

        if (Array.isArray(handles) && handles.length) {
            const impactedHandles = new Set();
            const impactedContactIds = new Set();
            const impactedNormalized = new Set();
            for (const raw of handles) {
                const handle = String(raw || "").trim();
                if (!handle) continue;
                impactedHandles.add(handle);
                const contact = contactStore.findContact(handle);
                const aliases = contactStore.getAllHandles(handle);
                for (const alias of aliases) {
                    if (alias) impactedHandles.add(String(alias).trim());
                }
                if (contact?.id) impactedContactIds.add(contact.id);
                const channel = inferChannelFromHandle(handle, handle.includes("@") ? "email" : "imessage");
                const normalized = normalizeParticipantIdentity(channel, handle);
                if (normalized) impactedNormalized.add(normalized);
                for (const alias of aliases) {
                    const aliasChannel = inferChannelFromHandle(alias, alias.includes("@") ? "email" : channel);
                    const aliasNormalized = normalizeParticipantIdentity(aliasChannel, alias);
                    if (aliasNormalized) impactedNormalized.add(aliasNormalized);
                }
            }
            const impactedHandleList = Array.from(impactedHandles);
            const conversationIds = new Set();
            if (impactedHandleList.length) {
                const handlePlaceholders = impactedHandleList.map(() => "?").join(", ");
                const messageRows = await allDb(db, `
                    SELECT DISTINCT conversation_id
                    FROM conversation_messages
                    WHERE handle IN (${handlePlaceholders})
                `, impactedHandleList);
                for (const row of messageRows) {
                    if (row?.conversation_id) conversationIds.add(String(row.conversation_id));
                }
            }
            if (impactedNormalized.size || impactedContactIds.size) {
                const normalizedList = Array.from(impactedNormalized);
                const contactIdList = Array.from(impactedContactIds);
                const predicates = [];
                const params = [];
                if (normalizedList.length) {
                    predicates.push(`normalized_address IN (${normalizedList.map(() => "?").join(", ")})`);
                    params.push(...normalizedList);
                }
                if (contactIdList.length) {
                    predicates.push(`contact_id IN (${contactIdList.map(() => "?").join(", ")})`);
                    params.push(...contactIdList);
                }
                const participantRows = await allDb(db, `
                    SELECT DISTINCT conversation_id
                    FROM conversation_participants
                    WHERE ${predicates.join(" OR ")}
                `, params);
                for (const row of participantRows) {
                    if (row?.conversation_id) conversationIds.add(String(row.conversation_id));
                }
            }
            for (const conversationId of conversationIds) {
                await runDb(db, "DELETE FROM conversation_channel_capabilities WHERE conversation_id = ?", [conversationId]);
                await runDb(db, "DELETE FROM message_recipients WHERE message_id IN (SELECT message_id FROM conversation_messages WHERE conversation_id = ?)", [conversationId]);
                await runDb(db, "DELETE FROM conversation_messages WHERE conversation_id = ?", [conversationId]);
                await runDb(db, "DELETE FROM conversation_participants WHERE conversation_id = ?", [conversationId]);
                await runDb(db, "DELETE FROM conversation_snapshots WHERE conversation_id = ?", [conversationId]);
            }
        } else {
            await runDb(db, "DELETE FROM conversation_channel_capabilities");
            await runDb(db, "DELETE FROM message_recipients");
            await runDb(db, "DELETE FROM conversation_messages");
            await runDb(db, "DELETE FROM conversation_participants");
            await runDb(db, "DELETE FROM conversation_snapshots");
        }

        for (const entry of grouped.values()) {
            const allHandles = Array.from(entry.handles).filter(Boolean);
            const rawRows = await getConversationRowsForHandles(db, allHandles);
            const rows = rawRows.filter((row) => isConversationDataSource({ path: row.path, source: row.source }));
            if (!rows.length) continue;

            const bundles = new Map();
            for (const row of rows) {
                const metadata = normalizeFoundationMetadata(row);
                const channel = metadata.channel;
                const participantIdentities = metadata.participantIdentities.length
                    ? metadata.participantIdentities
                    : buildFallbackParticipantIdentities(row, entry.contact, allHandles, channel);
                const normalizedParticipants = uniqueStrings(participantIdentities.map((identity) => normalizeParticipantIdentity(channel, identity)));
                const membershipSeed = normalizedParticipants.length
                    ? normalizedParticipants.slice().sort().join("|")
                    : entry.canonicalKey;
                const membershipFingerprint = stableId("membership", membershipSeed);
                const isGroupScoped =
                    metadata.externalThreadKind === "group" ||
                    normalizedParticipants.length > 1;
                const threadRoot = metadata.externalThreadKey && isGroupScoped
                    ? `thread:${channel}:${metadata.externalThreadKey}`
                    : `direct:${entry.canonicalKey}:${channel}`;
                const bundleKey = `${threadRoot}:${membershipFingerprint}`;
                const current = bundles.get(bundleKey) || {
                    rows: [],
                    channel,
                    threadRoot,
                    externalThreadKey: isGroupScoped ? metadata.externalThreadKey : null,
                    externalThreadKind: isGroupScoped ? metadata.externalThreadKind : null,
                    externalThreadTitle: metadata.externalThreadTitle,
                    membershipFingerprint,
                    participantIdentities: new Set(),
                    recipientIdentities: new Set(),
                    latestChannel: channel,
                };
                current.rows.push({ ...row, foundationMetadata: metadata });
                normalizedParticipants.forEach((identity) => current.participantIdentities.add(identity));
                metadata.recipientIdentities.forEach((identity) => {
                    const normalized = normalizeParticipantIdentity(channel, identity);
                    if (normalized) current.recipientIdentities.add(normalized);
                });
                if (!current.externalThreadTitle && metadata.externalThreadTitle) {
                    current.externalThreadTitle = metadata.externalThreadTitle;
                }
                bundles.set(bundleKey, current);
            }

            for (const bundle of bundles.values()) {
                const bundleRows = bundle.rows.sort((a, b) => safeDateMs(a.timestamp) - safeDateMs(b.timestamp) || String(a.id).localeCompare(String(b.id)));
                if (!bundleRows.length) continue;
                const latestRow = bundleRows[bundleRows.length - 1];
                const channelsUsed = Array.from(new Set(bundleRows.map((row) => row.foundationMetadata.channel).filter(Boolean)));
                const conversationId = stableId("conversation", `${bundle.threadRoot}:${bundle.membershipFingerprint}`);
                const externalThreadId = bundle.externalThreadKey
                    ? stableId("extthread", `${bundle.channel}:${bundle.externalThreadKey}`)
                    : null;
                const participantIdentities = Array.from(bundle.participantIdentities).sort();
                const participantIdentitySet = new Set(participantIdentities);
                const participantRows = [];
                const participantIdByIdentity = new Map();
                const selfParticipantId = stableId("participant", `${conversationId}:self`);
                participantIdByIdentity.set("self", selfParticipantId);
                participantRows.push({
                    participantId: selfParticipantId,
                    contactId: null,
                    rawAddress: "self",
                    normalizedAddress: "self",
                    kind: "self",
                    isSelf: 1,
                    role: "self",
                });

                for (const identity of participantIdentities) {
                    const participantId = stableId("participant", `${conversationId}:${identity}`);
                    participantIdByIdentity.set(identity, participantId);
                    const contact = contactStore.findContact(identity);
                    participantRows.push({
                        participantId,
                        contactId: contact?.id || entry.contact?.id || null,
                        rawAddress: identity,
                        normalizedAddress: identity,
                        kind: bundle.channel,
                        isSelf: 0,
                        role: "participant",
                    });
                }

                const conversationKind = participantIdentities.length > 1 || bundle.externalThreadKind === "group" ? "group" : "direct";
                const title =
                    bundle.externalThreadTitle ||
                    (conversationKind === "group"
                        ? buildGroupTitle(bundle.channel, participantIdentities)
                        : (entry.contact?.displayName || entry.contact?.presentationDisplayName || latestRow.handle || participantIdentities[0] || allHandles[0]));
                const firstSeenAt = parseTimestamp(bundleRows[0].timestamp);
                const latestMessageAt = parseTimestamp(latestRow.timestamp);
                const latestInboundAt = parseTimestamp(bundleRows.filter((row) => !row.is_from_me).map((row) => row.timestamp).filter(Boolean).sort().at(-1));
                const latestOutboundAt = parseTimestamp(bundleRows.filter((row) => row.is_from_me).map((row) => row.timestamp).filter(Boolean).sort().at(-1));
                const { channels, capabilities } = resolveChannelCapabilitiesForConversation(entry.contact, bundleRows);

                if (externalThreadId) {
                    await runDb(db, `
                        INSERT OR REPLACE INTO external_threads (
                            external_thread_id, channel, provider_thread_key, provider_thread_key_normalized, thread_kind, first_seen_at, last_seen_at, metadata_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        externalThreadId,
                        bundle.channel,
                        bundle.externalThreadKey,
                        String(bundle.externalThreadKey || "").toLowerCase(),
                        conversationKind,
                        firstSeenAt || latestMessageAt,
                        latestMessageAt || null,
                        JSON.stringify({ title }),
                    ]);
                }

                await runDb(db, `
                    INSERT OR REPLACE INTO conversation_snapshots (
                        conversation_id,
                        external_thread_id,
                        parent_conversation_id,
                        superseded_by_conversation_id,
                        channel,
                        conversation_kind,
                        membership_fingerprint,
                        title,
                        opened_at,
                        closed_at,
                        closure_reason,
                        latest_message_at,
                        latest_inbound_at,
                        latest_outbound_at,
                        latest_message_id,
                        last_visible_summary
                    ) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
                `, [
                    conversationId,
                    externalThreadId,
                    chooseSnapshotChannel(channels, bundle.latestChannel),
                    conversationKind,
                    bundle.membershipFingerprint,
                    String(title || ""),
                    firstSeenAt || latestMessageAt,
                    latestMessageAt || null,
                    latestInboundAt || null,
                    latestOutboundAt || null,
                    String(latestRow.id || ""),
                    String(latestRow.text || "").trim(),
                ]);

                for (const participant of participantRows) {
                    await runDb(db, `
                        INSERT OR REPLACE INTO conversation_participants (
                            conversation_id, participant_id, contact_id, raw_address, normalized_address, channel_identity_kind, is_self, role, joined_at, left_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                    `, [
                        conversationId,
                        participant.participantId,
                        participant.contactId,
                        participant.rawAddress,
                        participant.normalizedAddress,
                        participant.kind,
                        participant.isSelf,
                        participant.role,
                        firstSeenAt || latestMessageAt,
                    ]);
                }

                for (const row of bundleRows) {
                    const ts = parseTimestamp(row.timestamp);
                    const metadata = row.foundationMetadata;
                    const channel = metadata.channel;
                    const direction = row.is_from_me ? "outbound" : "inbound";
                    const senderIdentity = row.is_from_me
                        ? "self"
                        : normalizeParticipantIdentity(channel, metadata.senderIdentity || row.handle || participantIdentities[0] || "");
                    const fromParticipantId = participantIdByIdentity.get(senderIdentity) || selfParticipantId;
                    const messageId = String(row.id || stableId("message", `${conversationId}:${row.handle}:${row.timestamp}:${row.text}`));
                    await runDb(db, `
                        INSERT OR REPLACE INTO conversation_messages (
                            message_id, conversation_id, external_thread_id, provider_message_key, provider_message_key_normalized, channel, source, handle, from_participant_id, direction, sent_at_utc, received_at_utc, sort_timestamp_utc, content_text, content_summary, has_attachments, metadata_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        messageId,
                        conversationId,
                        externalThreadId,
                        metadata.providerMessageKey || messageId,
                        String(metadata.providerMessageKey || messageId).toLowerCase(),
                        channel,
                        String(row.source || ""),
                        String(row.handle || ""),
                        fromParticipantId,
                        direction,
                        direction === "outbound" ? ts : null,
                        direction === "inbound" ? ts : null,
                        ts || latestMessageAt,
                        String(row.text || ""),
                        String(row.text || "").trim(),
                        String(row.text || "").includes("[ATTACHMENTS:") ? 1 : 0,
                        JSON.stringify(metadata.metadata || {}),
                    ]);

                    const recipientIdentities = row.is_from_me
                        ? uniqueStrings(metadata.recipientIdentities.length ? metadata.recipientIdentities : participantIdentities)
                        : ["self"];
                    for (const recipientIdentityRaw of recipientIdentities) {
                        const recipientIdentity = recipientIdentityRaw === "self"
                            ? "self"
                            : normalizeParticipantIdentity(channel, recipientIdentityRaw);
                        if (!recipientIdentity) continue;
                        const recipientParticipantId = participantIdByIdentity.get(recipientIdentity) || selfParticipantId;
                        await runDb(db, `
                            INSERT OR REPLACE INTO message_recipients (
                                message_id, participant_id, recipient_kind, raw_address, normalized_address
                            ) VALUES (?, ?, 'to', ?, ?)
                        `, [
                            messageId,
                            recipientParticipantId,
                            recipientIdentityRaw,
                            recipientIdentity,
                        ]);
                    }
                }

                for (const capability of capabilities) {
                    const canReply = Number(capability.can_reply) === 1 ? 1 : 0;
                    await runDb(db, `
                        INSERT OR REPLACE INTO conversation_channel_capabilities (
                            conversation_id, channel, can_reply, can_start, has_inbound_proof, last_inbound_at, last_outbound_at, last_inbound_identity, capability_reason
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        conversationId,
                        capability.channel,
                        canReply,
                        canReply,
                        capability.has_inbound_proof,
                        capability.last_inbound_at,
                        capability.last_outbound_at,
                        capability.last_inbound_identity,
                        capability.capability_reason,
                    ]);
                }
            }
        }

        await runDb(db, "COMMIT");
    } catch (err) {
        try { await runDb(db, "ROLLBACK"); } catch { /* ignore */ }
        throw err;
    } finally {
        await closeDb(db);
    }
}

async function getConversationSummaryByHandle(handle) {
    await initialize();
    const contactStore = require("./contact-store.js");
    await contactStore.waitUntilReady();
    await contactStore.refreshIfChanged();

    const normalizedCandidates = new Set();
    const aliases = contactStore.getAllHandles(handle);
    for (const alias of aliases) {
        const channel = inferChannelFromHandle(alias, alias.includes("@") ? "email" : "imessage");
        const normalized = normalizeParticipantIdentity(channel, alias);
        if (normalized) normalizedCandidates.add(normalized);
    }
    const directNormalized = normalizeHandleKey(handle);
    if (directNormalized) normalizedCandidates.add(directNormalized);
    if (!normalizedCandidates.size) return null;

    const db = openDb(sqlite3.OPEN_READONLY);
    try {
        const placeholders = Array.from(normalizedCandidates).map(() => "?").join(", ");
        const snapshotRows = await allDb(db, `
            SELECT DISTINCT
                cs.conversation_id,
                cs.external_thread_id,
                cs.channel,
                cs.conversation_kind,
                cs.membership_fingerprint,
                cs.title,
                cs.latest_message_at
            FROM conversation_snapshots cs
            JOIN conversation_participants cp
              ON cp.conversation_id = cs.conversation_id
            WHERE cp.normalized_address IN (${placeholders})
               OR cp.contact_id = ?
            ORDER BY cs.latest_message_at DESC, cs.conversation_id DESC
        `, [...normalizedCandidates, contactStore.findContact(handle)?.id || null]);
        const primary = snapshotRows[0] || null;
        if (!primary) return null;
        const logicalKey = primary.external_thread_id
            ? `external:${String(primary.external_thread_id)}:${String(primary.membership_fingerprint || "")}`
            : `direct:${String(primary.channel || "").trim().toLowerCase()}:${String(primary.membership_fingerprint || "")}`;
        const groupedRows = snapshotRows.filter((row) => {
            const rowKey = row.external_thread_id
                ? `external:${String(row.external_thread_id)}:${String(row.membership_fingerprint || "")}`
                : `direct:${String(row.channel || "").trim().toLowerCase()}:${String(row.membership_fingerprint || "")}`;
            return rowKey === logicalKey;
        });
        const conversationIds = groupedRows
            .map((row) => String(row.conversation_id || "").trim())
            .filter(Boolean);
        const caps = conversationIds.length
            ? await allDb(db, `
                SELECT channel, can_reply, can_start, has_inbound_proof
                FROM conversation_channel_capabilities
                WHERE conversation_id IN (${conversationIds.map(() => "?").join(", ")})
                ORDER BY channel ASC
            `, conversationIds)
            : [];
        const channels = Array.from(new Set(
            caps.map((row) => String(row.channel || "").trim().toLowerCase()).filter(Boolean)
        ));
        const allowedChannels = Array.from(new Set(
            caps
                .filter((row) => Number(row.can_reply) === 1 || Number(row.can_start) === 1)
                .map((row) => String(row.channel || "").trim().toLowerCase())
                .filter(Boolean)
        ));
        return {
            conversationId: String(primary.conversation_id || ""),
            conversationIds,
            conversationKind: String(primary.conversation_kind || "").trim().toLowerCase() || "direct",
            conversationTitle: String(primary.title || "").trim() || null,
            defaultChannel: String(primary.channel || "").trim().toLowerCase() || null,
            channels,
            allowedChannels,
        };
    } finally {
        await closeDb(db);
    }
}

async function getConversationSummariesByHandles(handles = []) {
    await initialize();
    const contactStore = require("./contact-store.js");
    await contactStore.waitUntilReady();
    await contactStore.refreshIfChanged();

    const handleList = Array.from(new Set((handles || []).map((v) => String(v || "").trim()).filter(Boolean)));
    if (!handleList.length) return new Map();
    const out = new Map();
    for (const handle of handleList) {
        const summary = await getConversationSummaryByHandle(handle);
        if (summary) out.set(handle, summary);
    }
    return out;
}

async function getConversationMessagesByHandle(handle, filter = {}) {
    await initialize();
    const contactStore = require("./contact-store.js");
    await contactStore.waitUntilReady();
    await contactStore.refreshIfChanged();

    const summary = await getConversationSummaryByHandle(handle);
    if (!summary?.conversationId) {
        return {
            conversationId: null,
            rows: [],
            total: 0,
            channels: [],
            allowedChannels: [],
            defaultChannel: null,
        };
    }
    const conversationId = summary.conversationId;
    const conversationIds = Array.isArray(summary.conversationIds) && summary.conversationIds.length
        ? summary.conversationIds
        : [conversationId];
    const db = openDb(sqlite3.OPEN_READONLY);
    try {
        const limit = Math.max(1, Math.min(Number(filter.limit) || 30, 1000));
        const offset = Math.max(0, Number(filter.offset) || 0);
        const order = String(filter.order || "desc").trim().toLowerCase() === "asc" ? "ASC" : "DESC";
        const placeholders = conversationIds.map(() => "?").join(", ");
        const totalRow = await allDb(db, `
            SELECT COUNT(*) AS total
            FROM conversation_messages
            WHERE conversation_id IN (${placeholders})
        `, conversationIds);
        const rows = await allDb(db, `
            SELECT
                message_id AS id,
                CASE WHEN direction = 'outbound' THEN 'me' ELSE 'contact' END AS role,
                CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END AS is_from_me,
                content_text AS text,
                sort_timestamp_utc AS date,
                cm.channel,
                source,
                handle,
                cp.raw_address AS sender_raw_address,
                cp.normalized_address AS sender_normalized_address,
                cp.contact_id AS sender_contact_id
            FROM conversation_messages cm
            LEFT JOIN conversation_participants cp
              ON cp.conversation_id = cm.conversation_id
             AND cp.participant_id = cm.from_participant_id
            WHERE cm.conversation_id IN (${placeholders})
            ORDER BY sort_timestamp_utc ${order}, id ${order}
            LIMIT ?
            OFFSET ?
        `, [...conversationIds, limit, offset]);
        const enrichedRows = rows.map((row) => {
            const senderContact = row.sender_contact_id ? contactStore.findById(row.sender_contact_id) : null;
            const senderDisplay =
                senderContact?.displayName ||
                senderContact?.presentationDisplayName ||
                String(row.sender_raw_address || "").trim() ||
                String(row.handle || "").trim() ||
                null;
            return {
                ...row,
                sender_display: senderDisplay,
            };
        });
        return {
            conversationId,
            conversationKind: summary.conversationKind || "direct",
            conversationTitle: summary.conversationTitle || null,
            rows: enrichedRows,
            total: Number(totalRow?.[0]?.total) || 0,
            channels: summary.channels || [],
            allowedChannels: summary.allowedChannels || [],
            defaultChannel: summary.defaultChannel || null,
        };
    } finally {
        await closeDb(db);
    }
}

module.exports = {
    initialize,
    waitUntilReady: initialize,
    getSchemaSummary,
    rebuildConversationFoundation,
    getConversationSummaryByHandle,
    getConversationSummariesByHandles,
    getConversationMessagesByHandle,
};
