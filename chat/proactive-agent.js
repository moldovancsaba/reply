const contactStore = require('./contact-store.js');
const { getHistory } = require('./vector-store.js');
const { generateReply, extractKYC } = require('./reply-engine.js');
const { getSnippets } = require('./knowledge.js');

/**
 * ProactiveAgent: The background heartbeat of the Reply Hub.
 * It identifies unanswered messages and pre-generates context-aware drafts.
 */
async function runProactiveCheck() {
    console.log(`[${new Date().toISOString()}] Proactive Agent: Checking for unanswered messages...`);

    // 1. Get all contacts sorted by activity
    const contacts = contactStore.contacts;

    for (const contact of contacts) {
        if (!contact.handle) continue;

        try {
            // 2. Fetch history for this handle
            const prefix = contact.handle.includes('@') ? `mailto:${contact.handle}` : `imessage://${contact.handle}`;
            const history = await getHistory(prefix);

            if (!history || history.length === 0) continue;

            // 3. Sort history by date to find the absolute latest
            // The history text has [Date] prefix
            const sorted = history.sort((a, b) => {
                const da = a.text.match(/\[(.*?)\]/)?.[1];
                const db = b.text.match(/\[(.*?)\]/)?.[1];
                return new Date(db) - new Date(da);
            });

            const latest = sorted[0];
            const isFromMe = latest.text.includes("] Me:");

            // 4. If latest is from contact AND we haven't drafted yet
            // (Or if the draft is based on an older message)
            if (!isFromMe && contact.status !== 'draft') {
                const messageText = latest.text.split(": ").slice(1).join(": ");

                console.log(`Generating proactive draft for ${contact.displayName}...`);

                // Get knowledge snippets for this specific message
                const snippets = await getSnippets(messageText, 3);

                // Generate reply
                const draft = await generateReply(messageText, snippets, contact.handle);

                if (draft && !draft.startsWith("Error")) {
                    contactStore.setDraft(contact.handle, draft);
                    console.log(`Draft ready for ${contact.displayName}.`);
                }

                // 5. [NEW] Proactive KYC Extraction
                // Analyze for new profession, relationship, or notes
                console.log(`Analyzing message from ${contact.displayName} for KYC info...`);
                const kycInfo = await extractKYC(messageText);
                if (kycInfo && (kycInfo.profession || kycInfo.relationship || kycInfo.notes)) {
                    // Check if information is actually new/different
                    const isNew =
                        (kycInfo.profession && kycInfo.profession !== contact.profession) ||
                        (kycInfo.relationship && kycInfo.relationship !== contact.relationship) ||
                        (kycInfo.notes && !contact.notes?.includes(kycInfo.notes));

                    if (isNew) {
                        contactStore.setPendingKYC(contact.handle, kycInfo);
                        console.log(`KYC recommendation staged for ${contact.displayName}.`);
                    }
                }
            }
        } catch (err) {
            console.error(`Error processing ${contact.handle}:`, err.message);
        }
    }
}

// Run every 30 seconds for "Live" feel
const INTERVAL = 30 * 1000;
console.log("Proactive Agent started.");
runProactiveCheck();
setInterval(runProactiveCheck, INTERVAL);
