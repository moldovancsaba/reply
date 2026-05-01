/**
 * Context engine — recipient-aware style/history + hybrid RAG for reply generation (reply#38).
 * Voice-to-draft in the hub UI is client-side (Web Speech API → composer); this module supplies
 * the structured prompt bundle consumed by `reply-engine.js` (`assembleReplyContext`).
 */
const fs = require('fs');
const path = require('path');
const { getSnippets, getGoldenExamples } = require('./vector-store.js');

const KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');
const STYLE_PROFILE_PATH = path.join(KNOWLEDGE_DIR, 'style-profile.json');

/**
 * Loads the user's stylistic profile from disk.
 */
function loadStyleProfile() {
    if (fs.existsSync(STYLE_PROFILE_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(STYLE_PROFILE_PATH, 'utf8'));
        } catch (e) {
            console.error("Failed to load style profile:", e.message);
        }
    }
    return null;
}

const contactStore = require('./contact-store.js');
const { pathPrefixesForHandle } = require('./utils/chat-utils.js');
const {
    rankDocumentsByFreshnessAndRelevance,
    freshnessBucket,
    halfLifeDaysFromEnv,
    summarizeRagFreshnessTraces
} = require('./utils/context-freshness.js');

function enrichAnnotatedDocText(d) {
    let enrichedText = d.text;
    if (d.is_annotated) {
        const summary = d.annotation_summary ? `\nSummary: ${d.annotation_summary}` : "";
        let tags = "";
        try {
            const parsedTags = JSON.parse(d.annotation_tags);
            if (Array.isArray(parsedTags) && parsedTags.length > 0) {
                tags = `\nTags: ${parsedTags.join(', ')}`;
            }
        } catch (e) { /* ignore */ }

        let facts = "";
        try {
            const parsedFacts = JSON.parse(d.annotation_facts);
            if (Array.isArray(parsedFacts) && parsedFacts.length > 0) {
                facts = `\nKey Facts: ${parsedFacts.join(', ')}`;
            }
        } catch (e) { /* ignore */ }

        enrichedText += `${summary}${tags}${facts}`;
    }
    return enrichedText;
}

/**
 * Builds the chronological thread block for the active recipient, newest slice last.
 * Uses full LanceDB rows so Ollama metadata (tags/summary/facts) is visible in-thread (reply#38).
 * @param {object[]} docs - Typically `dedupeDocsByStableKey` output from `getHistory` prefixes.
 * @param {number} maxLines
 * @returns {string}
 */
