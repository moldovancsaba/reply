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
    buildSearchHaystack,
    matchesQuery
} = require("../utils/chat-utils");
const { writeJson, readJsonBody, normalizeErrorText, parseJsonSafe } = require("../utils/server-utils");
const {
    applyOpenClawWhatsAppGuard,
    resolveOpenClawBinary,
    buildOpenClawWhatsAppHint
} = require("../utils/whatsapp-utils");
const contactStore = require("../contact-store");
const whatsAppIdResolver = require("../utils/whatsapp-resolver");
const { autoAnnotateSentMessage } = require("../utils/annotation-utils");
const { generateReply } = require("../reply-engine");
const { getSnippets } = require("../knowledge");
const { refineReply } = require("../gemini-client");
const { execFile, spawn } = require("child_process");
const { readSettings, resolveWhatsAppSendTransport } = require("../settings-store");
const messageStore = require("../message-store");
const hatori = require("../hatori-client.js");

const CONVERSATION_STATS_TTL_MS = 60 * 1000;
const CONVERSATION_PREVIEW_SAMPLE_ROWS = 200;
const conversationStatsCache = new Map();

// Local cache for conversations index
const conversationsIndexCache = {
    builtAtMs: 0,
    ttlMs: 5 * 1000,
    buildPromise: null,
    items: [],
};

async function getConversationsIndexFresh(q = "") {
    const now = Date.now();
    const { getUnifiedIndex } = require("../vector-store");

    // Fetch unified stats from LanceDB
    const statsIndex = await getUnifiedIndex();
    const contacts = await contactStore.refresh();

    // Map stats back to contacts or raw handles
    const itemsMap = new Map();

    // 1. Process stats index to create base items
    for (const [handle, stats] of statsIndex.entries()) {
        const contact = contactStore.getByHandle(handle);
        const key = contact?.id || handle;

        if (!itemsMap.has(key)) {
            itemsMap.set(key, {
                key: key,
                handle: handle, // Use handle from index as representative
                latestHandle: stats.latestHandle || handle,
                sortTime: stats.latestTimestamp,
                channel: stats.latestChannel,
                source: stats.latestSource,
                contact: contact || null,
                displayName: contact?.displayName || handle,
                lastMessage: stats.latestMessage,
                preview: stats.latestMessage,
                previewDate: stats.latestTimestamp ? new Date(stats.latestTimestamp).toISOString() : null,
                count: stats.count
            });
        } else {
            // Merge stats if multiple handles map to same contact
            const item = itemsMap.get(key);
            item.count += stats.count;
            if (stats.latestTimestamp > item.sortTime) {
                item.sortTime = stats.latestTimestamp;
                item.latestHandle = stats.latestHandle || handle;
                item.channel = stats.latestChannel;
                item.source = stats.latestSource;
                item.lastMessage = stats.latestMessage;
                item.preview = stats.latestMessage;
                item.previewDate = stats.latestTimestamp ? new Date(stats.latestTimestamp).toISOString() : null;
            }
        }
    }

    // 2. Add contacts that don't have messages yet but exist in contact store
    contacts.forEach(c => {
        if (!itemsMap.has(c.id)) {
            itemsMap.set(c.id, {
                key: c.id,
                handle: c.handle,
                latestHandle: c.handle,
                sortTime: safeDateMs(c.lastContacted),
                channel: c.lastChannel || inferChannelFromHandle(c.handle),
                source: inferSourceFromChannel(c.lastChannel || inferChannelFromHandle(c.handle)),
                contact: c,
                displayName: c.displayName,
                lastMessage: "No recent messages",
                preview: "No recent messages",
                previewDate: c.lastContacted,
                count: 0
            });
        }
    });

    let items = Array.from(itemsMap.values());

    // 3. Filter if search active
    if (q) {
        const query = q.toLowerCase();
        items = items.filter(item => {
            return (item.displayName || "").toLowerCase().includes(query) ||
                (item.handle || "").toLowerCase().includes(query) ||
                (item.lastMessage || "").toLowerCase().includes(query);
        });
    }

    // 4. Sort by time
    items.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));

    if (!q) {
        conversationsIndexCache.items = items;
        conversationsIndexCache.builtAtMs = Date.now();
    }

    return { items };
}



