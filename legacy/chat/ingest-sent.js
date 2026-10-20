const fs = require('fs');
const path = require('path');
const { mboxReader } = require('mbox-reader');
const { simpleParser } = require('mailparser');
const { analyzeEmail, buildProfile } = require('./style-analyzer.js');

const CHAT_DIR = __dirname;
const REPO_ROOT = path.join(CHAT_DIR, '..');
const KNOWLEDGE_DIR = path.join(REPO_ROOT, 'knowledge');
const OUTPUT_FILE = path.join(KNOWLEDGE_DIR, 'style-profile.json');

// Parse args
const args = process.argv.slice(2);
const mboxIndex = args.indexOf('--mbox');
const meIndex = args.indexOf('--me');

const mboxPath = mboxIndex !== -1 ? args[mboxIndex + 1] : null;
const meEmail = meIndex !== -1 ? args[meIndex + 1] : process.env.ME_EMAIL;

if (!mboxPath) {
    console.error("Usage: node ingest-sent.js --mbox <path_to_sent_mbox> --me <your_email>");
    process.exit(1);
}

if (!meEmail) {
    console.error("Error: You must provide your email address via --me <email> or ME_EMAIL env var to identify sent items.");
    process.exit(1);
}

async function processSentMail() {
    const fullPath = path.resolve(process.cwd(), mboxPath);
    if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found at ${fullPath}`);
        return;
    }

    console.log(`Processing Sent Mail: ${fullPath}`);
    console.log(`Filtering for Sender: ${meEmail}`);

    const stream = fs.createReadStream(fullPath);
    const analyses = [];
    let count = 0;
    let matchCount = 0;

    try {
        for await (const msg of mboxReader(stream)) {
            count++;
            if (count % 100 === 0) process.stdout.write(`\rScanned: ${count} | Matched: ${matchCount}`);

            try {
                const parsed = await simpleParser(msg.content);

                // Check if the sender is "me"
                // parsed.from might be an object { value: [ { address: '...' } ], text: '...' }
                const fromAddress = parsed.from?.value?.[0]?.address || parsed.from?.text || "";

                if (fromAddress.toLowerCase().includes(meEmail.toLowerCase())) {
                    matchCount++;
                    // Analyze only the body (text)
                    // If text is null, skip
                    if (parsed.text) {
                        const analysis = analyzeEmail(parsed.text);
                        if (analysis) {
                            analyses.push(analysis);
                        }
                    }
                }
            } catch (err) {
                // Squelch individual parse errors
            }
        }
        console.log(`\n\nScan Complete.`);
        console.log(`Total Emails: ${count}`);
        console.log(`Sent by You: ${matchCount}`);

        if (analyses.length > 0) {
            console.log(`Building Profile from ${analyses.length} valid artifacts...`);
            const profile = buildProfile(analyses);

            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(profile, null, 2));
            console.log(`Style Profile saved to: ${OUTPUT_FILE}`);
            console.log(JSON.stringify(profile, null, 2));
        } else {
            console.warn("No valid sent emails found to analyze.");
        }

    } catch (err) {
        console.error("Error processing mbox:", err);
    }
}

processSentMail();
