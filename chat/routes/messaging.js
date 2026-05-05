/**
 * {reply} - Messaging Routes
 * Handles conversations, thread retrieval, and sending.
 */

const fs = require("fs");
const path = require("path");
const {
    allowExperimentalBrainModes,
    buildDraftOutcomeFact,
    classifyRuntimeFailure,
    exportDraftTrace,
    generateReply,
    normalizeSuggestionResult,
    readShadowComparisons,
    recordDraftOutcome,
    resolveReplyCompanyId,
    sanitizeDraftContext,
} = require("../brain-runtime");
const {
    safeDateMs,
    pathPrefixesForHandle,
    extractDateFromText,
    channelFromDoc,
    inferChannelFromHandle,
    inferSourceFromChannel,
    pickLatestInboundFromVectorDocs,
    isConversationDataSource,
    buildSearchHaystack,
    matchesQuery
} = require("../utils/chat-utils");
const { presentContactLabel } = require("../utils/contact-labels");

function conversationSearchHaystack(item) {
    const c = item.contact;
    const base = buildSearchHaystack(c, {
        channel: item.channel,
        source: item.source,
        latestHandle: item.latestHandle
    });
    const notes = (c?.notes || []).map((n) => n.text).join(" ");
    const sugs = (c?.pendingSuggestions || []).map((s) => s.content).join(" ");
    const preview = item.lastMessage || "";
    return `${base} ${notes} ${sugs} ${preview}`.toLowerCase();
}

/** Allowed `sort` / `rank` query values for `GET /api/conversations` (reply#15; meta contract tests in reply#31). */
const CONVERSATION_SORT_MODES = new Set([
    "newest",
    "oldest",
    "freq",
    "volume_in",
    "volume_out",
    "volume_total",
    "recommendation"
]);

/** Invalid modes fall back to `newest`; exported for API contract tests. */
function normalizeConversationSort(raw) {
    const s = String(raw || "newest").toLowerCase().trim();
    return CONVERSATION_SORT_MODES.has(s) ? s : "newest";
}

/** Stable list for clients (reply#15); lexicographic order so snapshots stay deterministic. */
const AVAILABLE_CONVERSATION_SORT_MODES = [...CONVERSATION_SORT_MODES].sort();

function normalizeChannelList(values = []) {
    return Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => String(value || "").trim().toLowerCase())
            .filter(Boolean)
    )).sort();
}

function checkConversationCapabilityGate(summary, { channel, conversationId } = {}) {
    const requestedChannel = String(channel || "").trim().toLowerCase();
    if (!requestedChannel) {
        return {
            allowed: false,
            code: "channel_required",
            reason: "Missing outbound channel.",
        };
    }
    if (!summary?.conversationId) {
        return {
            allowed: false,
            code: "conversation_capability_missing",
            reason: "This conversation does not have a canonical capability record yet.",
        };
    }
    const activeConversationIds = Array.isArray(summary.conversationIds)
        ? summary.conversationIds.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
    const requestedConversationId = String(conversationId || "").trim();
    if (requestedConversationId && activeConversationIds.length && !activeConversationIds.includes(requestedConversationId)) {
        return {
            allowed: false,
            code: "conversation_context_stale",
            reason: "The selected conversation is stale. Refresh the thread before sending.",
        };
    }
    const allowedChannels = normalizeChannelList(summary.allowedChannels);
    if (!allowedChannels.includes(requestedChannel)) {
        return {
            allowed: false,
            code: "conversation_channel_not_allowed",
            reason: `This conversation is not allowed to send on ${requestedChannel}.`,
        };
    }
    return {
        allowed: true,
        allowedChannels,
        conversationId: summary.conversationId,
    };
}

async function ensureConversationCapabilityGate(handle, channel, conversationId) {
    const summary = await conversationFoundationStore.getConversationSummaryByHandle(handle);
    return checkConversationCapabilityGate(summary, { channel, conversationId });
}

