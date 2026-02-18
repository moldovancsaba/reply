const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { addDocuments } = require("./vector-store.js");

/**
 * Run an AppleScript string via osascript and return the output.
 * Uses execFile (argv-based) to avoid shell injection.
 */
function runAppleScript(script) {
    return new Promise((resolve, reject) => {
        execFile("/usr/bin/osascript", ["-e", script], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, _stderr) => {
            if (err) return reject(err);
            resolve(stdout.trim());
        });
    });
}

const statusManager = require('./status-manager.js');

const KNOWLEDGE_DIR = path.join(__dirname, "..", "knowledge");
const DATA_DIR = path.join(__dirname, "data");
const META_PATH = path.join(KNOWLEDGE_DIR, "notes-metadata.json");

// Ensure directories exist
if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function updateStatus(status) {
    statusManager.update('notes', status);
}

/**
 * Extracts all note IDs and their modification dates for delta comparison.
 */
async function getNoteMeta() {
    const jsonScript = `
        tell application "Notes"
            set AppleScript's text item delimiters to "||"
            set out to ""
            repeat with n in notes
                set out to out & (id of n) & "|" & (modification date of n as string) & "||"
            end repeat
            return out
        end tell
    `;
    const raw = await runAppleScript(jsonScript);
    return raw.split("||").filter(Boolean).map(row => {
        const [id, date] = row.split("|");
        return { id, modified: date };
    });
}

/**
 * Fetches the body of a specific note.
 */
async function getNoteBody(id) {
    const script = `tell application "Notes" to get body of note id "${id}"`;
    return await runAppleScript(script);
}

/**
 * Main Sync Logic
 * @param {number|null} limit - Optional limit for testing
 * @returns {Promise<object>} Sync stats
 */
async function syncNotes(limit = null) {
    console.log("Starting Apple Notes sync...");
    updateStatus({ state: "running", progress: 0, message: "Analyzing Apple Notes metadata..." });

    // Load local cache to see what's changed
    let cache = {};
    if (fs.existsSync(META_PATH)) {
        cache = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
    }

    let currentNotes = [];
    try {
        currentNotes = await getNoteMeta();
    } catch (e) {
        updateStatus({ state: "error", message: `Failed to read Apple Notes: ${e.message}` });
        throw e;
    }

    console.log(`Found ${currentNotes.length} total notes in Apple Notes.`);

    let toUpdate = currentNotes.filter(n => cache[n.id] !== n.modified);

    if (limit && toUpdate.length > limit) {
        console.log(`Limiting sync to ${limit} notes as requested.`);
        toUpdate = toUpdate.slice(0, limit);
    }

    console.log(`${toUpdate.length} notes will be processed.`);

    if (toUpdate.length === 0) {
        console.log("Everything is up to date.");
        updateStatus({ state: "idle", lastSync: new Date().toISOString(), total: currentNotes.length, updated: 0 });
        return { total: currentNotes.length, updated: 0 };
    }

    const snippets = [];
    const newCache = { ...cache };

    for (let i = 0; i < toUpdate.length; i++) {
        const n = toUpdate[i];
        if (i % 10 === 0) {
            const progress = Math.round((i / toUpdate.length) * 100);
            updateStatus({ state: "running", progress, message: `Syncing note ${i + 1}/${toUpdate.length}...` });
        }

        try {
            const body = await getNoteBody(n.id);
            // Clean HTML and normalize whitespace
            const cleanText = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

            const nameScript = `tell application "Notes" to get name of note id "${n.id}"`;
            const name = await runAppleScript(nameScript);

            snippets.push({
                id: `apple-notes-${n.id}`,
                source: "apple-notes",
                path: name,
                text: `[${n.modified}] Note: ${name}\n\n${cleanText}`, // Prepend metadata for RAG context
            });

            newCache[n.id] = n.modified;
        } catch (e) {
            console.error(`Failed to sync note ${n.id}:`, e.message);
        }
    }

    if (snippets.length > 0) {
        console.log(`Vectorizing ${snippets.length} notes...`);
        updateStatus({ state: "running", progress: 90, message: `Vectorizing ${snippets.length} snippets...` });
        await addDocuments(snippets);
    }

    fs.writeFileSync(META_PATH, JSON.stringify(newCache, null, 2));

    // Don't set 'total' or 'processed' - server reads from notes-metadata.json
    const finalStats = { state: "idle", lastSync: new Date().toISOString() };
    updateStatus(finalStats);
    console.log("Sync complete.");
    return finalStats;
}

module.exports = { syncNotes };

if (require.main === module) {
    const args = process.argv.slice(2);
    const limitIndex = args.indexOf("--limit");
    const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1]) : null;

    syncNotes(limit).catch(e => {
        console.error(e);
        updateStatus({ state: "error", message: e.message });
    });
}
