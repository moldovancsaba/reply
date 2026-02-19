
const { ingestInboundEvent } = require("./channel-bridge.js");
const { getHistory } = require("./vector-store.js");
const contactStore = require("./contact-store.js");

async function run() {
    console.log("--- Starting LinkedIn Case-Sensitivity Repro ---");

    // TEST CASE: Mixed Case Handle
    const TEST_HANDLE = "MixedCaseUser";
    const TEST_TEXT = "Case Sensitivity Test " + Date.now();

    const event = {
        channel: "linkedin",
        peer: { handle: TEST_HANDLE, displayName: "Mixed Case User" },
        text: TEST_TEXT,
        timestamp: new Date().toISOString(),
        messageId: "msg-case-" + Date.now()
    };

    try {
        console.log(`1. Ingesting event for handle '${TEST_HANDLE}'...`);
        await ingestInboundEvent(event);
        console.log("   ✅ Ingestion successful.");
    } catch (e) {
        console.error("   ❌ Ingestion failed:", e);
        return;
    }

    // Check Contact Store (normalization?)
    console.log("2. Checking Contact Store...");
    // contactStore uses lowercase keys internally?
    const contact = contactStore.findContact(TEST_HANDLE);
    if (contact) {
        console.log(`   ✅ Contact found for '${TEST_HANDLE}'. Stored handle: '${contact.handle}'`);
    } else {
        console.error(`   ❌ Contact NOT found for '${TEST_HANDLE}'.`);
        // Try lowercase find
        const lower = contactStore.findContact(TEST_HANDLE.toLowerCase());
        if (lower) console.log(`      Found by lowercase: ${lower.handle}`);
    }

    // Check Vector Store (retrieval)
    console.log("3. Checking Vector Store retrieval...");

    // Test Exact Case Prefix
    const exactPrefix = `linkedin://${TEST_HANDLE}`;
    let history = await getHistory(exactPrefix);
    if (history.find(d => d.text.includes(TEST_TEXT))) {
        console.log(`   ✅ Found with EXACT prefix: ${exactPrefix}`);
    } else {
        console.error(`   ❌ NOT found with EXACT prefix: ${exactPrefix}`);
    }

    // Test Lowercase Prefix (Simulating if validation logic lowercases it but storage didn't)
    const lowerPrefix = `linkedin://${TEST_HANDLE.toLowerCase()}`;
    history = await getHistory(lowerPrefix);
    if (history.find(d => d.text.includes(TEST_TEXT))) {
        console.log(`   ✅ Found with LOWERCASE prefix: ${lowerPrefix}`);
    } else {
        console.log(`   ℹ️  Not found with LOWERCASE prefix: ${lowerPrefix} (Expected behavior if case-sensitive)`);
    }

    console.log("--- Repro Finished ---");
}

run().catch(console.error);