function applyConversationSort(items, mode, nowMs) {
    const tie = (a, b) =>
        String(a.displayName || a.handle || "").localeCompare(String(b.displayName || b.handle || ""));
    const safeTime = (x) => x.sortTime || 0;
    const firstT = (x) => (x.firstTimestamp != null ? x.firstTimestamp : safeTime(x));
    const volIn = (x) => x.countIn || 0;
    const volOut = (x) => x.countOut || 0;
    const vol = (x) => x.count || 0;

    if (mode === "newest") {
        items.sort((a, b) => safeTime(b) - safeTime(a) || tie(a, b));
        return;
    }
    if (mode === "oldest") {
        items.sort((a, b) => firstT(a) - firstT(b) || tie(a, b));
        return;
    }
    if (mode === "volume_in") {
        items.sort((a, b) => volIn(b) - volIn(a) || tie(a, b));
        return;
    }
    if (mode === "volume_out") {
        items.sort((a, b) => volOut(b) - volOut(a) || tie(a, b));
        return;
    }
    if (mode === "volume_total") {
        items.sort((a, b) => vol(b) - vol(a) || tie(a, b));
        return;
    }
    if (mode === "freq") {
        for (const it of items) {
            const spanDays = Math.max(1, (nowMs - firstT(it)) / 86400000);
            it._freq = vol(it) / spanDays;
        }
        items.sort((a, b) => (b._freq || 0) - (a._freq || 0) || tie(a, b));
        return;
    }
    if (mode === "recommendation") {
        const freqVals = items.map((it) => {
            const spanDays = Math.max(1, (nowMs - firstT(it)) / 86400000);
            return vol(it) / spanDays;
        });
        const recencyVals = items.map((x) => safeTime(x));
        const volVals = items.map((x) => Math.log(1 + vol(x)));
        const norm = (vals) => {
            const min = Math.min(...vals);
            const max = Math.max(...vals);
            const sp = max - min || 1;
            return vals.map((v) => (v - min) / sp);
        };
        const recencyN = norm(recencyVals);
        const freqN = norm(freqVals);
        const volN = norm(volVals);
        for (let i = 0; i < items.length; i++) {
            const score = 0.45 * recencyN[i] + 0.35 * freqN[i] + 0.2 * volN[i];
            items[i]._recScore = score;
            items[i]._rankTrace = {
                recency: Math.round(recencyN[i] * 1000) / 1000,
                frequency: Math.round(freqN[i] * 1000) / 1000,
                volume: Math.round(volN[i] * 1000) / 1000,
                score: Math.round(score * 1000) / 1000
            };
        }
        items.sort((a, b) => (b._recScore || 0) - (a._recScore || 0) || tie(a, b));
    }
}

function sanitizeConversationItemForApi(it, sort) {
    const o = { ...it };
    delete o._recScore;
    delete o._freq;
    delete o.contact;
    delete o.key;
    delete o.sortTime;
    delete o.firstTimestamp;
    if (sort !== "recommendation") delete o._rankTrace;
    if (!Array.isArray(o.channels)) o.channels = [];
    if (!Array.isArray(o.allowedChannels)) o.allowedChannels = [];
    return o;
}

function normalizeThreadStoreRows(rows = []) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
        const isFromMe = row.is_from_me == null ? false : Boolean(row.is_from_me);
        const rawDate = row.timestamp || row.date || null;
        return {
            id: row.id || null,
            role: isFromMe ? "me" : "contact",
            is_from_me: isFromMe,
            text: String(row.text || ""),
            date: rawDate ? new Date(rawDate).toISOString() : null,
            channel: row.channel || channelFromDoc({ path: row.path, source: row.source }),
            source: row.source || null,
            path: row.path || null,
            handle: row.handle || null,
            senderDisplay: row.sender_display || null,
        };
    });
}

function resolveConversationTimestamps(row) {
    const fallbackLatest = safeDateMs(row?.timestamp);
    const fallbackFirst = safeDateMs(row?.first_timestamp);
    const embeddedDate = extractDateFromText(String(row?.text || ""));
    const embeddedLatest = embeddedDate ? embeddedDate.getTime() : 0;
    const latestTimestamp = embeddedLatest || fallbackLatest || 0;
    const firstTimestamp = fallbackFirst || latestTimestamp || 0;
    return {
        latestTimestamp,
        firstTimestamp,
        previewDate: latestTimestamp ? new Date(latestTimestamp).toISOString() : null,
    };
}
const { writeJson, readJsonBody, normalizeErrorText, parseJsonSafe } = require("../utils/server-utils");
const {
    applyOpenClawWhatsAppGuard,
    resolveOpenClawBinary,
    buildOpenClawWhatsAppHint,
    resolveWhatsAppSendTransport,
    sendWhatsAppViaOpenClawCli,
    sendWhatsAppViaDesktopAutomation
} = require("../utils/whatsapp-utils");
const contactStore = require("../contact-store");
const { autoAnnotateSentMessage } = require("../utils/annotation-utils");
const { getSnippets } = require("../knowledge");
const { refineReply } = require("../gemini-client");
const { addDocuments } = require("../vector-store");
const { execFile, spawn } = require("child_process");
const { readSettings } = require("../settings-store");
const messageStore = require("../message-store");
const conversationFoundationStore = require("../conversation-foundation-store.js");
const { checkOutboundAllowed, appendOutboundDenial } = require("../utils/outbound-policy.js");
const { maybeBlockOutboundOnPreflight } = require("./system.js");

