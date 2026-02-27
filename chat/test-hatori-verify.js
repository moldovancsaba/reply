require('dotenv').config();
const hatori = require('./hatori-client.js');
const { generateReply } = require('./reply-engine.js');

async function runTest() {
    console.log("--- Testing Hatori Integration ---");

    // 1. Check Health
    try {
        const health = await hatori.getHealth();
        console.log("✓ Hatori Health Check:", health.status, `(Version: ${health.version})`);
    } catch (e) {
        console.error("✗ Hatori Health Check Failed:", e.message);
        console.log("Ensure Hatori is running at http://127.0.0.1:23572");
    }

    // 2. Test Ingest
    const testEventId = `reply:test-${Date.now()}`;
    try {
        const ingest = await hatori.ingestEvent({
            external_event_id: testEventId,
            kind: 'imessage',
            content: "Hello, this is a test message for Hatori integration.",
            metadata: { test: true }
        });
        console.log("✓ Hatori Ingest Test:", ingest.stored ? "Stored" : "Failed", `(ID: ${ingest.interaction_id})`);
    } catch (e) {
        console.error("✗ Hatori Ingest Failed:", e.message);
    }

    // 3. Test Reply Generation via Engine (routes through Hatori)
    process.env.REPLY_USE_HATORI = '1';
    try {
        console.log("Testing generation via Reply Engine (routed to Hatori)...");
        const result = await generateReply("Szia, hogy vagy?", [], "test-user");
        console.log("✓ Hatori Generation Test:");
        console.log("  Suggestion:", result.suggestion);
        console.log("  Explanation:", result.explanation);
        console.log("  Hatori ID:", result.hatori_id);

        if (result.hatori_id) {
            // 4. Test Outcome Reporting
            const outcome = await hatori.reportOutcome({
                external_outcome_id: `reply:test-outcome-${Date.now()}`,
                assistant_interaction_id: result.hatori_id,
                status: 'sent_as_is'
            });
            console.log("✓ Hatori Outcome Test:", outcome.delivery_event_id ? "Reported" : "Failed");
        }
    } catch (e) {
        console.error("✗ Hatori Generation/Outcome Failed:", e.message);
    }

    console.log("--- Test Run Complete ---");
}

runTest().catch(console.error);
