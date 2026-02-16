const fs = require("fs");
const path = require("path");
const { addDocuments, search } = require("./vector-store.js");

async function run() {
    console.log("0. Cleaning up previous test DB...");
    const dbPath = path.join(__dirname, "../knowledge/lancedb");
    if (fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { recursive: true, force: true });
    }

    console.log("1. Adding test documents...");
    const docs = [
        { id: "test-1", text: "The dog barks loudly at the mailman.", source: "test", path: "doc1" },
        { id: "test-2", text: "The cat meows softly on the sofa.", source: "test", path: "doc2" },
        { id: "test-3", text: "I love coding in Javascript and Node.js.", source: "test", path: "doc3" }
    ];
    await addDocuments(docs);

    console.log("2. Searching for 'puppy' (semantic match expectation)...");
    const results1 = await search("puppy", 3);
    console.log("Results for 'puppy':", results1.map(r => `${r.text} (dist: ${r._distance})`));

    const success1 = results1.length > 0 && results1[0].text.toLowerCase().includes("dog");

    console.log("3. Searching for 'programming' (semantic match expectation)...");
    const results2 = await search("programming", 1);
    console.log("Results for 'programming':", results2.map(r => r.text));

    const success2 = results2.length > 0 && results2[0].text.includes("coding");

    if (success1 && success2) {
        console.log("SUCCESS: Vector search is working!");
    } else {
        console.error("FAILURE: Semantic matches failed.");
        process.exit(1);
    }
}

run().catch(console.error);