const CONVERSATION_STATS_TTL_MS = 60 * 1000;
const CONVERSATION_PREVIEW_SAMPLE_ROWS = 200;
const conversationStatsCache = new Map();

// Local cache for conversations index (unsorted rows; sort applied per request)
const conversationsIndexCache = {
    builtAtMs: 0,
    ttlMs: 5 * 1000,
    rawItems: null
};

function isConversationCandidate(row) {
    return isConversationDataSource({
        path: row?.path,
        source: row?.source
    });
}

async function getConversationsIndexFresh(q = "", sortMode = "newest") {
    const sort = normalizeConversationSort(sortMode);
    const nowMs = Date.now();
    const cacheOk =
        !q &&
        sort === "newest" &&
        conversationsIndexCache.rawItems &&
        nowMs - conversationsIndexCache.builtAtMs < conversationsIndexCache.ttlMs;

    let rows;
    if (cacheOk) {
        rows = conversationsIndexCache.rawItems.map((row) => ({ ...row }));
    } else {
        rows = await messageStore.getConversationIndexRows({ sort });
        if (!q && sort === "newest") {
            conversationsIndexCache.rawItems = rows.map((row) => ({ ...row }));
            conversationsIndexCache.builtAtMs = nowMs;
        }
    }

    const contacts = await contactStore.refreshIfChanged();
    let items = rows.map((row) => {
        const handle = String(row.handle || "").trim();
        const contact = contactStore.findContact(handle);
        const path = String(row.path || "");
        const latestChannel =
            path.startsWith("imessage://") ? "imessage" :
            path.startsWith("whatsapp://") ? "whatsapp" :
            path.startsWith("mailto:") ? "email" :
            path.startsWith("linkedin://") ? "linkedin" :
            inferChannelFromHandle(handle);
        const previewDate = row.timestamp ? new Date(row.timestamp).toISOString() : null;
        return {
            key: contact?.id || handle,
            handle,
            latestHandle: handle,
            path,
            sortTime: Number(row.latest_timestamp_ms) || safeDateMs(row.timestamp),
            channel: latestChannel,
            source: row.source || inferSourceFromChannel(latestChannel),
            contact: contact || null,
            displayName: contact?.displayName || "",
            presentationDisplayName: presentContactLabel(contact || {}, { handle, channel: latestChannel }),
            lastMessage: row.text || "No recent messages",
            preview: row.text || "No recent messages",
            previewDate,
            count: Number(row.total_count) || 0,
            countIn: Number(row.message_count_in) || 0,
            countOut: Number(row.message_count_out) || 0,
            firstTimestamp: Number(row.first_timestamp_ms) || safeDateMs(row.first_timestamp) || null,
        };
    }).filter((item) => {
        if (!contactStore.isInboxEligible(item.contact || item.handle)) return false;
        return isConversationCandidate({
            path: item.path || pathPrefixesForHandle(item.latestHandle || item.handle || "")[0],
            source: item.source
        });
    });

    if (q) {
        items = items.filter((item) => matchesQuery(conversationSearchHaystack(item), q));
    }

    const summaryMap = await conversationFoundationStore.getConversationSummariesByHandles(
        items.map((item) => item.handle)
    );
    items = items.map((item) => {
        const summary = summaryMap.get(item.handle);
        if (!summary) {
            return {
                ...item,
                channels: item.channel ? [item.channel] : [],
                allowedChannels: [],
                conversationId: null,
            };
        }
        return {
            ...item,
            conversationId: summary.conversationId,
            channels: Array.isArray(summary.channels) && summary.channels.length ? summary.channels : (item.channel ? [item.channel] : []),
            allowedChannels: summary.allowedChannels || [],
            channel: summary.defaultChannel || item.channel,
        };
    });

    const seenKeys = new Set(items.map((item) => item.key));
    for (const c of contacts) {
        if (!contactStore.isInboxEligible(c)) continue;
        if (seenKeys.has(c.id)) continue;
        if (q && !matchesQuery(conversationSearchHaystack({
            contact: c,
            channel: c.lastChannel || inferChannelFromHandle(c.handle),
            source: inferSourceFromChannel(c.lastChannel || inferChannelFromHandle(c.handle)),
            latestHandle: c.handle,
            lastMessage: ""
        }), q)) continue;
        items.push({
            key: c.id,
            handle: c.handle,
            latestHandle: c.handle,
            path: pathPrefixesForHandle(c.handle)[0] || "",
            sortTime: safeDateMs(c.lastContacted),
            channel: c.lastChannel || inferChannelFromHandle(c.handle),
            source: inferSourceFromChannel(c.lastChannel || inferChannelFromHandle(c.handle)),
            contact: c,
            displayName: c.displayName || "",
            presentationDisplayName: presentContactLabel(c, { handle: c.handle }),
            lastMessage: "No recent messages",
            preview: "No recent messages",
            previewDate: c.lastContacted,
            count: 0,
            countIn: 0,
            countOut: 0,
            firstTimestamp: null,
            conversationId: null,
            channels: c.lastChannel ? [c.lastChannel] : [],
            allowedChannels: []
        });
    }

    return { items, sort };
}