function formatChronologicalHistoryLines(docs, maxLines = 10) {
    const recent = (docs || [])
        .map((d) => ({
            doc: d,
            date: (d.text || "").match(/\[(.*?)\]/)?.[1] || "0"
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(-maxLines);
    return recent.map((r) => enrichAnnotatedDocText(r.doc)).join("\n");
}

/**
 * Assembles the context and system instructions for generating a reply.
 * @param {string} recipient - The email address or name of the recipient.
 * @returns {Promise<object>} - { styleInstructions: string, history: string, identityContext: string }
 */
async function getContext(recipient) {
    const profile = loadStyleProfile();
    let styleInstructions = "";
    let history = "";
    let identityContext = "";
    let goldenExamples = [];

    // 1. Get Identity Context (Who are we talking to?)
    if (recipient) {
        identityContext = contactStore.getProfileContext(recipient);
    }

    // 2. Determine Tone based on Relationship
    let relationshipTone = "";
    if (recipient) {
        const contact = contactStore.findContact(recipient);
        if (contact && contact.relationship) {
            const rel = contact.relationship.toLowerCase();
            if (rel.includes("boss") || rel.includes("manager") || rel.includes("client") || rel.includes("recruiter")) {
                relationshipTone = "TONE ADJUSTMENT: This is a professional contact. Be formal, polite, and structured.";
            } else if (rel.includes("friend") || rel.includes("family") || rel.includes("partner") || rel.includes("wife") || rel.includes("husband")) {
                relationshipTone = "TONE ADJUSTMENT: This is a close personal contact. Be casual, warm, and brief. No stiff formalities.";
            } else if (rel.includes("colleague")) {
                relationshipTone = "TONE ADJUSTMENT: This is a colleague. Be professional but efficiently direct.";
            }
        }
    }

    if (profile) {
        // Construct a prompt fragment based on the profile
        styleInstructions = `
### YOUR PERSONA & STYLE
You are the user. You must write in their specific voice based on analyzed "Sent" mail:
- **Brevity:** The user averages ${profile.averageLength} words per email. Do NOT be verbose.
- **Greetings:** Common greetings are: "${profile.topGreetings.join('", "')}". Use one of these.
- **Sign-offs:** Common sign-offs are: "${profile.topSignOffs.join('", "')}". End with one of these.
- **Tone:** Direct, efficient, and consistent with the above metrics.
${relationshipTone}
`;
    } else {
        // Fallback if no profile exists yet
        styleInstructions = `
### YOUR PERSONA
You are a helpful assistant writing on behalf of the user. Keep it professional and concise.
${relationshipTone}
`;
    }


    if (recipient) {
        try {
            // Find past interactions with this recipient
            const historySnippets = await getSnippets(recipient, 3);
            if (historySnippets.length > 0) {
                history = `
### PAST INTERACTIONS WITH ${recipient}
${historySnippets.map((s) => {
                    const body = enrichAnnotatedDocText(s);
                    const clip = body.length > 360 ? `${body.slice(0, 360)}…` : body;
                    return `- [${s.date || "Unknown Date"}] ${clip}`;
                }).join("\n")}
`;
            }
        } catch (e) {
            console.error("Error fetching history:", e);
        }
    }

    // 3. Get Golden Examples for stylistic mimicry
    try {
        goldenExamples = await getGoldenExamples(5);
    } catch (e) {
        console.error("Error fetching golden examples:", e);
    }

    return {
        styleInstructions,
        history,
        identityContext,
        goldenExamples
    };
}

/**
 * Unified Context Assembly for a specific reply.
 * Combines style, identity, historical snippets, and chronological interaction history.
 */
async function assembleReplyContext(message, handle) {
    const baseContext = await getContext(handle);

    const { search, getHistory, dedupeDocsByStableKey } = require('./vector-store.js');
    let ragTraces = [];
    let ragFactLines = [];

    try {
        const rawDocs = await search(message, 15);
        const pool = rawDocs
            .filter((d) => d.text && !d.text.includes("] Me: "))
            .map((d, i) => ({ ...d, _rank: 1 / (1 + i) }));
        const ranked = rankDocumentsByFreshnessAndRelevance(pool, Date.now());
        ragTraces = ranked.slice(0, 8).map((x) => ({
            path: x.doc.path,
            source: x.doc.source,
            freshness: Math.round(x.freshness * 1000) / 1000,
            relevance: Math.round(x.relevance * 1000) / 1000,
            combined: Math.round(x.combined * 1000) / 1000,
            bucket: freshnessBucket(x.freshness),
            mailLike: x.isMail,
            approxAgeDays:
                x.approxAgeDays != null ? Math.round(x.approxAgeDays * 10) / 10 : null
        }));
        ragFactLines = ranked.slice(0, 5).map((x) => {
            const bucket = freshnessBucket(x.freshness);
            const tag = `[ctx ${bucket} score=${Math.round(x.combined * 100)}%]`;
            const body = enrichAnnotatedDocText(x.doc);
            return `[Source: ${x.doc.path}] ${tag}\n${body}`;
        });
    } catch (e) {
        console.error("ContextEngine RAG failed:", e.message);
    }

    let conversationHistory = "";
    try {
        const handles = contactStore.getAllHandles(handle);
        const prefixes = Array.from(new Set(handles.flatMap((h) => pathPrefixesForHandle(h))));
        const batches = await Promise.all(prefixes.map((p) => getHistory(p)));
        const allHistory = dedupeDocsByStableKey(batches.flat());
        conversationHistory = formatChronologicalHistoryLines(allHistory, 10);
    } catch (e) {
        console.error("ContextEngine history fetch failed:", e.message);
    }

    return {
        identity: baseContext.identityContext,
        tone: baseContext.styleInstructions,
        history: conversationHistory || baseContext.history,
        facts: ragFactLines.join("\n\n"),
        goldenExamples: baseContext.goldenExamples,
        meta: {
            rag: ragTraces,
            contextFreshnessSummary: summarizeRagFreshnessTraces(ragTraces),
            halfLifeDays: halfLifeDaysFromEnv(),
            freshnessWeights: {
                relevance: String(process.env.REPLY_CONTEXT_RELEVANCE_WEIGHT || "0.45"),
                freshness: String(process.env.REPLY_CONTEXT_FRESHNESS_WEIGHT || "0.55")
            }
        }
    };
}

module.exports = {
    getContext,
    assembleReplyContext,
    enrichAnnotatedDocText,
    formatChronologicalHistoryLines
};
