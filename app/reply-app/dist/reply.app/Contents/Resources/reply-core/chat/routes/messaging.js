/**
 * {reply} - Messaging Routes
 * Handles conversations, thread retrieval, and sending.
 */

const fs = require("fs");
const path = require("path");
const {
    safeDateMs,
    pathPrefixesForHandle,
    extractDateFromText,
    stripMessagePrefix,
    channelFromDoc,
    inferChannelFromHandle,
    inferSourceFromChannel,
    pickLatestInboundFromVectorDocs,
    buildSearchHaystack,
    matchesQuery
} = require("../utils/chat-utils");

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
    return o;
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
const whatsAppIdResolver = require("../utils/whatsapp-resolver");
const { autoAnnotateSentMessage } = require("../utils/annotation-utils");
const { generateReply } = require("../reply-engine");
const { getSnippets } = require("../knowledge");
const { refineReply } = require("../gemini-client");
const { addDocuments } = require("../vector-store");
const { execFile, spawn } = require("child_process");
const { readSettings } = require("../settings-store");
const messageStore = require("../message-store");
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

async function getConversationsIndexFresh(q = "", sortMode = "newest") {
    const nowMs = Date.now();
    const sort = normalizeConversationSort(sortMode);
    const { getUnifiedIndex } = require("../vector-store");

    let items;

    const canUseSqlHotPath =
        !q &&
        (sort === "newest" || sort === "oldest");

    const cacheOk =
        !q &&
        conversationsIndexCache.rawItems &&
        nowMs - conversationsIndexCache.builtAtMs < conversationsIndexCache.ttlMs;

    if (cacheOk) {
        items = conversationsIndexCache.rawItems.map((row) => ({ ...row }));
    } else {
        const contacts = await contactStore.refreshIfChanged();
        const itemsMap = new Map();

        if (canUseSqlHotPath) {
            const rows = await messageStore.getConversationIndexRows();
            for (const row of rows) {
                const handle = String(row.handle || "").trim();
                if (!handle) continue;
                const contact = contactStore.findContact(handle);
                const key = contact?.id || handle;
                const latestTimestamp = safeDateMs(row.timestamp);
                const firstTimestamp = safeDateMs(row.first_timestamp);
                const path = String(row.path || "");
                const latestChannel =
                    path.startsWith("imessage://") ? "imessage" :
                    path.startsWith("whatsapp://") ? "whatsapp" :
                    path.startsWith("mailto:") ? "email" :
                    path.startsWith("linkedin://") ? "linkedin" :
                    inferChannelFromHandle(handle);

                if (!itemsMap.has(key)) {
                    itemsMap.set(key, {
                        key,
                        handle,
                        latestHandle: handle,
                        sortTime: latestTimestamp,
                        channel: latestChannel,
                        source: row.source || inferSourceFromChannel(latestChannel),
                        contact: contact || null,
                        displayName: contact?.displayName || handle,
                        lastMessage: row.text || "No recent messages",
                        preview: row.text || "No recent messages",
                        previewDate: latestTimestamp ? new Date(latestTimestamp).toISOString() : null,
                        count: Number(row.total_count) || 0,
                        countIn: Number(row.total_count) || 0,
                        countOut: 0,
                        firstTimestamp: firstTimestamp || null
                    });
                }
            }
        } else {
            const statsIndex = await getUnifiedIndex();

            for (const [handle, stats] of statsIndex.entries()) {
                const contact = contactStore.findContact(handle);
                const key = contact?.id || handle;

                if (!itemsMap.has(key)) {
                    itemsMap.set(key, {
                        key,
                        handle,
                        latestHandle: stats.latestHandle || handle,
                        sortTime: stats.latestTimestamp,
                        channel: stats.latestChannel,
                        source: stats.latestSource,
                        contact: contact || null,
                        displayName: contact?.displayName || handle,
                        lastMessage: stats.latestMessage,
                        preview: stats.latestMessage,
                        previewDate: stats.latestTimestamp
                            ? new Date(stats.latestTimestamp).toISOString()
                            : null,
                        count: stats.count,
                        countIn: stats.countIn || 0,
                        countOut: stats.countOut || 0,
                        firstTimestamp: stats.firstTimestamp != null ? stats.firstTimestamp : null
                    });
                } else {
                    const item = itemsMap.get(key);
                    item.count += stats.count;
                    item.countIn = (item.countIn || 0) + (stats.countIn || 0);
                    item.countOut = (item.countOut || 0) + (stats.countOut || 0);
                    const fts = stats.firstTimestamp;
                    if (
                        fts != null &&
                        fts > 0 &&
                        (item.firstTimestamp == null || fts < item.firstTimestamp)
                    ) {
                        item.firstTimestamp = fts;
                    }
                    if (stats.latestTimestamp > item.sortTime) {
                        item.sortTime = stats.latestTimestamp;
                        item.latestHandle = stats.latestHandle || handle;
                        item.channel = stats.latestChannel;
                        item.source = stats.latestSource;
                        item.lastMessage = stats.latestMessage;
                        item.preview = stats.latestMessage;
                        item.previewDate = stats.latestTimestamp
                            ? new Date(stats.latestTimestamp).toISOString()
                            : null;
                    }
                }
            }
        }

        contacts.forEach((c) => {
            if (!itemsMap.has(c.id)) {
                itemsMap.set(c.id, {
                    key: c.id,
                    handle: c.handle,
                    latestHandle: c.handle,
                    sortTime: safeDateMs(c.lastContacted),
                    channel: c.lastChannel || inferChannelFromHandle(c.handle),
                    source: inferSourceFromChannel(
                        c.lastChannel || inferChannelFromHandle(c.handle)
                    ),
                    contact: c,
                    displayName: c.displayName,
                    lastMessage: "No recent messages",
                    preview: "No recent messages",
                    previewDate: c.lastContacted,
                    count: 0,
                    countIn: 0,
                    countOut: 0,
                    firstTimestamp: null
                });
            }
        });

        items = Array.from(itemsMap.values());

        if (!q) {
            conversationsIndexCache.rawItems = items.map((row) => ({ ...row }));
            conversationsIndexCache.builtAtMs = nowMs;
        }
    }

    if (q) {
        items = items.filter((item) => matchesQuery(conversationSearchHaystack(item), q));
    }

    applyConversationSort(items, sort, nowMs);

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
    const limit = parseInt(url.searchParams.get("limit")) || 30;
    const offset = parseInt(url.searchParams.get("offset")) || 0;

    if (!handle) {
        writeJson(res, 400, { error: "Missing handle" });
        return;
    }

    const handles = contactStore.getAllHandles(handle);
    const { getHistory } = require("../vector-store");

    const phoneDigits = handles
        .filter((h) => typeof h === "string" && !h.includes("@"))
        .map((h) => h.replace(/\D/g, ""))
        .filter(Boolean);

    const lidByPhone = await whatsAppIdResolver.lidsForPhones(phoneDigits);
    const lidHandles = Array.from(new Set(Array.from(lidByPhone.values()).filter(Boolean)));
    const allHandles = Array.from(new Set([...handles, ...lidHandles]));
    const prefixes = Array.from(new Set(allHandles.flatMap((h) => pathPrefixesForHandle(h))));

    try {
        const [historyBatches, storeResult] = await Promise.all([
            Promise.all(prefixes.map((p) => getHistory(p))),
            messageStore.getMessagesForHandles(allHandles, { limit, offset })
        ]);
        const allDocs = historyBatches.flat();

        const vectorDirectionHints = new Map();
        for (const d of allDocs) {
            const raw = String(d.text || '');
            const dateObj = extractDateFromText(raw);
            const key = `${String(d.path || '')}|${dateObj ? dateObj.toISOString() : ''}|${stripMessagePrefix(raw)}`;
            vectorDirectionHints.set(key, raw.includes('] Me:'));
        }

        let allMessages = [];
        if (Array.isArray(storeResult?.rows) && storeResult.rows.length > 0) {
            allMessages = storeResult.rows.map((row) => {
                const pathValue = String(row.path || '');
                const textValue = String(row.text || '');
                const dateIso = row.timestamp ? new Date(row.timestamp).toISOString() : null;
                const hintKey = `${pathValue}|${dateIso || ''}|${textValue}`;
                const isFromMe = row.is_from_me == null
                    ? Boolean(vectorDirectionHints.get(hintKey))
                    : Boolean(row.is_from_me);
                return {
                    id: row.id || null,
                    role: isFromMe ? "me" : "contact",
                    is_from_me: isFromMe,
                    text: textValue,
                    date: dateIso,
                    channel: channelFromDoc({ path: row.path, source: row.source }),
                    source: row.source || null,
                    path: row.path || null,
                    handle: row.handle || null,
                };
            });
        } else {
            allMessages = allDocs.map(d => {
                const isFromMe = (d.text || "").includes("] Me:");
                const dateObj = extractDateFromText(d.text || "");
                return {
                    role: isFromMe ? "me" : "contact",
                    is_from_me: isFromMe,
                    text: stripMessagePrefix(d.text || ""),
                    date: dateObj ? dateObj.toISOString() : null,
                    channel: channelFromDoc(d),
                    source: d.source || null,
                    path: d.path || null,
                };
            }).sort((a, b) => (b.date ? new Date(b.date) : 0) - (a.date ? new Date(a.date) : 0));
        }

        writeJson(res, 200, {
            messages: allMessages,
            hasMore: Number(storeResult?.total || allMessages.length) > offset + allMessages.length,
            total: Number(storeResult?.total || allMessages.length)
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

        const suggestionResult = await generateReply(message, snippets, handle);
        const suggestion = typeof suggestionResult === 'string' ? suggestionResult : (suggestionResult.suggestion || "");
        const explanation = suggestionResult.explanation || "";
        const contextMeta = suggestionResult.contextMeta || null;

        writeJson(res, 200, { suggestion, explanation, contextMeta });
    } catch (e) {
        writeJson(res, 500, { error: e.message || "Suggest failed" });
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

/**
 * Shared send handler for iMessage, email, LinkedIn (WhatsApp uses `serveSendWhatsApp`).
 * Inbound-verified gate (reply#17) runs before any channel-specific send logic.
 */
async function serveSendMessage(req, res, channel) {
    try {
        const json = await readJsonBody(req);
        const handle = json.recipient || json.handle;
        const text = (json.text || "").toString();

        if (!handle || !text) {
            writeJson(res, 400, { error: "Missing handle or text" });
            return;
        }

        const preBlock = await maybeBlockOutboundOnPreflight();
        if (preBlock) {
            writeJson(res, 503, preBlock);
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
            return handleSendIMessage(req, res, handle, text);
        } else if (channel === 'email') {
            return handleSendEmail(req, res, handle, text);
        } else if (channel === 'linkedin') {
            return handleSendLinkedIn(req, res, handle, text);
        } else {
            writeJson(res, 400, { error: `Unsupported channel: ${channel}` });
        }
    } catch (e) {
        writeJson(res, 500, { error: e.message });
    }
}

async function handleSendIMessage(req, res, recipient, text) {
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
        contactStore.updateLastContacted(recipient, sentAt, { channel: 'imessage' });
        await contactStore.clearDraft(recipient);
        await autoAnnotateSentMessage("imessage", recipient, text);
        writeJson(res, 200, { status: "ok", sentAt, id: localId, recipient });
    });
}

async function handleSendEmail(req, res, recipient, text) {
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
        writeJson(res, 200, { status: "ok" });
    });
}

