const fs = require('fs');
const path = require('path');

const RULES_FILE = path.join(__dirname, 'triage-rules.json');
const LOG_FILE = path.join(__dirname, 'triage.log');

let rules = [];

/**
 * Derive zero-inbox action chips when a rule omits `suggestedActions` (reply#24).
 * @param {{ action?: string, suggestedActions?: string[] }} rule
 * @returns {string[]}
 */
function inferSuggestedActions(rule) {
    if (Array.isArray(rule.suggestedActions) && rule.suggestedActions.length) {
        return [...new Set(rule.suggestedActions.map((x) => String(x).toLowerCase()))].filter(Boolean);
    }
    const a = String(rule.action || "").toLowerCase();
    const s = new Set();
    if (a.includes("archive") || a.includes("promo") || a.includes("junk") || a.includes("spam") || a.includes("noise")) {
        s.add("archive");
    }
    if (a.includes("upload") || a.includes("file") || a.includes("photo") || a.includes("attachment")) {
        s.add("upload");
    }
    if (a.includes("reply") || a.includes("respond") || a.includes("answer")) {
        s.add("reply");
    }
    if (s.size === 0) s.add("reply");
    return Array.from(s);
}

/**
 * Load triage rules from JSON file.
 */
function loadRules() {
    if (fs.existsSync(RULES_FILE)) {
        try {
            rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
            console.log(`[Triage] Loaded ${rules.length} rules.`);
        } catch (e) {
            console.error("[Triage] Error loading rules:", e);
        }
    } else {
        console.warn("[Triage] No rules file found.");
    }
}

/**
 * Evaluate a message against loaded rules.
 * @param {string} text - Message content
 * @param {string} sender - Sender handle/email
 * @returns {object|null} - The matched rule and action taken, or null.
 */
function evaluate(text, sender) {
    if (!text) return null;
    const lowerText = text.toLowerCase();

    for (const rule of rules) {
        // Check sender constraint (wildcard '*' or prefix match like 'linkedin://*')
        if (rule.sender !== '*' && rule.sender !== sender) {
            if (rule.sender.endsWith('*')) {
                const prefix = rule.sender.slice(0, -1);
                if (!sender.startsWith(prefix)) continue;
            } else {
                continue;
            }
        }

        // Check keywords
        const match = rule.keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));

        if (match) {
            const suggestedActions = inferSuggestedActions(rule);
            const priority = typeof rule.priority === "number" && !Number.isNaN(rule.priority) ? rule.priority : 50;
            const result = {
                timestamp: new Date().toISOString(),
                ruleId: rule.id,
                action: rule.action,
                tag: rule.tag,
                sender: sender,
                contact: sender,  // alias for UI compatibility (dashboard.js reads log.contact)
                preview: text.substring(0, 50) + "...",
                suggestedActions,
                priority
            };

            logAction(result);
            return result;
        }
    }
    return null;
}

/**
 * Log the triage action to a file.
 * @param {object} actionResult 
 */
function logAction(result) {
    const logEntry = JSON.stringify(result) + "\n";
    fs.appendFile(LOG_FILE, logEntry, (err) => {
        if (err) console.error("[Triage] Log error:", err);
    });
}

/**
 * Get recent triage logs.
 * @param {number} limit 
 * @returns {Array} List of recent actions
 */
function getLogs(limit = 20) {
    if (!fs.existsSync(LOG_FILE)) return [];

    try {
        const data = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = data.trim().split('\n');
        return lines
            .slice(-limit)
            .map(line => {
                try { return JSON.parse(line); } catch { return null; }
            })
            .filter(Boolean)
            .reverse(); // Newest first
    } catch (e) {
        console.error("[Triage] Error reading logs:", e);
        return [];
    }
}

/**
 * Read up to `maxLines` JSONL events from disk (oldest→newest order in array).
 * @param {number} maxLines
 */
function readLogTailEntries(maxLines = 800) {
    if (!fs.existsSync(LOG_FILE)) return [];
    try {
        const data = fs.readFileSync(LOG_FILE, "utf8");
        const lines = data.trim().split("\n").filter(Boolean);
        const slice = lines.slice(-maxLines);
        const out = [];
        for (const line of slice) {
            try {
                out.push(JSON.parse(line));
            } catch { /* skip */ }
        }
        return out;
    } catch (e) {
        console.error("[Triage] readLogTailEntries:", e.message);
        return [];
    }
}

/**
 * Deduplicated “inbox” view: one row per contact/sender, highest `priority` wins (reply#24).
 * @param {number} limit
 */
function getPriorityQueue(limit = 15) {
    const raw = readLogTailEntries(800);
    const byKey = new Map();
    for (const row of raw) {
        if (!row || !row.timestamp) continue;
        const key = String(row.contact || row.sender || "").trim() || "_unknown";
        const pri = typeof row.priority === "number" ? row.priority : 0;
        const prev = byKey.get(key);
        if (!prev || pri > prev.priority || (pri === prev.priority && String(row.timestamp) > String(prev.timestamp))) {
            byKey.set(key, { ...row, _queueKey: key });
        }
    }
    return [...byKey.values()]
        .sort((a, b) => {
            const d = (b.priority || 0) - (a.priority || 0);
            if (d !== 0) return d;
            return String(b.timestamp).localeCompare(String(a.timestamp));
        })
        .slice(0, Math.max(1, limit));
}

// Initial load
loadRules();

module.exports = {
    evaluate,
    loadRules,
    getLogs,
    getPriorityQueue,
    inferSuggestedActions
};
