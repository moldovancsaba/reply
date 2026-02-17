const { Ollama } = require('ollama');
const ollama = new Ollama();
const contactStore = require('./contact-store.js');
const { mergeProfile } = require("./kyc-merge.js");
const { getHistory } = require('./vector-store.js');
const { extractSignals } = require('./signal-extractor.js');
const { withDefaults, readSettings } = require('./settings-store.js');
const fs = require('fs');
const path = require('path');

const MODEL = process.env.REPLY_KYC_OLLAMA_MODEL || "qwen2.5:7b";
const KYC_DEBUG = process.env.REPLY_KYC_DEBUG === "1";

function debugLog(...args) {
    if (!KYC_DEBUG) return;
    console.error("[KYC]", ...args);
}

function normalizePhone(phone) {
    if (!phone) return null;
    const raw = String(phone).trim();
    if (!raw) return null;
    let cleaned = raw.replace(/[^\d+]/g, "");
    if (cleaned.startsWith("00")) cleaned = `+${cleaned.slice(2)}`;
    const digits = cleaned.replace(/\D/g, "");
    if (digits.length < 6) return null;
    return digits;
}

function pathPrefixesForHandle(handle) {
    if (!handle || typeof handle !== "string") return [];
    const h = handle.trim();
    if (!h) return [];
    if (h.includes("@")) return [`mailto:${h}`];
    const variants = new Set();
    variants.add(h);
    const normalized = normalizePhone(h);
    if (normalized) variants.add(normalized);
    const out = [];
    for (const v of variants) {
        out.push(`imessage://${v}`);
        out.push(`whatsapp://${v}`);
    }
    return out;
}

function extractDateFromText(text) {
    if (!text || typeof text !== "string") return null;
    const m = text.match(/\[(.*?)\]/);
    if (!m) return null;
    const d = new Date(m[1]);
    return Number.isNaN(d.getTime()) ? null : d;
}

function stripMessagePrefix(text) {
    if (!text || typeof text !== "string") return "";
    const idx = text.indexOf(": ");
    return idx >= 0 ? text.slice(idx + 2) : text;
}

