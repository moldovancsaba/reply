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
${historySnippets.map(s => `- [${s.date || 'Unknown Date'}] ${s.text.substring(0, 300)}...`).join('\n')}
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
    const profile = loadStyleProfile();
    const contact = contactStore.findContact(handle);

    // 1. Identity & Style (Personas)
    const baseContext = await getContext(handle);

    // 2. Semantic Search (RAG) for facts/examples
    // We fetch a larger pool and then prune by relevance or diversity
    const { search } = require('./vector-store.js');
    let ragFacts = [];
    try {
        const rawDocs = await search(message, 10);
        ragFacts = rawDocs
            .filter(d => !d.text.includes('] Me: ')) // Focus on facts, not my own style here
            .slice(0, 5);
    } catch (e) {
        console.error("ContextEngine RAG failed:", e.message);
    }

    // 3. Chronological History (Immediate context)
    const { getHistory } = require('./vector-store.js');
    let conversationHistory = "";
    try {
        const allHistory = await getHistory(handle); // This handles prefixes internally
        const recent = allHistory
            .map(d => ({
                text: d.text,
                date: d.text.match(/\[(.*?)\]/)?.[1] || "0"
            }))
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .slice(-10); // Last 10 messages

        conversationHistory = recent.map(r => r.text).join('\n');
    } catch (e) {
        console.error("ContextEngine history fetch failed:", e.message);
    }

    // 4. Token Pruning (Manual but effective for 3.2B models)
    // We prioritize: Identity > History > Style > RAG Facts
    const contextBundle = {
        identity: baseContext.identityContext,
        tone: baseContext.styleInstructions,
        history: conversationHistory || baseContext.history,
        facts: ragFacts.map(f => `[Source: ${f.path}] ${f.text}`).join('\n\n'),
        goldenExamples: baseContext.goldenExamples
    };

    return contextBundle;
}

module.exports = { getContext, assembleReplyContext };
