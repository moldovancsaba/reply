const { addDocuments, search } = require("./vector-store.js");
const path = require("path");
const fs = require("fs");

async function run() {
    console.log("1. Adding test documents for Hybrid Search...");
    const docs = [
        { id: "h-1", text: "The architectural design of the Eiffel Tower is unique.", source: "test", path: "paris" },
        { id: "h-2", text: "I have a hidden code: XY-99-BETA in my notes.", source: "test", path: "secret" },
        { id: "h-3", text: "Cooking pasta requires boiling water and salt.", source: "test", path: "kitchen" }
    ];
    await addDocuments(docs);

    console.log("\n2. Searching for 'tower' (Semantic Match)...");
    const res1 = await search("tower", 1);
    console.log("Result 1:", res1.map(r => r.text));
    const success1 = res1.length > 0 && res1[0].text.includes("Eiffel");
    console.log("Semantic Success:", success1);

    console.log("\n3. Searching for 'XY-99' (Keyword/Lexical Match)...");
    const res2 = await search("XY-99", 1);
    console.log("Result 2:", res2.map(r => r.text));
    const success2 = res2.length > 0 && res2[0].text.includes("BETA");
    console.log("Lexical Success:", success2);

    if (success1 && success2) {
        console.log("\n✅ HYBRID SEARCH VERIFIED: Successfully handled both semantic and literal matches.");
    } else {
        console.log("\n❌ HYBRID SEARCH FAILED: One or more search types failed.");
        process.exit(1);
    }
}

run().catch(console.error);