async function serveConversations(req, res, url) {
    const limit = parseInt(url.searchParams.get("limit")) || 20;
    const offset = parseInt(url.searchParams.get("offset")) || 0;
    const q = (url.searchParams.get("q") || url.searchParams.get("query") || "").toString();
    const sortRaw = (url.searchParams.get("sort") || url.searchParams.get("rank") || "newest").toString();

    try {
        const sort = normalizeConversationSort(sortRaw);
        const { items } = await getConversationsIndexFresh(q, sort);
        const page = items
            .slice(offset, offset + limit)
            .map((it) => sanitizeConversationItemForApi(it, sort));

        // `meta` keys are stable API surface (reply#31): sort, sortRequested, sortValid — no legacy `mode`.
        writeJson(res, 200, {
            contacts: page,
            hasMore: items.length > offset + limit,
            total: items.length,
            meta: {
                sort,
                sortRequested: sortRaw,
                sortValid: CONVERSATION_SORT_MODES.has(
                    String(sortRaw || "").toLowerCase().trim()
                ),
                availableSortModes: AVAILABLE_CONVERSATION_SORT_MODES
            }
        });
    } catch (err) {
        console.error("Error loading conversations:", err);
        writeJson(res, 500, { error: "Failed to load conversations" });
    }
}

async function serveThread(req, res, url) {
    const handle = url.searchParams.get("handle");
    const limit = parseInt(url.searchParams.get("limit")) || 20;
    const offset = parseInt(url.searchParams.get("offset")) || 0;
    const orderParam = String(url.searchParams.get("order") || "newest").trim().toLowerCase();
    const storeOrder = orderParam === "oldest" ? "asc" : "desc";

    if (!handle) {
        writeJson(res, 400, { error: "Missing handle" });
        return;
    }
    if (!contactStore.isInboxEligible(handle)) {
        writeJson(res, 404, { error: "Conversation is unavailable in {reply}." });
        return;
    }

    const handles = contactStore.getAllHandles(handle);
    const allHandles = Array.from(new Set(handles));

    try {
        let foundationResult = await conversationFoundationStore.getConversationMessagesByHandle(handle, { limit, offset, order: storeOrder });
        let allMessages = normalizeThreadStoreRows(foundationResult?.rows || []);

        if (!allMessages.length && offset === 0) {
            const storeResult = await messageStore.getMessagesForHandles(allHandles, { limit, offset, order: storeOrder });
            allMessages = normalizeThreadStoreRows(storeResult?.rows || []);
            foundationResult = {
                conversationId: null,
                total: Number(storeResult?.total || allMessages.length),
                channels: Array.from(new Set(allMessages.map((msg) => String(msg.channel || "").trim().toLowerCase()).filter(Boolean))),
                allowedChannels: [],
                defaultChannel: null,
            };
        }

        writeJson(res, 200, {
            messages: allMessages,
            hasMore: Number(foundationResult?.total || allMessages.length) > offset + allMessages.length,
            total: Number(foundationResult?.total || allMessages.length),
            order: orderParam === "oldest" ? "oldest" : "newest",
            offset,
            limit,
            conversationId: foundationResult?.conversationId || null,
            channels: foundationResult?.channels || [],
            allowedChannels: foundationResult?.allowedChannels || [],
            defaultChannel: foundationResult?.defaultChannel || null,
            conversationKind: foundationResult?.conversationKind || "direct",
            conversationTitle: foundationResult?.conversationTitle || null,
        });
    } catch (err) {
        writeJson(res, 500, { error: err.message });
    }
}