async function handleSendLinkedIn(req, res, recipient, text) {
    const targetUrl = "https://www.linkedin.com/messaging/";
    try {
        const proc = spawn("pbcopy");
        proc.stdin.write(text);
        proc.stdin.end();

        spawn("open", [targetUrl]);

        await autoAnnotateSentMessage("linkedin", recipient, text);
        await contactStore.clearDraft(recipient);
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
        const dryRun = Boolean(payload?.dryRun);

        if (!recipientRaw || !textRaw) {
            writeJson(res, 400, { error: "Missing recipient or text" });
            return;
        }

        const preBlock = await maybeBlockOutboundOnPreflight();
        if (preBlock) {
            writeJson(res, 503, preBlock);
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

// `normalizeConversationSort` + `CONVERSATION_SORT_MODES`: exported for `chat/test/conversations-meta.test.js` (reply#31).
module.exports = {
    serveConversations,
    serveThread,
    serveSuggest,
    serveRefineReply,
    serveFeedback,
    serveSendMessage,
    serveSendWhatsApp,
    normalizeConversationSort,
    CONVERSATION_SORT_MODES,
    AVAILABLE_CONVERSATION_SORT_MODES,
    getConversationsIndexFresh,
    applyConversationSort,
    sanitizeConversationItemForApi,
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
