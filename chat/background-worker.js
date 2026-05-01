const fs = require('fs');
const path = require('path');
const { loadReplyEnv } = require('./load-env.js');
loadReplyEnv();
const { ensureDataHome, dataPath } = require('./app-paths.js');
ensureDataHome();

const { withDefaults, readSettings } = require('./settings-store.js');
const { applyAiSettingsToProcessEnv } = require('./ai-runtime-config.js');
applyAiSettingsToProcessEnv(readSettings());

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
const { generateReply } = require('./reply-engine.js');
const { getSnippets } = require('./knowledge.js');
const {
    enqueueSuggestionDraft,
    processOneSuggestionDraft,
    getSuggestionDraftIntervalMs
} = require('./suggestion-draft-queue.js');
const { sync: syncIMessage, getIMessageReadonlyDb } = require('./sync-imessage.js');
const { syncWhatsApp } = require('./sync-whatsapp.js');
const { syncMail, isImapConfigured, isGmailConfigured } = require('./sync-mail.js');
const triageEngine = require('./triage-engine.js');
const { extractSignals } = require('./signal-extractor.js');
const { mergeProfile } = require('./kyc-merge.js');
const { execFile } = require('child_process');
const statusManager = require('./status-manager.js');

/**
 * Optimized Background Worker (SQLite version)
 * 
 * Responsibilities:
 * 1. Poll Apple Messages (chat.db) for new activity.
 * 2. Vectorize new messages for semantic search.
 * 3. Queue suggestion drafts for inbound messages; background sweep generates one draft per interval (default 5 min, newest first).
 * 4. Extract KYC information from incoming text.
 */

const PID_FILE = dataPath('worker.pid');

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

const MESSAGE_LOOKBACK_SECONDS = 310;
const { resolveIMessageDbPath } = require('./imessage-db-path.js');

function getPollIntervalMs() {
    try {
        const settings = withDefaults(readSettings());
        const secs = Number(settings?.worker?.pollIntervalSeconds) || 60;
        return Math.max(10, Math.min(secs, 3600)) * 1000;
    } catch {
        return 60000;
    }
}

// Simple bounded cache to prevent memory leaks
const MAX_SEEN_IDS = 1000;
const seenIds = new Set();
let isProcessing = false;
const deepAnalysisInFlightByHandle = new Map();
let pollFastRequested = false;
const AUTO_SCAN_CURSOR_PATH = dataPath('kyc_auto_scan_cursor.json');

function getAutoAnalyzeIntervalMs() {
    const hours = Number(process.env.REPLY_KYC_AUTO_INTERVAL_HOURS || 24);
    if (!Number.isFinite(hours) || hours <= 0) return null;
    return Math.max(1, Math.min(hours, 24 * 14)) * 60 * 60 * 1000;
}

function getAutoScanPerHour() {
    // How many contacts to deep-analyze per hour in the background.
    // Default: 1 (safe). Set to 0 to disable.
    const raw = process.env.REPLY_KYC_AUTO_SCAN_PER_HOUR;
    if (raw === undefined || raw === null || String(raw).trim() === "") return 1;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 1;
    return Math.min(n, 60); // hard cap: 60/hour
}

function readAutoScanCursor() {
    try {
        if (!fs.existsSync(AUTO_SCAN_CURSOR_PATH)) return { index: 0 };
        const parsed = JSON.parse(fs.readFileSync(AUTO_SCAN_CURSOR_PATH, 'utf8') || "{}");
        const index = Number(parsed?.index);
        return { index: Number.isFinite(index) && index >= 0 ? index : 0 };
    } catch {
        return { index: 0 };
    }
}

