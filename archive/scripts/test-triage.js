const triageEngine = require('./chat/triage-engine.js');

console.log("Testing Triage Engine...");
const result = triageEngine.evaluate("We need to schedule a meeting regarding the newsletter", "test-sender");

if (result) {
    console.log("SUCCESS: Rule Matched:", result);
} else {
    console.error("FAILURE: No rule matched.");
}
