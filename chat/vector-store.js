const lancedb = require("@lancedb/lancedb");
const path = require("path");
const fs = require("fs");

function escapeSqlString(value) {
    return String(value ?? "").replace(/'/g, "''");
}

// Singleton for the embedding pipeline to avoid reloading the model.
let pipelineInstance = null;

const DB_PATH = process.env.REPLY_KNOWLEDGE_DB_PATH || process.env.REPLY_LANCEDB_URI || path.join(__dirname, "../knowledge/lancedb");
const TABLE_NAME = "documents";

/**
 * Initialize and retrieve the feature extraction pipeline.
 * Uses the "Xenova/all-MiniLM-L6-v2" model, which is optimized for local execution.
 */
async function getPipeline() {
    if (!pipelineInstance) {
        const { pipeline } = await import("@xenova/transformers");
        pipelineInstance = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    }
    return pipelineInstance;
}

/**
 * Generate a vector embedding for a given text string.
 */
async function getEmbedding(text) {
    const pipe = await getPipeline();
    // Normalize the output to ensure consistent vector comparison.
    const output = await pipe(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
}

/**
 * Establish a connection to the local LanceDB instance.
 * Creates the database directory if it does not exist.
 */
async function connect() {
    const dbdir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbdir)) {
        fs.mkdirSync(dbdir, { recursive: true });
    }
    return await lancedb.connect(DB_PATH);
}

/**
 * Add a batch of documents to the vector store.
 * Automatically handles table creation and FTS indexing.
 * @param {Array<{id: string, text: string, source: string, path: string}>} docs 
 */
async function addDocuments(docs) {
    if (!docs || docs.length === 0) return;

    const db = await connect();
    const data = [];

    console.log(`Generating embeddings for ${docs.length} documents...`);
    for (const doc of docs) {
        const vector = await getEmbedding(doc.text);
        data.push({
            id: doc.id,
            text: doc.text,
            source: doc.source,
            path: doc.path,
            is_annotated: !!doc.is_annotated, // Apply incoming boolean or default to false
            vector
        });
    }

    try {
        const table = await db.openTable(TABLE_NAME);
        await table.add(data);
        // Ensure the Full-Text Search (FTS) index is updated for hybrid search.
        await table.createIndex("text", { config: lancedb.Index.fts(), replace: true });
    } catch (e) {
        // If the table does not exist, create it and build the initial FTS index.
        const table = await db.createTable(TABLE_NAME, data);
        console.log("Creating initial FTS index...");
        await table.createIndex("text", { config: lancedb.Index.fts() });
    }
    console.log(`Added ${data.length} vectors to ${TABLE_NAME} and updated FTS index.`);
}

/**
 * Search for similar documents using Hybrid Search.
 * Combines Semantic (Vector) and Lexical (Keyword) search for maximum accuracy.
 * @param {string} query - The search text.
 * @param {number} limit - Maximum number of results to return.
 */
async function search(query, limit = 5) {
    const db = await connect();
    try {
        const table = await db.openTable(TABLE_NAME);
        const vector = await getEmbedding(query);

        // Use LanceDB's Hybrid Search to combine vector distance and BM25 text matching.
        const results = await table.search(vector)
            .fullTextSearch(query)
            .limit(limit)
            .execute();

        // LanceDB results can be an array or an async iterator. Handle accordingly.
        if (Array.isArray(results)) return results;

        const out = [];
        for await (const batch of results) {
            for (const row of batch) {
                // Convert Apache Arrow rows to standard JSON objects.
                out.push(row.toJSON ? row.toJSON() : row);
            }
        }
        return out;
    } catch (e) {
        console.error("Search error (table might not exist yet):", e.message);
        return [];
    }
}

function dedupeDocsByStableKey(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const out = [];
    const seen = new Set();
    for (const row of list) {
        const doc = row && row.toJSON ? row.toJSON() : row;
        if (!doc || typeof doc !== "object") continue;
        const id = String(doc.id || "").trim();
        const fallback = `${String(doc.path || "")}::${String(doc.text || "")}`;
        const key = id || fallback;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(doc);
    }
    return out;
}

/**
 * Retrieve all documents for a specific handle (by path prefix).
 * @param {string} pathPrefix - e.g. imessage://+36... or mailto:user@...
 */
async function getHistory(pathPrefix) {
    const db = await connect();
    try {
        const table = await db.openTable(TABLE_NAME);
        // We use LanceDB's filtering to get all exact matches for a path prefix.
        const results = await table.query()
            .where(`path LIKE '${escapeSqlString(pathPrefix)}%'`)
            .execute();

        if (Array.isArray(results)) return dedupeDocsByStableKey(results);

        const out = [];
        for await (const batch of results) {
            for (const row of batch) {
                out.push(row);
            }
        }
        return dedupeDocsByStableKey(out);
    } catch (e) {
        console.error("History fetch error:", e.message);
        return [];
    }
}