async function serveConversations(req, res, url) {
    const limit = parseInt(url.searchParams.get("limit")) || 20;
    const offset = parseInt(url.searchParams.get("offset")) || 0;
    const q = (url.searchParams.get("q") || url.searchParams.get("query") || "").toString();

    try {
        const { items } = await getConversationsIndexFresh(q);
        const page = items.slice(offset, offset + limit);

        writeJson(res, 200, {
            contacts: page,
            hasMore: items.length > offset + limit,
            total: items.length,
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
        const historyBatches = await Promise.all(prefixes.map((p) => getHistory(p)));
        const allDocs = historyBatches.flat();

        const allMessages = allDocs.map(d => {
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

        writeJson(res, 200, {
            messages: allMessages.slice(offset, offset + limit),
            hasMore: allMessages.length > offset + limit,
            total: allMessages.length
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
        if (!message) {
            const handles = contactStore.getAllHandles(handle);
            const { getHistory } = require("../vector-store");
            const prefixes = handles.flatMap((h) => pathPrefixesForHandle(h));
            const historyBatches = await Promise.all(prefixes.map((p) => getHistory(p)));
            const docs = historyBatches.flat();
            const lastIncoming = docs
                .map((d) => ({
                    role: (d.text || "").includes("] Me:") ? "me" : "contact",
                    text: stripMessagePrefix(d.text || ""),
                    date: extractDateFromText(d.text || ""),
                }))
                .filter((m) => m.date && m.text && m.role === "contact")
                .sort((a, b) => b.date - a.date)[0];
            message = lastIncoming?.text?.trim() || "";
        }

        if (!message) {
            writeJson(res, 200, { suggestion: "Hi — just checking in." });
            return;
        }

        const snippets = await getSnippets(message, 3);

        // Ingest into Hatori before suggestion if enabled
        if (process.env.REPLY_USE_HATORI === '1') {
            try {
                await hatori.ingestEvent({
                    external_event_id: `reply:msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    kind: handle.includes('@') ? 'email' : 'imessage',
                    conversation_id: `reply:${handle}`,
                    sender_id: `reply:${handle}`,
                    content: message,
                    metadata: { source: 'api-suggest' }
                });
            } catch (e) {
                console.warn("[Hatori] Ingest failed, continuing to suggestion:", e.message);
            }
        }

        const suggestionResult = await generateReply(message, snippets, handle);
        const suggestion = typeof suggestionResult === 'string' ? suggestionResult : (suggestionResult.suggestion || "");
        const explanation = suggestionResult.explanation || "";
        const hatori_id = suggestionResult.hatori_id || null;

        writeJson(res, 200, { suggestion, explanation, hatori_id });
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

async function serveSendMessage(req, res, channel) {
    try {
        const json = await readJsonBody(req);
        const handle = json.recipient || json.handle;
        const text = (json.text || "").toString();

        if (!handle || !text) {
            writeJson(res, 400, { error: "Missing handle or text" });
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
        await contactStore.clearDraft(recipient);
        await autoAnnotateSentMessage("imessage", recipient, text);
        writeJson(res, 200, { status: "ok" });
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

        const recipient = recipientRaw.replace(/\s+/g, "");
        const text = textRaw.replace(/\r\n/g, "\n");

        const settings = readSettings();
        const allowOpenClaw = settings?.global?.allowOpenClaw !== false;

        if (!allowOpenClaw) {
            writeJson(res, 403, { error: "OpenClaw WhatsApp outbound is disabled by policy." });
            return;
        }

        const { sendWhatsAppViaOpenClawCli } = require("../utils/whatsapp-utils");
        const result = await sendWhatsAppViaOpenClawCli({ recipient, text, dryRun });
        await contactStore.clearDraft(recipientRaw);
        writeJson(res, 200, { status: "ok", result: result.parsed || result.raw || "ok" });
        return;
    } catch (e) {
        console.error("[DEBUG] OpenClaw Transport threw:", e.message, "\n---", e.stderr || "", "\n---", e.stdout || "");
        writeJson(res, 500, { error: e.message || "WhatsApp send failed." });
    }
}

async function serveHatoriOutcome(req, res) {
    try {
        const payload = await readJsonBody(req);
        if (process.env.REPLY_USE_HATORI !== '1') {
            return writeJson(res, 403, { error: "Hatori is disabled" });
        }
        const result = await hatori.reportOutcome({
            external_outcome_id: payload.external_outcome_id || `reply:outcome-${Date.now()}`,
            assistant_interaction_id: payload.assistant_interaction_id,
            status: payload.status, // sent_as_is | edited_then_sent | not_sent
            original_text: payload.original_text,
            final_sent_text: payload.final_sent_text,
            diff: payload.diff
        });
        writeJson(res, 200, result);
    } catch (e) {
        writeJson(res, 500, { error: e.message });
    }
}

module.exports = {
    serveConversations,
    serveThread,
    serveSuggest,
    serveRefineReply,
    serveFeedback,
    serveSendMessage,
    serveSendWhatsApp,
    invalidateConversationsCache: () => {
        conversationsIndexCache.builtAtMs = 0;
        conversationStatsCache.clear();
    }
};