async function serveSuggest(req, res) {
    try {
        const json = await readJsonBody(req);
        const handle = json.handle || json.recipient || null;
        const providedMessage = (json.message || json.text || "").trim();

        if (!handle) {
            writeJson(res, 400, { error: "Missing handle" });
            return;
        }
        if (!contactStore.isInboxEligible(handle)) {
            writeJson(res, 404, { error: "Conversation is unavailable in {reply}." });
            return;
        }

        let message = providedMessage;
        let inferredChannel = "other";
        if (!message) {
            const handles = contactStore.getAllHandles(handle);
            const { getHistory } = require("../vector-store");
            const prefixes = handles.flatMap((h) => pathPrefixesForHandle(h));
            const historyBatches = await Promise.all(prefixes.map((p) => getHistory(p)));
            const docs = historyBatches.flat();
            const picked = pickLatestInboundFromVectorDocs(docs);
            message = picked?.text?.trim() || "";
            inferredChannel = (picked?.channel || inferChannelFromHandle(handle) || "other")
                .toString()
                .toLowerCase();

            if (!message) {
                const dbRow = await messageStore.getLatestContextForHandles(handles, { limit: 120 });
                message = String(dbRow?.text || '').trim();
                const dbPath = String(dbRow?.path || '');
                inferredChannel = (
                    dbPath.startsWith('imessage://') ? 'imessage' :
                    dbPath.startsWith('whatsapp://') ? 'whatsapp' :
                    dbPath.startsWith('mailto:') ? 'email' :
                    dbPath.startsWith('linkedin://') ? 'linkedin' :
                    inferChannelFromHandle(dbRow?.handle || handle) || 'other'
                ).toLowerCase();
            }
        }

        if (!message) {
            writeJson(res, 422, {
                error: "No inbound contact message found in index for this handle — cannot generate a reply.",
                code: "no_inbound_context",
                suggestion: ""
            });
            return;
        }

        const snippets = await getSnippets(message, 3);

        const suggestionResult = normalizeSuggestionResult(
            await generateReply(message, snippets, handle)
        );
        const suggestion = suggestionResult.suggestion;
        const explanation = suggestionResult.explanation;
        const contextMeta = suggestionResult.contextMeta;
        const rankedDraftSet = suggestionResult.rankedDraftSet || null;

        if (rankedDraftSet && Array.isArray(rankedDraftSet.drafts)) {
            const shownAt = new Date().toISOString();
            await Promise.all(
                rankedDraftSet.drafts.map((draft) =>
                    recordDraftOutcome({
                        company_id: draft.company_id,
                        cycle_id: rankedDraftSet.cycle_id,
                        thread_ref: rankedDraftSet.thread_ref,
                        channel: rankedDraftSet.channel,
                        candidate_id: draft.candidate_id,
                        disposition: "SHOWN",
                        occurred_at: shownAt,
                        original_draft_text: draft.draft_text,
                        latency_ms: 0,
                        notes: "reply_api_suggest",
                    }).catch((error) => {
                        console.warn("[reply-runtime] failed to record shown outcome:", error.message);
                    })
                )
            );
        }

        writeJson(res, 200, {
            suggestion,
            explanation,
            contextMeta,
            runtimeMode: suggestionResult.runtimeMode || null,
            rankedDraftSet,
        });
    } catch (e) {
        console.error("[reply] suggest failed:", e);
        const failure = classifyRuntimeFailure(e, { fallbackMessage: "Suggest failed" });
        writeJson(res, failure.status, {
            error: failure.error,
            code: failure.code,
            hint: failure.hint,
            retriable: failure.retriable,
        });
    }
}

async function serveRefineReply(req, res) {
    try {
        const json = await readJsonBody(req);
        const draft = json.draft || "";
        const context = json.context || "";
        if (!draft) {
            writeJson(res, 400, { error: "Missing draft" });
            return;
        }
        const refined = await refineReply(draft, context);
        writeJson(res, 200, { refined });
    } catch (e) {
        writeJson(res, 500, { error: e.message || "Refine failed" });
    }
}

async function serveFeedback(req, res) {
    try {
        const entry = await readJsonBody(req);
        entry.timestamp = new Date().toISOString();
        const logPath = path.join(__dirname, "../../feedback.jsonl");
        fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
        writeJson(res, 200, { status: "ok" });
    } catch (e) {
        writeJson(res, 400, { error: "Failed to save feedback" });
    }
}

async function serveTrinityOutcome(req, res, providedOutcome = null) {
    try {
        const outcome = providedOutcome || await readJsonBody(req);
        const result = await recordDraftOutcome(outcome);
        if (outcome?.cycle_id) {
            await exportDraftTrace(outcome.cycle_id).catch(() => null);
        }
        writeJson(res, 200, result);
    } catch (e) {
        writeJson(res, 400, { error: "Failed to record Trinity outcome" });
    }
}

