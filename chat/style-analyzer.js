const fs = require('fs');

/**
 * Analyzer module for the Context Engine.
 * Determines the user's stylistic fingerprint from Sent emails.
 */

// Common regex patterns for greetings and sign-offs
const GREETING_REGEX = /^(Hi|Hey|Dear|Hello|Good morning|Good afternoon|Morning|Afternoon)(?:\s+.*)?$/i;
const SIGNOFF_REGEX = /^(Best|Cheers|Thanks|Regards|Sincerely|Love|Talk soon|Later|Best regards|Kind regards|Warmly)(?:,)?$/i;

/**
 * Analyzes a single email body to extract style metrics.
 * @param {string} body - The text content of the email.
 * @returns {object|null} - { wordCount, greeting, signOff } or null if empty.
 */
function analyzeEmail(body) {
    if (!body || typeof body !== 'string') return null;

    const trimmedBody = body.trim();
    if (!trimmedBody) return null;

    // 1. Brevity: Simple word count
    const words = trimmedBody.split(/\s+/).length;

    // Split into lines for structural analysis
    const lines = trimmedBody.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    let greeting = null;
    let signOff = null;

    if (lines.length > 0) {
        // 2. Greeting: Check the first non-empty line
        const firstLine = lines[0];
        const greetingMatch = firstLine.match(GREETING_REGEX);
        // If it looks like a greeting, take the first word (normalized)
        if (greetingMatch) {
            greeting = greetingMatch[1].toLowerCase();
        } else {
            // Check if it is just a name "Csaba," or "Mark"
            // Heuristic: Short line, ends with comma or colon
            if (firstLine.length < 20 && (firstLine.endsWith(',') || firstLine.endsWith(':'))) {
                // We treat "No greeting, just name" as specific style if needed, 
                // but for now let's just capture "NameOnly" or skip.
                // Let's skip name-only for now to avoid false positives (like a title).
            }
        }

        // 3. Sign-off: Check the last few lines
        // Provide a lookback of up to 3 lines to skip name/signature
        const lookback = Math.min(lines.length, 3);
        for (let i = 1; i <= lookback; i++) {
            const line = lines[lines.length - i];
            const signOffMatch = line.match(SIGNOFF_REGEX);
            if (signOffMatch) {
                // If we found a match, capture it and stop looking
                signOff = signOffMatch[1].toLowerCase();
                break;
            }
        }
    }

    return {
        wordCount: words,
        greeting: greeting,
        signOff: signOff
    };
}

/**
 * Aggregates a list of analysis results into a single profile.
 * @param {Array<object>} analyses - Array of objects from analyzeEmail
 * @returns {object} - The Style Profile
 */
function buildProfile(analyses) {
    let totalWords = 0;
    let count = 0;
    const greetings = {};
    const signOffs = {};

    analyses.forEach(a => {
        if (!a) return;
        totalWords += a.wordCount;
        count++;

        if (a.greeting) greetings[a.greeting] = (greetings[a.greeting] || 0) + 1;
        if (a.signOff) signOffs[a.signOff] = (signOffs[a.signOff] || 0) + 1;
    });

    const averageLength = count > 0 ? Math.round(totalWords / count) : 0;

    // Helper to get top N keys
    const getTop = (obj, n) => Object.entries(obj)
        .sort((a, b) => b[1] - a[1]) // Descending by count
        .slice(0, n)
        .map(entry => entry[0]);

    return {
        averageLength,
        topGreetings: getTop(greetings, 3),
        topSignOffs: getTop(signOffs, 3),
        sampleSize: count
    };
}

module.exports = { analyzeEmail, buildProfile };
