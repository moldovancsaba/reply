const fs = require('fs');
const path = require('path');

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
const { getSnippets } = require('./vector-store.js');

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

    // 1. Get Identity Context (Who are we talking to?)
    if (recipient) {
        identityContext = contactStore.getProfileContext(recipient);
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
`;
    } else {
        // Fallback if no profile exists yet
        styleInstructions = `
### YOUR PERSONA
You are a helpful assistant writing on behalf of the user. Keep it professional and concise.
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

    return {
        styleInstructions,
        history,
        identityContext
    };
}

module.exports = { getContext };
