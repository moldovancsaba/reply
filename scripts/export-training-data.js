const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../chat/.env') });

const OUTPUT_FILE = path.join(__dirname, '../training_data.jsonl');

async function exportData() {
    console.log("Connecting to LanceDB to export conversation pairs...");
    try {
        const { connect, TABLE_NAME } = require('../chat/vector-store.js');
        const db = await connect();
        const table = await db.openTable("documents");

        // Fetch all documents
        const results = await table.query().limit(100000).toArray();
        console.log(`Loaded ${results.length} total messages from Vector DB.`);

        // Group messages by path (conversation thread)
        const threads = {};
        for (const doc of results) {
            const p = doc.path;
            if (!threads[p]) threads[p] = [];

            // Extract date
            const match = doc.text.match(/^\[(.*?)\] (.*?): (.*)/s);
            if (match) {
                threads[p].push({
                    id: doc.id,
                    date: new Date(match[1]),
                    sender: match[2].trim(),
                    text: match[3].trim()
                });
            }
        }

        let totalPairs = 0;
        const stream = fs.createWriteStream(OUTPUT_FILE);

        for (const [pathKey, messages] of Object.entries(threads)) {
            // Sort chronologically
            messages.sort((a, b) => a.date - b.date);

            for (let i = 1; i < messages.length; i++) {
                const prev = messages[i - 1];
                const curr = messages[i];

                // We want pairs where THEY message, and then ME message
                if (curr.sender === 'Me' && prev.sender !== 'Me') {
                    // Time difference filter (only pair if within 24 hours of each other)
                    const diffMs = curr.date - prev.date;
                    if (diffMs < 24 * 60 * 60 * 1000 && diffMs >= 0) {
                        const payload = {
                            context: prev.text,
                            response: curr.text,
                            source: pathKey
                        };
                        stream.write(JSON.stringify(payload) + "\n");
                        totalPairs++;
                    }
                }
            }
        }

        stream.end();
        console.log(`\nSuccessfully exported ${totalPairs} context-response pairs to training_data.jsonl`);

    } catch (e) {
        console.error("Export Failed:", e.message);
    }
}

exportData();
