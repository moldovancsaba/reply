const { getGoldenExamples } = require('./vector-store.js');

async function testGolden() {
    console.log("Verifying Golden Examples in LanceDB...");
    const examples = await getGoldenExamples(20);
    const liExample = examples.find(e => e.text.includes("outbound message") && e.text.includes("LinkedIn"));

    if (liExample) {
        console.log("✅ Found LinkedIn outbound Golden Example!");
        console.log("Text:", liExample.text);
    } else {
        console.error("❌ LinkedIn outbound Golden Example NOT found.");
        console.log("Found examples:", examples.map(e => e.text.substring(0, 50)).join(" | "));
    }
}

testGolden().catch(console.error);
