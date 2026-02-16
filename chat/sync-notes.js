const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { addDocuments } = require("./vector-store.js");

const META_PATH = path.join(__dirname, "..", "knowledge", "notes-metadata.json");

/**
 * Executes an AppleScript and returns the result.
 */
function runAppleScript(script) {
    return new Promise((resolve, reject) => {
        exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => { // 50MB
            if (error) reject(error);
            else resolve(stdout.trim());
        });
    });
}

/**
 * Extracts all note IDs and their modification dates for delta comparison.
 */
async function getNoteMeta() {
    const script = `tell application "Notes" to get {id, modification date} of every note`;
    const result = await runAppleScript(script);
    if (!result) return [];

    // osascript returns lists like "id1, id2, date1, date2"
    // This is hard to parse reliably via string split because dates contain commas.
    // Better strategy: iterate in AppleScript and return JSON-like format.
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
 */
async function syncNotes() {
    console.log("Starting Apple Notes sync...");

    // Load local cache to see what's changed
    let cache = {};
    if (fs.existsSync(META_PATH)) {
        cache = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
    }

    const currentNotes = await getNoteMeta();
    console.log(`Found ${currentNotes.length} total notes in Apple Notes.`);

    const toUpdate = currentNotes.filter(n => cache[n.id] !== n.modified);
    console.log(`${toUpdate.length} notes need updating.`);

    if (toUpdate.length === 0) {
        console.log("Everything is up to date.");
        return { total: currentNotes.length, updated: 0 };
    }

    const snippets = [];
    const newCache = { ...cache };

    for (let i = 0; i < toUpdate.length; i++) {
        const n = toUpdate[i];
        if (i % 20 === 0) console.log(`  Processing ${i}/${toUpdate.length}...`);

        try {
            const body = await getNoteBody(n.id);
            const cleanText = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

            // Get name/title from AppleScript or first line of text
            const nameScript = `tell application "Notes" to get name of note id "${n.id}"`;
            const name = await runAppleScript(nameScript);

            snippets.push({
                id: `apple-notes-${n.id}`,
                source: "apple-notes",
                path: name,
                text: cleanText,
            });

            newCache[n.id] = n.modified;
        } catch (e) {
            console.error(`Failed to sync note ${n.id}:`, e.message);
        }
    }

    if (snippets.length > 0) {
        console.log(`Vectorizing ${snippets.length} notes...`);
        await addDocuments(snippets);
    }

    fs.writeFileSync(META_PATH, JSON.stringify(newCache, null, 2));
    console.log("Sync complete.");
    return { total: currentNotes.length, updated: toUpdate.length };
}

module.exports = { syncNotes };

// Allow running standalone for testing
if (require.main === module) {
    syncNotes().catch(console.error);
}
