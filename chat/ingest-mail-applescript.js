const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { analyzeEmail, buildProfile } = require('./style-analyzer.js');

const KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');
const OUTPUT_FILE = path.join(KNOWLEDGE_DIR, 'style-profile.json');

// We use a large buffer because AppleScript output can be big
const MAX_BUFFER = 1024 * 1024 * 50; // 50MB

function runAppleScript(script) {
    return new Promise((resolve, reject) => {
        // Escape single quotes for the shell command
        const escapedScript = script.replace(/'/g, "'\\''");
        exec(`osascript -e '${escapedScript}'`, { maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            if (stderr) console.error("AppleScript Stderr:", stderr);
            resolve(stdout.trim());
        });
    });
}

async function getSentMailCount() {
    const script = `tell application "Mail" to count of messages of sent mailbox`;
    const result = await runAppleScript(script);
    return parseInt(result, 10);
}

/**
 * Fetches a batch of email bodies.
 * AppleScript 'messages i thru j' is 1-based.
 */
async function fetchBatch(start, count) {
    const end = start + count - 1;
    // We sanitize the content to avoid JSON parse issues from AppleScript output
    // But getting raw text is safer. We'll use a delimiter.
    const delimiter = "||||EMAIL_BOUNDARY||||";

    // We only get 'content' (body) for analysis. 
    // We could also get 'subject' if needed, but style analysis focuses on body.
    const script = `
        set output to ""
        tell application "Mail"
            set msgs to messages ${start} thru ${end} of sent mailbox
            repeat with msg in msgs
                try
                    set msgContent to content of msg
                    -- rudimentary escaping or just rely on boundary
                    set output to output & msgContent & "${delimiter}"
                on error
                    set output to output & "${delimiter}"
                end try
            end repeat
        end tell
        return output
    `;

    const raw = await runAppleScript(script);
    return raw.split(delimiter).filter(s => s.trim().length > 0);
}

async function main() {
    try {
        console.log("Connecting to Apple Mail...");
        const total = await getSentMailCount();
        console.log(`Found ${total} messages in Sent mailbox.`);

        const BATCH_SIZE = 200; // Increased for speed
        const analyses = [];

        for (let i = 1; i <= total; i += BATCH_SIZE) {
            // Cap the batch size for the last chunk
            const currentBatchSize = Math.min(BATCH_SIZE, total - i + 1);

            process.stdout.write(`\rFetching batch starting at ${i} / ${total}...`);

            try {
                const bodies = await fetchBatch(i, currentBatchSize);

                for (const body of bodies) {
                    const analysis = analyzeEmail(body);
                    if (analysis) {
                        analyses.push(analysis);
                    }
                }
            } catch (e) {
                console.error(`\nFailed to fetch batch starting at ${i}:`, e.message);
            }
        }

        console.log(`\n\nScan Complete.`);
        console.log(`Analyzed ${analyses.length} emails.`);

        if (analyses.length > 0) {
            console.log("Building Style Profile...");
            const profile = buildProfile(analyses);

            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(profile, null, 2));
            console.log(`Style Profile saved to: ${OUTPUT_FILE}`);
            console.log(JSON.stringify(profile, null, 2));
        } else {
            console.warn("No valid metrics found.");
        }

    } catch (err) {
        console.error("Error:", err);
    }
}

main();