async function serveTrinityShadowComparisons(req, res, url) {
    try {
        if (!allowExperimentalBrainModes()) {
            writeJson(res, 404, { error: "Not found" });
            return;
        }
        const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 20, 500));
        const rows = readShadowComparisons(limit);
        writeJson(res, 200, {
            comparisons: rows,
            total: rows.length,
        });
    } catch (e) {
        writeJson(res, 500, { error: e.message || "Failed to read {trinity} shadow comparisons" });
    }
}

/**
 * Shared send handler for iMessage, email, LinkedIn (WhatsApp uses `serveSendWhatsApp`).
 * Inbound-verified gate (reply#17) runs before any channel-specific send logic.
 */
async function serveSendMessage(req, res, channel) {
    try {
        const json = await readJsonBody(req);
        const handle = json.recipient || json.handle;
        const text = (json.text || "").toString();
        const conversationId = json.conversationId || null;
        const draftContext = sanitizeDraftContext(json.draftContext || null, { expectedChannel: channel });

        if (!handle || !text) {
            writeJson(res, 400, { error: "Missing handle or text" });
            return;
        }

        const preBlock = await maybeBlockOutboundOnPreflight();
        if (preBlock) {
            writeJson(res, 503, preBlock);
            return;
        }

        const capabilityGate = await ensureConversationCapabilityGate(handle, channel, conversationId);
        if (!capabilityGate.allowed) {
            writeJson(res, 403, {
                error: capabilityGate.reason,
                code: capabilityGate.code,
                policy: "conversation_channel_capability_required"
            });
            return;
        }

        // reply#17: `chat/utils/outbound-policy.js` — merged profiles + per-channel identity match
        const gate = checkOutboundAllowed(channel, handle);
        if (!gate.allowed) {
            appendOutboundDenial({
                channel,
                recipient: handle,
                code: gate.code,
                reason: gate.reason
            });
            writeJson(res, 403, {
                error: gate.reason,
                code: gate.code,
                hint: gate.hint,
                policy: "inbound_verified_required"
            });
            return;
        }

        if (channel === 'imessage') {
            return handleSendIMessage(req, res, handle, text, draftContext);
        } else if (channel === 'email') {
            return handleSendEmail(req, res, handle, text, draftContext);
        } else if (channel === 'linkedin') {
            return handleSendLinkedIn(req, res, handle, text, draftContext);
        } else {
            writeJson(res, 400, { error: `Unsupported channel: ${channel}` });
        }
    } catch (e) {
        writeJson(res, 500, { error: e.message });
    }
}

async function handleSendIMessage(req, res, recipient, text, draftContext = null) {
    const appleScript = `
on run argv
  set recipientId to item 1 of argv
  set msg to item 2 of argv
  tell application "Messages"
    set targetService to 1st service whose service type is iMessage
    set targetBuddy to buddy recipientId of targetService
    send msg to targetBuddy
  end tell
end run
    `;

    execFile("/usr/bin/osascript", ["-e", appleScript, "--", recipient, text], async (error) => {
        if (error) {
            console.error(`Send error: ${error}`);
            writeJson(res, 500, { error: error.message });
            return;
        }
        const sentAt = new Date().toISOString();
        const localId = `local-imessage-out-${Date.now()}-${Buffer.from(String(recipient)).toString('base64url').slice(0, 16)}`;
        await messageStore.saveMessages([{
            id: localId,
            text,
            source: 'iMessage',
            handle: recipient,
            timestamp: sentAt,
            path: `imessage://${recipient}`,
            is_from_me: 1
        }]);
        await addDocuments([{
            id: localId,
            text: `[${sentAt}] Me: ${text}`,
            source: 'iMessage',
            path: `imessage://${recipient}`
        }]);
        contactStore.updateLastContacted(recipient, sentAt, {
            channel: 'imessage',
            direction: 'outbound'
        });
        await contactStore.clearDraft(recipient);
        await autoAnnotateSentMessage("imessage", recipient, text);
        await finalizeDraftSendOutcome(draftContext, text, "ok");
        writeJson(res, 200, { status: "ok", sentAt, id: localId, recipient });
    });
}