/**
 * Retrieve the most recent N documents for a specific handle.
 * @param {string} identifier - handle or email
 * @param {number} limit 
 */
async function getSnippets(identifier, limit = 5) {
    const prefix = identifier.includes("@") ? `mailto:${identifier}` : `imessage://${identifier}`;
    const docs = await getHistory(prefix);
    // Sort by date (extracted from text "[Date] Me: ...") and take the most recent
    return docs
        .map(d => ({
            ...d,
            date: d.text.match(/\[(.*?)\]/)?.[1] || "Unknown"
        }))
        .filter(d => d.date !== "Unknown")
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, limit);
}

/**
 * Retrieve the latest subject for a specific email address from history.
 * @param {string} email 
 * @returns {Promise<string|null>}
 */
async function getLatestSubject(email) {
    if (!email || !email.includes("@")) return null;
    const prefix = `mailto:${email}`;
    const docs = await getHistory(prefix);
    if (!docs || docs.length === 0) return null;

    // Sort by date and find the first one with a Subject: header
    const sorted = docs
        .map(d => ({
            ...d,
            date: d.text.match(/\[(.*?)\]/)?.[1] || "Unknown"
        }))
        .filter(d => d.date !== "Unknown")
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    for (const doc of sorted) {
        const match = doc.text.match(/Subject: (.*?)(?:\n|$)/);
        if (match && match[1]) return match[1].trim();
    }
    return null;
}

module.exports = { addDocuments, search, getHistory, getSnippets, getLatestSubject, connect, annotateDocument, getGoldenExamples, getPendingSuggestions, deleteDocument };

/**
 * Mark a document as a 'golden standard' example for RAG prompting.
 * @param {string} id 
 * @param {boolean} isAnnotated 
 */
async function annotateDocument(id, isAnnotated) {
    const db = await connect();
    try {
        const table = await db.openTable(TABLE_NAME);

        // Before updating, ensure the column exists by retrieving the record and re-upserting if needed, or simply using update.
        // LanceDB allows sql-like updates.
        await table.update({
            where: `id = '${escapeSqlString(id)}'`,
            values: { is_annotated: isAnnotated }
        });
    } catch (e) {
        // If the schema is locked and we can't update a missing column, we read, delete, and re-insert.
        console.warn("Fast update failed, falling back to read-delete-insert for annotation:", e.message);
        try {
            const table = await db.openTable(TABLE_NAME);
            const results = await table.query().where(`id = '${escapeSqlString(id)}'`).limit(1).toArray();
            if (results.length > 0) {
                const rawDoc = results[0];
                const doc = rawDoc.toJSON ? rawDoc.toJSON() : rawDoc;
                await table.delete(`id = '${escapeSqlString(id)}'`);
                await table.add([{ ...doc, is_annotated: isAnnotated }]);
            }
        } catch (err) {
            console.error("Failed to annotate document:", err.message);
        }
    }
}

async function getGoldenExamples(limit = 10) {
    const db = await connect();
    try {
        const table = await db.openTable(TABLE_NAME);
        // Many databases store booleans as 1 or true. LanceDB supports both.
        const results = await table.query()
            .where(`is_annotated = true`)
            .limit(limit)
            .toArray();

        return dedupeDocsByStableKey(results).map(d => ({
            id: d.id,
            source: d.source,
            text: d.text,
            date: d.date || d.text.match(/\[(.*?)\]/)?.[1] || "Unknown"
        }));
    } catch (e) {
        // Table might not exist or column might not be defined if no annotations exist yet.
        return [];
    }
}

async function getPendingSuggestions(limit = 20) {
    const db = await connect();
    try {
        const table = await db.openTable(TABLE_NAME);
        const results = await table.query()
            .where(`source = 'agent_suggestion' AND (is_annotated = false OR is_annotated IS NULL)`)
            .limit(limit)
            .toArray();

        return dedupeDocsByStableKey(results).map(d => ({
            id: d.id,
            source: d.source,
            text: d.text,
            date: d.date || "Unknown"
        }));
    } catch (e) {
        return [];
    }
}

async function deleteDocument(id) {
    const db = await connect();
    try {
        const table = await db.openTable(TABLE_NAME);
        await table.delete(`id = '${escapeSqlString(id)}'`);
    } catch (e) {
        console.error("Failed to delete document:", e.message);
    }
}
