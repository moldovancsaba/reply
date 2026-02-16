const { fetchConversation, fetchHandles } = require('./ingest-imessage.js');
const { Ollama } = require('ollama');
const ollama = new Ollama();
const fs = require('fs');
const path = require('path');

const MODEL = "qwen2.5:7b";
const CONTACTS_FILE = path.join(__dirname, 'data', 'contacts.json');

async function analyzeContact(handleId) {
    console.log(`Analyzing chat history for: ${handleId}...`);
    const history = await fetchConversation(handleId, 30);

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
- "displayName": Likely real name (if mentioned or inferred). If unknown, use the handle.
- "relationship": e.g., Friend, Colleague, Family, Recruiter.
- "profession": Their job title or role (if inferred).
- "notes": Key facts (e.g., "Likes coffee", "Works at Google").

CONVERSATION:
${conversationText}

RETURN ONLY JSON:
{
  "displayName": "...",
  "relationship": "...",
  "profession": "...",
  "notes": "..."
}`;

    try {
        const response = await ollama.chat({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            format: 'json'
        });

        const profile = JSON.parse(response.message.content);
        profile.handle = handleId;
        return profile;
    } catch (e) {
        console.error("Error analyzing contact:", e);
        return null;
    }
}

async function run() {
    try {
        const handles = await fetchHandles(5); // Analyze top 5 contacts
        const newProfiles = [];

        for (const meta of handles) {
            const profile = await analyzeContact(meta.id);
            if (profile) newProfiles.push(profile);
        }

        console.log("\n--- Proposed Profiles ---");
        console.log(JSON.stringify(newProfiles, null, 2));

        // In a real app, we would merge this into contacts.json
        // For now, we just output it for review.
    } catch (e) {
        console.error("Runtime Error:", e);
    }
}

run();
