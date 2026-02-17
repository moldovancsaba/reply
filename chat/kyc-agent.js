const { fetchConversation, fetchHandles } = require('./ingest-imessage.js');
const { Ollama } = require('ollama');
const ollama = new Ollama();
const contactStore = require('./contact-store.js');

const MODEL = "qwen2.5:7b";

async function analyzeContact(handleId) {
    console.log(`Analyzing chat history for: ${handleId}...`);
    try {
        const history = await fetchConversation(handleId, 50); // Increased context

        if (history.length < 5) {
            console.log(`Skipping ${handleId} (not enough data).`);
            return null;
        }

        const conversationText = history.map(m => `${m.role}: ${m.text}`).join('\n');
        const prompt = `
ANALYZE THIS CONVERSATION to build a contact profile.
The user ("Me") is "Moldovan Csaba Zoltan".
The other person is identified by handle: "${handleId}".

Extract the following in JSON format:
- "displayName": Likely real name.
- "relationship": e.g., Friend, Colleague.
- "profession": Job title.
- "links": Array of strings (URLs shared by the CONTACT, e.g. "https://index.hu").
- "emails": Array of strings (Email addresses shared by the CONTACT).
- "phones": Array of strings (Phone numbers shared by the CONTACT, e.g. "+36...").
- "notes": Array of strings (Key facts, e.g. "Likes coffee").

CONVERSATION:
${conversationText}

RETURN ONLY JSON:
{
  "displayName": "...",
  "relationship": "...",
  "profession": "...",
  "links": ["..."],
  "emails": ["..."],
  "phones": ["..."],
  "notes": ["..."]
}`;

        const response = await ollama.chat({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            format: 'json'
        });

        const profile = JSON.parse(response.message.content);
        profile.handle = handleId;
        return profile;
    } catch (e) {
        console.error(`Error analyzing contact ${handleId}: `, e.message);
        return null;
    }
}

async function mergeProfile(profile) {
    if (!profile || !profile.handle) return;

    console.log(`Generating suggestions for ${profile.handle}...`);

    // 1. Update basic fields if provided (still auto-update for now, or move to suggestions too? 
    // User only asked for Links/Emails/Phones/Notes to be capable of accept/decline. 
    // Let's keep profile fields auto-updating for now as they are singular).
    const updates = {};
    if (profile.displayName && profile.displayName !== profile.handle) updates.displayName = profile.displayName;
    if (profile.relationship) updates.relationship = profile.relationship;
    if (profile.profession) updates.profession = profile.profession;

    if (Object.keys(updates).length > 0) {
        contactStore.updateContact(profile.handle, updates);
    }

    // 2. Generate Suggestions
    const types = ['links', 'emails', 'phones', 'notes'];
    for (const type of types) {
        if (profile[type] && Array.isArray(profile[type])) {
            for (const content of profile[type]) {
                if (content && typeof content === 'string' && content.length > 2) {
                    // Check for duplicates before adding generic suggestion
                    contactStore.addSuggestion(profile.handle, type, content);
                }
            }
        }
    }

    return contactStore.findContact(profile.handle);
}

async function run() {
    try {
        console.log("Starting KYC Agent analysis...");
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
