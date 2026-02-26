const { connect } = require('./vector-store.js');

async function migrate() {
    console.log("Starting schema migration...");
    const db = await connect();
    const table = await db.openTable("documents");
    
    // Fetch all records
    console.log("Fetching existing documents...");
    let results = [];
    try {
        const queryRes = await table.query().limit(100000).toArray();
        results = queryRes;
    } catch(e) {
        console.error("Failed to read", e);
        return;
    }
    
    console.log(`Found ${results.length} documents. Creating new schema...`);
    
    // Transform docs to include the new columns
    const migratedDocs = results.map(doc => {
        let cleanDoc = doc.toJSON ? doc.toJSON() : doc;
        return {
            id: cleanDoc.id,
            text: cleanDoc.text,
            source: cleanDoc.source,
            path: cleanDoc.path,
            vector: Array.from(cleanDoc.vector),
            is_annotated: cleanDoc.is_annotated || false,
            // Initialize new columns natively
            annotation_tags: cleanDoc.annotation_tags || "[]",
            annotation_summary: cleanDoc.annotation_summary || "",
            annotation_facts: cleanDoc.annotation_facts || "[]"
        };
    });

    console.log("Dropping old table...");
    try {
        await db.dropTable("documents");
    } catch(e) {
        console.log("Drop failed, might not exist?", e.message);
    }
    
    console.log("Creating new table with migrated documents...");
    try {
        const newTable = await db.createTable("documents", migratedDocs);
        console.log("Schema upgraded successfully. Re-indexing FTS...");
        const lancedb = require("@lancedb/lancedb");
        await newTable.createIndex("text", { config: lancedb.Index.fts() });
        console.log("Migration complete!");
    } catch(e) {
        console.error("Migration failed:", e);
    }
}

migrate();