function uniqueClean(arr) {
    const out = [];
    const seen = new Set();
    for (const v of (arr || [])) {
        const s = String(v || "").trim();
        if (!s) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}

function normalizeEmail(email) {
    const s = String(email || "").trim().toLowerCase();
    return s || null;
}

function getSelfEmails() {
    const out = new Set();
    const addList = (raw) => {
        const parts = String(raw || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
        for (const p of parts) {
            const key = normalizeEmail(p);
            if (key) out.add(key);
        }
    };

    addList(process.env.REPLY_SELF_EMAILS || "");
    addList(process.env.REPLY_IMAP_USER || "");
    addList(process.env.GMAIL_USER || "");

    try {
        const settings = withDefaults(readSettings());
        addList(settings?.imap?.user || "");
        addList(settings?.imap?.selfEmails || "");
        addList(settings?.gmail?.email || "");
    } catch { }

    return out;
}

function getSelfPhones() {
    const out = new Set();
    const addList = (raw) => {
        const parts = String(raw || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
        for (const p of parts) {
            const key = normalizePhone(p);
            if (key) out.add(key);
        }
    };
    addList(process.env.REPLY_SELF_PHONES || "");
    return out;
}

function extractUrls(text) {
    const out = [];
    const s = String(text || "");
    const re = /\bhttps?:\/\/[^\s<>"')]+/gi;
    const re2 = /\bwww\.[^\s<>"')]+/gi;
    for (const m of s.matchAll(re)) out.push(m[0]);
    for (const m of s.matchAll(re2)) out.push(`https://${m[0]}`);
    return out.map(u => u.replace(/[),.;!?]+$/g, ""));
}

function extractEmails(text) {
    const s = String(text || "");
    const re = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}\b/g;
    return Array.from(s.matchAll(re)).map(m => m[0]);
}

function extractHashtags(text) {
    const s = String(text || "");
    const re = /#[\p{L}\p{N}_]{2,}/gu;
    return Array.from(s.matchAll(re)).map(m => m[0]);
}

function extractPhones(text) {
    const s = String(text || "");
    const re = /(\+?\d[\d\s().-]{5,}\d)/g;
    const raw = Array.from(s.matchAll(re)).map(m => m[1]);
    const cleaned = raw
        .map(v => String(v).trim())
        .map(v => v.replace(/[^\d+]/g, ""))
        .map(v => (v.startsWith("00") ? `+${v.slice(2)}` : v))
        .filter(v => {
            const digits = v.replace(/\D/g, "");
            return digits.length >= 7 && digits.length <= 16;
        });
    return cleaned;
}

async function lidsForPhones(phoneDigitsList) {
    try {
        if (!process.env.HOME) return new Map();
        const dbPath = path.join(process.env.HOME, "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite");
        if (!fs.existsSync(dbPath)) return new Map();

        const phones = Array.from(new Set((phoneDigitsList || []).map(normalizePhone).filter(Boolean)));
        if (phones.length === 0) return new Map();

        debugLog("WA db:", dbPath);
        debugLog("WA phone count:", phones.length);
        const sqlite3 = require("sqlite3").verbose();
        debugLog("sqlite3 loaded");
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
        debugLog("sqlite3 opened");
        const all = (sql, params) =>
            new Promise((resolve, reject) => {
                db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
            });

        const out = new Map();
        const CHUNK = 400;
        for (let i = 0; i < phones.length; i += CHUNK) {
            const chunk = phones.slice(i, i + CHUNK);
            const jids = chunk.map(p => `${p}@s.whatsapp.net`);
            const placeholders = jids.map(() => "?").join(",");
            debugLog("WA query chunk:", jids.length);
            const rows = await all(
                `SELECT ZCONTACTJID, ZCONTACTIDENTIFIER FROM ZWACHATSESSION WHERE ZCONTACTJID IN (${placeholders})`,
                jids
            );
            debugLog("WA rows:", rows.length);
            for (const r of rows) {
                const jid = String(r?.ZCONTACTJID || "");
                const phone = jid.includes("@") ? jid.split("@")[0] : jid;
                const identifier = String(r?.ZCONTACTIDENTIFIER || "");
                const lidDigits = identifier.endsWith("@lid") ? identifier.slice(0, -4) : null;
                if (phone && lidDigits) out.set(normalizePhone(phone), lidDigits);
            }
        }
        try { db.close(); } catch {}
        return out;
    } catch (e) {
        console.warn("WhatsApp lid lookup failed:", e?.message || e);
        return new Map();
    }
}

async function analyzeContact(handleId) {
    console.log(`Analyzing chat history for: ${handleId}...`);
    try {
        debugLog("Step: get handles");
        const handles = contactStore.getAllHandles(handleId);
        debugLog("Handles:", handles);
        const selfEmails = getSelfEmails();
        const selfPhones = getSelfPhones();
        const phoneDigits = handles
            .filter(h => typeof h === 'string' && !String(h).includes('@'))
            .map(h => normalizePhone(h))
            .filter(Boolean);
        debugLog("Phone digits:", phoneDigits);
        debugLog("Step: lid lookup");
        const lidByPhone = await lidsForPhones(phoneDigits);
        debugLog("Lid map size:", lidByPhone.size);
        const lidHandles = Array.from(new Set(Array.from(lidByPhone.values()).filter(Boolean)));

        const allHandles = Array.from(new Set([...handles, ...lidHandles]));
        const prefixes = Array.from(new Set(allHandles.flatMap(pathPrefixesForHandle)));
        debugLog("Prefix count:", prefixes.length);

        // Fetch sequentially to reduce concurrent LanceDB pressure (and avoid native crashes).
        const allDocs = [];
        for (const p of prefixes) {
            debugLog("History fetch:", p);
            const docs = await getHistory(p);
            if (docs && docs.length) allDocs.push(...docs);
        }
        debugLog("Docs:", allDocs.length);

        const messages = allDocs
            .map(d => {
                const isFromMe = (d.text || "").includes("] Me:");
                const dateObj = extractDateFromText(d.text || "");
                return {
                    isFromMe,
                    text: stripMessagePrefix(d.text || ""),
                    date: dateObj ? dateObj.toISOString() : null,
                    dateObj: dateObj || null,
                };
            })
            .filter(m => m.text)
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        const contactMessages = messages.filter(m => !m.isFromMe);
        if (messages.length < 5) {
            console.log(`Skipping ${handleId} (not enough data).`);
            return null;
        }

        // Deterministic extraction across the FULL history (covers "from the beginning").
        // We intentionally scan BOTH directions so older URLs/emails/phones can still be found.
        const linkSet = new Set();
        const emailSet = new Set();
        const phoneSet = new Set();
        const hashtagSet = new Set();
        const addressesSet = new Set();

        for (const m of messages) {
            const signals = extractSignals(m.text || "");
            for (const v of (signals.links || [])) linkSet.add(v);
            for (const v of (signals.emails || [])) emailSet.add(v);
            for (const v of (signals.phones || [])) phoneSet.add(v);
            for (const v of (signals.hashtags || [])) hashtagSet.add(v);
            for (const v of (signals.addresses || [])) addressesSet.add(v);
        }

        // LLM extraction for higher-level items (chunked to avoid prompt limits).
        const notesSet = new Set();

        const maxLlmMessages = Math.max(50, parseInt(process.env.REPLY_KYC_LLM_MAX_MESSAGES || "400", 10) || 400);
        const maxChunks = Math.max(1, parseInt(process.env.REPLY_KYC_LLM_MAX_CHUNKS || "8", 10) || 8);

        const llmEligible = contactMessages.filter(m => m.dateObj);
        const sampled = (() => {
            if (llmEligible.length <= maxLlmMessages) return llmEligible;
            const headCount = Math.floor(maxLlmMessages / 2);
            const tailCount = maxLlmMessages - headCount;
            return [...llmEligible.slice(0, headCount), ...llmEligible.slice(-tailCount)];
        })();

        const lines = sampled.map(m => `- [${m.date}] ${m.text}`); // include date for disambiguation
        const MAX_CHARS = 12000;
        let chunk = [];
        let chars = 0;
        const chunks = [];
        for (const line of lines) {
            if (chars + line.length + 1 > MAX_CHARS && chunk.length) {
                chunks.push(chunk.join('\n'));
                chunk = [];
                chars = 0;
            }
            chunk.push(line);
            chars += line.length + 1;
        }
        if (chunk.length) chunks.push(chunk.join('\n'));

        let llmFailed = false;
        for (const corpus of chunks.slice(0, maxChunks)) {
            const prompt = `
You extract structured contact intelligence from chat logs.
The log lines are ONLY messages from the contact (not from me).

Extract ONLY what is explicitly mentioned:
- "notes": durable facts worth remembering (strings)

Rules:
- DO NOT infer names, profession, relationship.
- NEVER include the user's name "Csaba" or "Moldovan" in any output.
- If unsure, leave arrays empty.

CHAT LOG:
${corpus}

RETURN ONLY JSON:
{ "notes": [] }`;

            let response = null;
            try {
                response = await ollama.chat({
                    model: MODEL,
                    messages: [{ role: 'user', content: prompt }],
                    format: 'json'
                });
            } catch (e) {
                llmFailed = true;
                console.warn("KYC LLM extraction failed (skipping LLM step):", e?.message || e);
                break;
            }

            let parsed = {};
            try { parsed = JSON.parse(response.message.content); } catch { parsed = {}; }
            const notes = Array.isArray(parsed.notes) ? parsed.notes : [];

            for (const n of notes) {
                const v = String(n || '').trim();
                if (!v) continue;
                if (/csaba|moldovan/i.test(v)) continue;
                notesSet.add(v);
            }
        }

        const filteredEmails = Array.from(emailSet).filter((e) => {
            const key = normalizeEmail(e);
            return key && !selfEmails.has(key);
        });
        const filteredPhones = Array.from(phoneSet).filter((p) => {
            const key = normalizePhone(p);
            return key && !selfPhones.has(key);
        });

        const profile = {
            handle: handleId,
            links: uniqueClean(Array.from(linkSet)),
            emails: uniqueClean(filteredEmails),
            phones: uniqueClean(filteredPhones),
            addresses: uniqueClean(Array.from(addressesSet)),
            hashtags: uniqueClean(Array.from(hashtagSet)),
            notes: uniqueClean(Array.from(notesSet)),
            meta: {
                analyzedAt: new Date().toISOString(),
                totalMessages: messages.length,
                totalContactMessages: contactMessages.length,
                newestMessageAt: messages.filter(m => m.date).slice(-1)[0]?.date || null,
                oldestMessageAt: messages.find(m => m.date)?.date || null,
                llm: {
                    model: MODEL,
                    sampledMessages: sampled.length,
                    chunks: Math.min(chunks.length, maxChunks),
                    failed: llmFailed
                }
            }
        };

        return profile;
    } catch (e) {
        console.error(`Error analyzing contact ${handleId}: `, e.message);
        return null;
    }
}

async function run() {
    try {
        console.log("Starting KYC Agent analysis...");
        const { fetchHandles } = require('./ingest-imessage.js');
        const handles = await fetchHandles(10);

        for (const meta of handles) {
            const profile = await analyzeContact(meta.id);
            if (profile) {
                await mergeProfile(profile);
            }
        }
        console.log("Analysis complete.");
    } catch (e) {
        console.error("KYC Agent Runtime Error:", e);
    }
}

if (require.main === module) {
    run();
}

module.exports = { run, analyzeContact, mergeProfile };