async function handleSendEmail(req, res, recipient, text, draftContext = null) {
    try {
        const settings = readSettings();
        const gmail = settings?.gmail || {};
        if (gmail.refreshToken && gmail.clientId && gmail.clientSecret) {
            const { sendGmail } = require("../gmail-connector");
            const { getLatestSubject } = require("../vector-store");

            const originalSubject = await getLatestSubject(recipient);
            const subject = originalSubject || "";

            await sendGmail({ to: recipient, subject, text });
            await contactStore.clearDraft(recipient);
            await autoAnnotateSentMessage("email", recipient, text);
            await finalizeDraftSendOutcome(draftContext, text, "ok");
            writeJson(res, 200, { status: "ok", provider: "gmail" });
            return;
        }
    } catch (e) {
        console.warn("Gmail send failed, falling back to Mail.app:", e.message);
    }

    const { getLatestSubject } = require("../vector-store");
    const originalSubject = await getLatestSubject(recipient);
    const subject = originalSubject || "";

    const appleScript = `
on run argv
  set toAddr to item 1 of argv
  set bodyText to item 2 of argv
  set subjectText to item 3 of argv
  tell application "Mail"
    set newMessage to make new outgoing message with properties {subject:subjectText, content:bodyText, visible:true}
    tell newMessage
      make new to recipient at end of to recipients with properties {address:toAddr}
    end tell
    activate
  end tell
end run
      `;

    execFile("/usr/bin/osascript", ["-e", appleScript, "--", String(recipient), String(text), String(subject)], async (error) => {
        if (error) {
            writeJson(res, 500, { error: error.message });
            return;
        }
        await contactStore.clearDraft(recipient);
        await finalizeDraftSendOutcome(draftContext, text, "ok");
        writeJson(res, 200, { status: "ok" });
    });
}

async function handleSendLinkedIn(req, res, recipient, text, draftContext = null) {
    const targetUrl = "https://www.linkedin.com/messaging/";
    try {
        const proc = spawn("pbcopy");
        proc.stdin.write(text);
        proc.stdin.end();

        spawn("open", [targetUrl]);

        await autoAnnotateSentMessage("linkedin", recipient, text);
        await contactStore.clearDraft(recipient);
        await finalizeDraftSendOutcome(draftContext, text, "ok");
        writeJson(res, 200, {
            status: "ok",
            transport: "desktop_clipboard",
            hint: "Message copied to clipboard. Paste in LinkedIn."
        });
    } catch (e) {
        writeJson(res, 500, { error: "Failed to run desktop automation: " + e.message });
    }
}

async function serveSendWhatsApp(req, res) {
    try {
        const payload = await readJsonBody(req);
        const recipientRaw = (payload?.recipient || "").toString().trim();
        const textRaw = (payload?.text || "").toString();
        const conversationId = payload?.conversationId || null;
        const dryRun = Boolean(payload?.dryRun);
        const draftContext = payload?.draftContext || null;

        if (!recipientRaw || !textRaw) {
            writeJson(res, 400, { error: "Missing recipient or text" });
            return;
        }

        const preBlock = await maybeBlockOutboundOnPreflight();
        if (preBlock) {
            writeJson(res, 503, preBlock);
            return;
        }

        const capabilityGate = await ensureConversationCapabilityGate(recipientRaw, "whatsapp", conversationId);
        if (!capabilityGate.allowed) {
            writeJson(res, 403, {
                error: capabilityGate.reason,
                code: capabilityGate.code,
                policy: "conversation_channel_capability_required"
            });
            return;
        }

        const recipient = recipientRaw.replace(/\s+/g, "");
        const text = textRaw.replace(/\r\n/g, "\n");

        const settings = readSettings();
        const allowOpenClaw = settings?.global?.allowOpenClaw !== false;
        const transport = resolveWhatsAppSendTransport(payload?.transport);
        const allowDesktopFallback = payload?.allowDesktopFallback !== false;

        // reply#17 — same inbound-verified gate as `serveSendMessage`
        const waGate = checkOutboundAllowed("whatsapp", recipientRaw);
        if (!waGate.allowed) {
            appendOutboundDenial({
                channel: "whatsapp",
                recipient: recipientRaw,
                code: waGate.code,
                reason: waGate.reason
            });
            writeJson(res, 403, {
                error: waGate.reason,
                code: waGate.code,
                hint: waGate.hint,
                policy: "inbound_verified_required"
            });
            return;
        }

        const finishOk = async (resultPayload) => {
            await contactStore.clearDraft(recipientRaw);
            await finalizeDraftSendOutcome(draftContext, text, "ok");
            writeJson(res, 200, { status: "ok", ...resultPayload });
        };

        if (transport === "openclaw_cli") {
            if (!allowOpenClaw) {
                if (!allowDesktopFallback) {
                    writeJson(res, 403, { error: "OpenClaw WhatsApp outbound is disabled by policy." });
                    return;
                }
                const desk = await sendWhatsAppViaDesktopAutomation({ recipient, text });
                await finishOk({ transport: "desktop_automation", result: desk });
                return;
            }
            try {
                const result = await sendWhatsAppViaOpenClawCli({ recipient, text, dryRun });
                await finishOk({ transport: "openclaw_cli", result: result.parsed || result.raw || "ok" });
                return;
            } catch (e) {
                if (!allowDesktopFallback) throw e;
                console.warn("[WhatsApp] OpenClaw send failed, trying desktop automation:", e.message);
            }
        }

        const desk = await sendWhatsAppViaDesktopAutomation({ recipient, text });
        await finishOk({ transport: "desktop_automation", result: desk });
        return;
    } catch (e) {
        console.error("[DEBUG] OpenClaw Transport threw:", e.message, "\n---", e.stderr || "", "\n---", e.stdout || "");
        const hint = e.hint || null;
        writeJson(res, 500, {
            error: e.message || "WhatsApp send failed.",
            ...(hint ? { hint } : {})
        });
    }
}

