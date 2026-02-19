
const { ingestInboundEvent, readBridgeEventLog } = require("./channel-bridge.js");
const contactStore = require("./contact-store.js");
const { getHistory } = require("./vector-store.js");
const fs = require("fs");
const path = require("path");

async function run() {
    console.log("--- Starting LinkedIn Ingestion Repro ---");

    const TEST_HANDLE = "test-linkedin-user";
    const TEST_TEXT = "Hello from repro script " + Date.now();

    const event = {
        channel: "linkedin",
        peer: { handle: TEST_HANDLE, displayName: "Test User" },
        text: TEST_TEXT,
        timestamp: new Date().toISOString(),
        messageId: "msg-" + Date.now()
    };

    try {
        console.log("1. Ingesting event...");
        await ingestInboundEvent(event);
        console.log("   ✅ Ingestion successful.");
    } catch (e) {
        console.error("   ❌ Ingestion failed:", e);
        return;
    }

    // Check 1: Contact Store
    console.log("2. Checking Contact Store...");
    const contact = contactStore.findContact(TEST_HANDLE);
    if (contact) {
        console.log(`   ✅ Contact found: ${contact.handle} (Last channel: ${contact.lastChannel})`);
    } else {
        console.error("   ❌ Contact NOT found in store.");
    }

    // Check 2: Vector Store
    console.log("3. Checking Vector Store...");
    // pathPrefixesForHandle would return linkedin://test-linkedin-user
    const prefix = `linkedin://${TEST_HANDLE}`;
    const history = await getHistory(prefix);
    const found = history.find(d => d.text.includes(TEST_TEXT));
    if (found) {
        console.log(`   ✅ Message found in vector store (path: ${found.path}).`);
    } else {
        console.error(`   ❌ Message NOT found in vector store (prefix: ${prefix}).`);
        console.log("      All history for prefix:", history);
    }

    // Check 3: Bridge Log
    console.log("4. Checking Bridge Log...");
    const logs = readBridgeEventLog(100);
    const logEntry = logs.find(l => l.messageId === event.messageId);
    if (logEntry) {
        console.log(`   ✅ Log entry found (status: ${logEntry.status}).`);
    } else {
        console.error("   ❌ Log entry NOT found.");
    }

    console.log("--- Repro Finished ---");
}

run().catch(console.error);
