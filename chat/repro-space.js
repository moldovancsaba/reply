
const { ingestInboundEvent } = require("./channel-bridge.js");
const { getHistory } = require("./vector-store.js");
const contactStore = require("./contact-store.js");

async function run() {
    console.log("--- Starting LinkedIn Space & Case Repro ---");

    // TEST CASE: Handle with Spaces
    const TEST_HANDLE = "Mixed Case User"; // Standard LinkedIn Name
    const TEST_TEXT = "Space Test " + Date.now();

    const event = {
        channel: "linkedin",
        peer: { handle: TEST_HANDLE, displayName: TEST_HANDLE },
        text: TEST_TEXT,
        timestamp: new Date().toISOString(),
        messageId: "msg-space-" + Date.now()
    };

    try {
        console.log(`1. Ingesting event for handle '${TEST_HANDLE}'...`);
        await ingestInboundEvent(event);
        console.log("   ✅ Ingestion successful.");
    } catch (e) {
        console.error("   ❌ Ingestion failed:", e);
        return;
    }

    // Check Vector Store (retrieval)
    console.log("2. Checking Vector Store retrieval...");

    // Test Exact Prefix with Space
    const exactPrefix = `linkedin://${TEST_HANDLE}`;
    console.log(`   Querying prefix: '${exactPrefix}'`);
    let history = await getHistory(exactPrefix);

    if (history.find(d => d.text.includes(TEST_TEXT))) {
        console.log(`   ✅ Found with SPACE prefix: '${exactPrefix}'`);
    } else {
        console.error(`   ❌ NOT found with SPACE prefix: '${exactPrefix}'`);
        console.log("      Checking partial match...");
        // Try matching just "linkedin://" to see what's there
        const allLinkedin = await getHistory("linkedin://");
        const found = allLinkedin.find(d => d.text.includes(TEST_TEXT));
        if (found) {
            console.log(`      Found in dump: path='${found.path}'`);
            console.log(`      Comparison: '${exactPrefix}' vs '${found.path}'`);
            console.log(`      Code char codes: ${exactPrefix.split('').map(c => c.charCodeAt(0))}`);
            console.log(`      Db char codes:   ${found.path.split('').map(c => c.charCodeAt(0))}`);
        } else {
            console.log("      Not found even in dump.");
        }
    }

    console.log("--- Repro Finished ---");
}

run().catch(console.error);
