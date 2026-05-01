const fs = require('fs');
const path = require('path');
const contactStore = require('./contact-store.js');

/**
 * Basic CSV Parser (Quote-aware)
 * Reused from ingest-linkedin-posts.js
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

async function ingestLinkedInContactsFromString(content) {
    const rows = parseCSV(content);
    const contactsToSave = [];
    let processed = 0;

    for (const row of rows) {
        const firstName = row['First Name'] || "";
        const lastName = row['Last Name'] || "";
        const email = row['Email Address'] || "";
        const company = row['Company'] || "";
        const position = row['Position'] || "";
        const connectedOn = row['Connected On'] || "";

        if (!firstName && !lastName) continue;

        const displayName = `${firstName} ${lastName}`.trim();
        const profession = position && company ? `${position} @ ${company}` : (position || company || "");
        const { normalizeLinkedInHandle } = require('./linkedin-utils.js');
        const liHandle = normalizeLinkedInHandle(displayName);
        const handle = email ? email : liHandle;
        const contactId = 'li-con-' + Buffer.from(handle).toString('hex').slice(-12);

        const contactData = {
            id: contactId,
            displayName,
            handle,
            profession,
            lastChannel: 'linkedin',
            status: 'open',
            channels: {
                email: email ? [email] : [],
                phone: [],
                linkedin: [liHandle]
            }
        };

        contactsToSave.push(contactData);
        processed++;
    }

    if (contactsToSave.length > 0) {
        console.log(`Adding ${contactsToSave.length} LinkedIn connections...`);
        await contactStore.waitUntilReady();
        await contactStore.saveContacts(contactsToSave);
        const { recordChannelSync } = require('./channel-bridge.js');
        recordChannelSync('linkedin_contacts');
        return { success: true, count: contactsToSave.length };
    }
    return { success: false, count: 0 };
}

async function ingestLinkedInContacts(csvPath) {
    const fullPath = path.resolve(process.cwd(), csvPath);
    if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found at ${fullPath}`);
        return;
    }

    console.log(`Processing LinkedIn Connections: ${fullPath}`);
    const content = fs.readFileSync(fullPath, 'utf8');
    return await ingestLinkedInContactsFromString(content);
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const csvPath = args[0];

    if (!csvPath) {
        console.error("Usage: node ingest-linkedin-contacts.js <path_to_Connections.csv>");
        process.exit(1);
    }

    ingestLinkedInContacts(csvPath)
        .then(res => console.log("Ingestion complete.", res))
        .catch(console.error);
}

module.exports = { ingestLinkedInContacts, ingestLinkedInContactsFromString, parseCSV };