async function finalizeDraftSendOutcome(draftContext, finalText, sendResult) {
    const sanitizedDraftContext = sanitizeDraftContext(draftContext || null, {
        expectedChannel: draftContext?.channel || null,
    });
    if (!sanitizedDraftContext || !sanitizedDraftContext.cycleId) {
        return;
    }
    const selectedCandidateId = String(sanitizedDraftContext.selectedCandidateId || "").trim() || null;
    const selectedDraftText = String(
        sanitizedDraftContext.selectedDraftText || sanitizedDraftContext.originalDraftText || ""
    ).trim();
    const cycleId = String(sanitizedDraftContext.cycleId || "").trim();
    const threadRef = String(sanitizedDraftContext.threadRef || "").trim();
    const channel = String(sanitizedDraftContext.channel || "").trim().toLowerCase();
    if (!cycleId || !threadRef || !channel) {
        return;
    }

    const normalizedFinal = String(finalText || "").trim();
    const editDistance = normalizedEditDistance(selectedDraftText, normalizedFinal);
    let disposition = "MANUAL_REPLACEMENT";
    if (selectedCandidateId && normalizedFinal === selectedDraftText) {
        disposition = "SENT_AS_IS";
    } else if (selectedCandidateId && editDistance <= 0.45) {
        disposition = "EDITED_THEN_SENT";
    }

    const outcomeFact = buildDraftOutcomeFact(sanitizedDraftContext, {
        company_id: sanitizedDraftContext.companyId || resolveReplyCompanyId(),
        candidate_id: selectedCandidateId,
        disposition,
        occurred_at: new Date().toISOString(),
        original_draft_text: selectedDraftText || null,
        final_text: normalizedFinal,
        edit_distance: editDistance,
        send_result: sendResult || "ok",
        notes: "reply_send",
    }, { expectedChannel: channel });
    if (!outcomeFact) {
        return;
    }
    await recordDraftOutcome(outcomeFact);
    await exportDraftTrace(cycleId).catch(() => null);
}

function normalizedEditDistance(left, right) {
    const a = String(left || "");
    const b = String(right || "");
    if (!a && !b) return 0;
    const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[a.length][b.length] / Math.max(a.length, b.length);
}

// `normalizeConversationSort` + `CONVERSATION_SORT_MODES`: exported for `chat/test/conversations-meta.test.js` (reply#31).
module.exports = {
    serveConversations,
    serveThread,
    serveSuggest,
    serveRefineReply,
    serveFeedback,
    serveTrinityOutcome,
    serveSendMessage,
    serveSendWhatsApp,
    serveTrinityShadowComparisons,
    normalizeConversationSort,
    CONVERSATION_SORT_MODES,
    AVAILABLE_CONVERSATION_SORT_MODES,
    getConversationsIndexFresh,
    applyConversationSort,
    sanitizeConversationItemForApi,
    normalizeThreadStoreRows,
    resolveConversationTimestamps,
    checkConversationCapabilityGate,
    invalidateConversationsCache: () => {
        conversationsIndexCache.builtAtMs = 0;
        conversationsIndexCache.rawItems = null;
        conversationStatsCache.clear();
        try {
            const { invalidateUnifiedIndexCache } = require("../vector-store.js");
            invalidateUnifiedIndexCache();
        } catch (_) { /* optional during tests */ }
    }
};
