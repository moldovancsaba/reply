const fs = require('fs');
const path = require('path');
const { addDocuments } = require('./vector-store.js');
const { analyzeEmail, buildProfile } = require('./style-analyzer.js');

const CHAT_DIR = __dirname;
const REPO_ROOT = path.join(CHAT_DIR, '..');
const KNOWLEDGE_DIR = path.join(REPO_ROOT, 'knowledge');
const OUTPUT_FILE = path.join(KNOWLEDGE_DIR, 'style-profile.json');

/**
 * Basic CSV Parser (Quote-aware)
 */
function parseCSV(text) {
    const rows = [];
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) return rows;

    const headers = parseCSVLine(lines[0]);
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = parseCSVLine(lines[i]);
        const row = {};
        headers.forEach((h, idx) => {
            row[h.trim()] = values[idx] ? values[idx].trim() : "";
        });
        rows.push(row);
    }
    return rows;
}

function parseCSVLine(line) {
    const result = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(cur);
            cur = "";
        } else {
            cur += char;
        }
    }
    result.push(cur);
    return result;
}

async function ingestLinkedInPostsFromString(content) {
    const rows = parseCSV(content);
    const snippets = [];
    const analyses = [];
    let id = Date.now();

    for (const row of rows) {
        const text = row['ShareCommentary'] || row['Content'] || row['Text'] || "";
        const date = row['Date'] || row['Timestamp'] || "Unknown Date";

        if (!text) continue;

        const cleanText = text.replace(/\\n/g, '\n').trim();

        snippets.push({
            id: `li-post-${id++}`,
            text: `[${date}] LinkedIn Post: ${cleanText}`,
            source: 'linkedin-posts',
            path: `linkedin://posts/${rows.indexOf(row)}`,
            is_annotated: true
        });

        const analysis = analyzeEmail(cleanText);
        if (analysis) {
            analyses.push(analysis);
        }
    }

    if (snippets.length > 0) {
        console.log(`Adding ${snippets.length} posts to vector store...`);
        await addDocuments(snippets);

        if (analyses.length > 0) {
            console.log(`Updating Style Profile with ${analyses.length} posts...`);
            let existingProfile = { averageLength: 0, topGreetings: [], topSignOffs: [], sampleSize: 0 };
            if (fs.existsSync(OUTPUT_FILE)) {
                try {
                    existingProfile = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
                } catch (e) {
                    console.warn("Could not parse existing style-profile.json, starting fresh.");
                }
            }

            const newProfile = buildProfile(analyses);
            const totalSamples = existingProfile.sampleSize + newProfile.sampleSize;
            const combinedAvg = Math.round(
                ((existingProfile.averageLength * existingProfile.sampleSize) +
                    (newProfile.averageLength * newProfile.sampleSize)) / totalSamples
            );

            const combinedProfile = {
                averageLength: combinedAvg,
                topGreetings: [...new Set([...existingProfile.topGreetings, ...newProfile.topGreetings])].slice(0, 5),
                topSignOffs: [...new Set([...existingProfile.topSignOffs, ...newProfile.topSignOffs])].slice(0, 5),
                sampleSize: totalSamples
            };

            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(combinedProfile, null, 2));
            console.log("Style profile updated.");
        }

        const { recordChannelSync } = require('./channel-bridge.js');
        recordChannelSync('linkedin_posts');

        return { success: true, count: snippets.length };
    }
    return { success: false, count: 0 };
}

async function ingestLinkedInPosts(csvPath) {
    const fullPath = path.resolve(process.cwd(), csvPath);
    if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found at ${fullPath}`);
        return;
    }

    console.log(`Processing LinkedIn Posts: ${fullPath}`);
    const content = fs.readFileSync(fullPath, 'utf8');
    return await ingestLinkedInPostsFromString(content);
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const csvPath = args[0];

    if (!csvPath) {
        console.error("Usage: node ingest-linkedin-posts.js <path_to_Shares.csv>");
        process.exit(1);
    }

    ingestLinkedInPosts(csvPath)
        .then(res => console.log("Post ingestion complete.", res))
        .catch(console.error);
}

module.exports = { ingestLinkedInPosts, ingestLinkedInPostsFromString, parseCSV };
