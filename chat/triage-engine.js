const fs = require('fs');
const path = require('path');

const RULES_FILE = path.join(__dirname, 'triage-rules.json');
const LOG_FILE = path.join(__dirname, 'triage.log');

let rules = [];

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
            const result = {
                timestamp: new Date().toISOString(),
                ruleId: rule.id,
                action: rule.action,
                tag: rule.tag,
                sender: sender,
                contact: sender,  // alias for UI compatibility (dashboard.js reads log.contact)
                preview: text.substring(0, 50) + "..."
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

// Initial load
loadRules();

module.exports = {
    evaluate,
    loadRules,
    getLogs
};
