const lancedb = require("@lancedb/lancedb");
const path = require("path");
const fs = require("fs");

async function test() {
    const uri = path.join(__dirname, "test-hybrid-db-final");
    if (fs.existsSync(uri)) fs.rmSync(uri, { recursive: true });

    const db = await lancedb.connect(uri);
    const data = [
        { id: "1", text: "The quick brown fox", vector: [0.1, 0.2] },
        { id: "2", text: "The lazy dog", vector: [0.3, 0.4] }
    ];

    const table = await db.createTable("test", data);

    console.log("Creating FTS index...");
    // The correct way in JS to create FTS index seems to be:
    const { Index } = require("@lancedb/lancedb");
    await table.createIndex("text", { config: Index.fts() });

    console.log("Testing Hybrid Search with .fullTextSearch()...");
    try {
        const results = await table.search([0.1, 0.2])
            .fullTextSearch("fox")
            .limit(2)
            .execute();
        console.log("Hybrid Results count:", results.length);
        const rows = [];
        for await (const batch of results) {
            for (const row of batch) {
                rows.push(row.toJSON ? row.toJSON() : row);
            }
        }
        console.log("Rows:", JSON.stringify(rows.map(r => r.text)));
    } catch (e) {
        console.log("Hybrid search failed:", e.message);
    }
}

test().catch(console.error);