function writeAutoScanCursor(next) {
    try {
        const dir = path.dirname(AUTO_SCAN_CURSOR_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(AUTO_SCAN_CURSOR_PATH, JSON.stringify({ index: next?.index || 0 }, null, 2));
    } catch { }
}

function analyzeContactInChild(handle) {
    const childScript = path.join(__dirname, 'kyc-analyze-child.js');
    return new Promise((resolve, reject) => {
        execFile(
            process.execPath,
            [childScript, String(handle)],
            {
                cwd: __dirname,
                timeout: 5 * 60 * 1000,
                maxBuffer: 20 * 1024 * 1024,
                env: process.env
            },
            (err, stdout, stderr) => {
                if (err) {
                    const details = String((stderr || stdout || '')).trim();
                    return reject(new Error(details || err.message || 'Deep analyze failed.'));
                }
                const out = String(stdout || '').trim();
                try {
                    const parsed = out ? JSON.parse(out) : null;
                    if (!parsed || parsed.status !== 'ok') return reject(new Error(parsed?.error || 'Deep analyze failed.'));
                    resolve(parsed.profile || null);
                } catch (e) {
                    const details = String((stderr || stdout || '')).trim();
                    reject(new Error(details ? `Deep analyze returned invalid JSON. ${details}` : 'Deep analyze returned invalid JSON.'));
                }
            }
        );
    });
}

function analyzeContactDeduped(handle) {
    const key = String(handle || '').trim();
    if (!key) return Promise.reject(new Error('Missing handle'));
    const existing = deepAnalysisInFlightByHandle.get(key);
    if (existing) return existing;
    const p = analyzeContactInChild(key).finally(() => deepAnalysisInFlightByHandle.delete(key));
    deepAnalysisInFlightByHandle.set(key, p);
    return p;
}

async function maybeRunDeepAnalysis(handle, reason = 'new-message') {
    const intervalMs = getAutoAnalyzeIntervalMs();
    if (!intervalMs) return;

    const contact = contactStore.findContact(handle);
    if (!contact) return;
    if (contact.status === 'closed') return;

    const analyzedAt = contact?.kycAnalysis?.analyzedAt ? new Date(contact.kycAnalysis.analyzedAt) : null;
    const lastMs = analyzedAt && !Number.isNaN(analyzedAt.getTime()) ? analyzedAt.getTime() : 0;
    if (Date.now() - lastMs < intervalMs) return;

    try {
        console.log(`[Worker] Deep analyze queued (${reason}) for ${handle}...`);
        const profile = await analyzeContactDeduped(handle);
        if (profile) {
            await mergeProfile(profile);
            console.log('[Worker] Deep analyze merged into suggestions.');
        }
    } catch (e) {
        console.warn('[Worker] Deep analyze failed:', e?.message || e);
    }
}

async function runAutoDeepAnalyzeSweepOnce() {
    const perHour = getAutoScanPerHour();
    if (!perHour) return;
    const intervalMs = getAutoAnalyzeIntervalMs();
    if (!intervalMs) return;

    const contacts = Array.isArray(contactStore.contacts) ? contactStore.contacts : [];
    if (contacts.length === 0) return;

    // Prefer recently-active contacts first.
    const sorted = [...contacts]
        .filter((c) => c && c.handle && c.status !== 'closed')
        .sort((a, b) => {
            const da = a.lastContacted ? new Date(a.lastContacted) : new Date(0);
            const db = b.lastContacted ? new Date(b.lastContacted) : new Date(0);
            return db - da;
        });

    const cursor = readAutoScanCursor();
    let idx = cursor.index % Math.max(1, sorted.length);

    // Find the next eligible contact (not analyzed within interval).
    let pick = null;
    for (let i = 0; i < sorted.length; i++) {
        const c = sorted[(idx + i) % sorted.length];
        const analyzedAt = c?.kycAnalysis?.analyzedAt ? new Date(c.kycAnalysis.analyzedAt) : null;
        const lastMs = analyzedAt && !Number.isNaN(analyzedAt.getTime()) ? analyzedAt.getTime() : 0;
        if (!lastMs || (Date.now() - lastMs) >= intervalMs) {
            pick = c;
            idx = (idx + i + 1) % sorted.length;
            break;
        }
    }

    if (!pick) {
        // Still advance cursor to avoid getting stuck on a fixed index.
        writeAutoScanCursor({ index: (idx + 1) % sorted.length });
        return;
    }

    writeAutoScanCursor({ index: idx });

    // Update progress status
    try {
        statusManager.update('kyc', {
            state: 'running',
            index: idx,
            total: sorted.length,
            lastHandle: String(pick.handle),
            message: `Analyzing contact ${idx + 1}/${sorted.length}: ${pick.displayName || pick.handle}`
        });
    } catch { }

    await maybeRunDeepAnalysis(String(pick.handle), 'auto-scan');

    // Final idle state update
    try {
        statusManager.update('kyc', { state: 'idle', lastSync: new Date().toISOString() });
    } catch { }
}

async function poll() {
    if (isProcessing) {
        console.log("[Worker] Poll skipped: still processing previous batch.");
        return;
    }
    isProcessing = true;

    try {
        // 1. Sync Messages
        console.log("Running iMessage sync...");
        await syncIMessage();

        console.log("Running WhatsApp sync...");
        await syncWhatsApp();

        // 2. Optional email sync (Gmail OAuth or IMAP)
        const imapOk = typeof isImapConfigured === 'function'
            ? isImapConfigured()
            : (process.env.REPLY_IMAP_HOST && process.env.REPLY_IMAP_USER && process.env.REPLY_IMAP_PASS);
        const gmailOk = typeof isGmailConfigured === 'function' ? isGmailConfigured() : false;
        if (gmailOk || imapOk) {
            console.log(`Running Mail sync (${gmailOk ? 'Gmail' : 'IMAP'})...`);
            const res = await syncMail();
            if (res && res.hasMore) {
                console.log("[Worker] Gmail backfill in progress, requested fast poll.");
                pollFastRequested = true;
            }
        }
    } catch (e) {
        console.error("Sync Error:", e);
    }

    const imDb = getIMessageReadonlyDb();
    if (!imDb) {
        console.warn(
            "[Worker] iMessage live polling skipped (no readable chat.db). " +
                "Grant Full Disk Access or set REPLY_IMESSAGE_DB_PATH in chat/.env."
        );
        isProcessing = false;
        return;
    }
    console.log(`[Worker] Polling chat.db at: ${resolveIMessageDbPath()}`);

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
          AND datetime(m.date / 1000000000 + 978307200, 'unixepoch') > datetime('now', '-' || ? || ' seconds')
        ORDER BY m.date DESC
    `;

    await new Promise((resolve) => {
        imDb.all(query, [MESSAGE_LOOKBACK_SECONDS], async (err, rows) => {
            if (err) {
                console.error("SQL Query Error:", err.message);
                isProcessing = false;
                resolve();
                return;
            }

            let ingestedLiveDocs = false;
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
                    ingestedLiveDocs = true;
                    try {
                        const cur = statusManager.get('imessage') || {};
                        const processed = Number(cur.processed);
                        const next = (Number.isFinite(processed) && processed >= 0 ? processed : 0) + 1;
                        statusManager.update('imessage', { processed: next, lastSync: new Date().toISOString() });
                    } catch { }

                    // 2. Track activity
                    if (handle) {
                        contactStore.updateLastContacted(handle, date, { channel: 'imessage' });
                    }

                    // 3. Intelligence Pipeline (Only if NOT from me)
                    if (!fromMe && handle) {
                        await runIntelligencePipeline(handle, text);
                    }
                }
            } catch (e) {
                console.error("Worker Core Error:", e);
            } finally {
                if (ingestedLiveDocs) {
                    try {
                        const { invalidateUnifiedIndexCache } = require("./vector-store.js");
                        invalidateUnifiedIndexCache();
                    } catch (_) { /* ignore */ }
                }
                isProcessing = false;
                resolve();
            }
        });
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

        // 0.5. Stage incremental AI Suggestions from the latest message (fast path)
        try {
            const signals = extractSignals(text);
            for (const url of (signals.links || [])) contactStore.addSuggestion(handle, 'links', url);
            for (const email of (signals.emails || [])) contactStore.addSuggestion(handle, 'emails', email);
            for (const phone of (signals.phones || [])) contactStore.addSuggestion(handle, 'phones', phone);
            for (const addr of (signals.addresses || [])) contactStore.addSuggestion(handle, 'addresses', addr);
            for (const tag of (signals.hashtags || [])) contactStore.addSuggestion(handle, 'hashtags', tag);
        } catch (e) {
            console.warn('[Worker] Signal extraction failed:', e?.message || e);
        }

        // A. Deep KYC analysis (full history -> suggestions only), debounced.
        // Fire-and-forget so the worker can keep processing inbound messages.
        void maybeRunDeepAnalysis(handle, 'new-message');

        // B. Suggestion drafts — default: queue for background (one draft / interval, newest first).
        // Set REPLY_INLINE_DRAFT_GENERATE=1 to also run generateReply on every inbound (heavy).
        enqueueSuggestionDraft(handle);
        if (String(process.env.REPLY_INLINE_DRAFT_GENERATE || '').trim() === '1') {
            const snippets = await getSnippets(text, 3);
            const draftResult = await generateReply(text, snippets, handle);
            const draftText = typeof draftResult === 'string' ? draftResult : (draftResult.suggestion || '');
            if (String(draftText || '').trim()) {
                await contactStore.setDraft(handle, draftText);
                console.log('[Worker] Inline draft created.');
            }
        }
    } catch (e) {
        console.error("Intelligence Pipeline Error:", e);
    }
}

console.log("==========================================");
console.log("🚀 REPLY BACKGROUND WORKER ACTIVE (SQLITE)");
console.log(`Interval: ${Math.round(getPollIntervalMs() / 1000)}s`);
console.log("==========================================");

async function pollLoop() {
    try {
        await poll();
    } finally {
        const interval = pollFastRequested ? 420000 : getPollIntervalMs();
        if (pollFastRequested) {
            console.log(`[Worker] Backfill fast-poll active (next in 420s)`);
            pollFastRequested = false;
        }
        setTimeout(pollLoop, interval);
    }
}

/**
 * Background suggestion drafts: at most one generateReply per interval (default 5 min),
 * queue order newest-first. Disable with REPLY_SUGGEST_BACKGROUND_DISABLE=1.
 */
async function runSuggestionDraftSweepOnce() {
    const everyMs = getSuggestionDraftIntervalMs();
    if (!everyMs) return;
    try {
        const res = await processOneSuggestionDraft({
            contactStore,
            generateReply,
            getSnippets,
            isBusy: () => isProcessing
        });
        if (res.skipped) {
            console.log('[Worker] Suggestion draft sweep skipped (iMessage poll in progress).');
        } else if (res.ok) {
            console.log(`[Worker] Background suggestion draft ready for ${res.handle}.`);
        } else if (res.reason && res.reason !== 'queue_empty') {
            console.log(
                `[Worker] Suggestion draft sweep: ${res.handle || '(no handle)'} — ${res.reason}`
            );
        }
    } catch (e) {
        console.error('[Worker] Suggestion draft sweep error:', e.message || e);
    }
}

(() => {
    const everyMs = getSuggestionDraftIntervalMs();
    if (!everyMs) {
        console.log('[Worker] Background suggestion drafts disabled (REPLY_SUGGEST_BACKGROUND_DISABLE=1).');
        return;
    }
    console.log(`[Worker] Background suggestion drafts every ${Math.round(everyMs / 1000)}s (newest queued first).`);
    setInterval(runSuggestionDraftSweepOnce, everyMs);
    setTimeout(runSuggestionDraftSweepOnce, 45 * 1000);
})();

/**
 * Periodic Ollama annotation of unannotated LanceDB rows (reply#36 / reply#37).
 * Disabled when REPLY_ANNOTATION_DISABLE=1 or interval is 0.
 */
function getAnnotationSweepIntervalMs() {
    if (String(process.env.REPLY_ANNOTATION_DISABLE || "").trim() === "1") {
        return 0;
    }
    const raw = process.env.REPLY_ANNOTATION_INTERVAL_MS;
    if (raw != null && String(raw).trim() !== "") {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) {
            return Math.min(n, 24 * 60 * 60 * 1000);
        }
        if (Number.isFinite(n) && n === 0) {
            return 0;
        }
    }
    return 30 * 60 * 1000;
}

async function runOllamaAnnotationSweepOnce() {
    try {
        const { annotateBatch } = require("./annotation-agent.js");
        await annotateBatch();
    } catch (e) {
        console.error("[Worker] Ollama annotation sweep failed:", e.message);
    }
}

(() => {
    const everyMs = getAnnotationSweepIntervalMs();
    if (!everyMs) {
        console.log("[Worker] LanceDB annotation sweep disabled (REPLY_ANNOTATION_DISABLE=1 or REPLY_ANNOTATION_INTERVAL_MS=0).");
        return;
    }
    const minutes = Math.round(everyMs / 60000);
    console.log(`[Worker] LanceDB annotation sweep every ~${minutes}m (set REPLY_ANNOTATION_INTERVAL_MS to override).`);
    setTimeout(() => void runOllamaAnnotationSweepOnce(), 90 * 1000);
    setInterval(() => void runOllamaAnnotationSweepOnce(), everyMs);
})();

pollLoop();

// Background deep analysis sweep: N contacts per hour (default 1/hour).
// This keeps AI Suggestions fresh even if a contact hasn't sent a new message recently.
(() => {
    const perHour = getAutoScanPerHour();
    if (!perHour) return;
    const intervalMs = getAutoAnalyzeIntervalMs();
    if (!intervalMs) return;

    const minutes = Math.max(5, Math.round(60 / perHour));
    const everyMs = minutes * 60 * 1000;

    console.log(`[Worker] Auto KYC sweep enabled: ~${perHour}/hour (every ${minutes}m), min interval ${Math.round(intervalMs / 3600000)}h/contact.`);

    let inFlight = false;
    const tick = async () => {
        if (inFlight) return;
        inFlight = true;
        try {
            await runAutoDeepAnalyzeSweepOnce();
        } finally {
            inFlight = false;
        }
    };

    // Stagger first run slightly after startup to avoid competing with initial sync.
    setTimeout(() => void tick(), 45 * 1000);
    setInterval(() => void tick(), everyMs);
})();
