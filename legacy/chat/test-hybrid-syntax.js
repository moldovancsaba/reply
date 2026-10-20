const lancedb = require("@lancedb/lancedb");
const path = require("path");
const fs = require("fs");

async function test() {
    const uri = path.join(__dirname, "test-hybrid-db");
    if (fs.existsSync(uri)) fs.rmSync(uri, { recursive: true });

    const db = await lancedb.connect(uri);
    const data = [
        { id: "1", text: "The quick brown fox", vector: [0.1, 0.2] },
        { id: "2", text: "The lazy dog", vector: [0.3, 0.4] }
    ];

    const table = await db.createTable("test", data);

    console.log("Creating FTS index...");
    await table.createIndex("text", { config: lancedb.Index.fts() });

    console.log("Testing Hybrid Search...");
    try {
        const results = await table.search([0.1, 0.2])
            .text("fox")
            .limit(2)
            .execute();
        console.log("Hybrid Results:", results.length);
    } catch (e) {
        console.log("Hybrid search failed:", e.message);
    }
}

test().catch(console.error);
