const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONTACTS_FILE = path.join(__dirname, 'data', 'contacts.json');
const SCRIPT_PATH = path.join(__dirname, 'export-contacts.applescript');

/**
 * Execute AppleScript and parse results.
 */
function ingestContacts() {
    return new Promise((resolve, reject) => {
        exec(`osascript ${SCRIPT_PATH}`, (error, stdout, stderr) => {
            if (error) {
                return reject(`AppleScript Error: ${error.message}`);
            }

            const lines = stdout.trim().split('\n');
            const newContactsData = [];

            lines.forEach(line => {
                if (!line) return;
                const [name, emails, phones, job, notes] = line.split('|SEP|');

                newContactsData.push({
                    displayName: name,
                    profession: job,
                    notes: notes ? notes.split('[NL]').join('\n') : "",
                    channels: {
                        email: emails ? emails.split(',').map(e => e.trim()) : [],
                        phone: phones ? phones.split(',').map(p => p.trim()) : []
                    }
                });
            });

            mergeWithExisting(newContactsData);
            resolve(newContactsData.length);
        });
    });
}

/**
 * Merge new contacts with existing contacts.json.
 */
function mergeWithExisting(newOnes) {
    let existing = [];
    if (fs.existsSync(CONTACTS_FILE)) {
        existing = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
    }

    newOnes.forEach(nc => {
        // Check for duplicate by email or phone
        const duplicate = existing.find(ex => {
            const emailMatch = nc.channels.email.some(e => ex.channels.email.includes(e));
            const phoneMatch = nc.channels.phone.some(p => ex.channels.phone.includes(p));
            return emailMatch || phoneMatch;
        });

        if (duplicate) {
            // Update existing with new info if missing
            if (!duplicate.profession && nc.profession) duplicate.profession = nc.profession;
            if (nc.notes) duplicate.notes = (duplicate.notes || "") + (duplicate.notes.includes(nc.notes) ? "" : " | " + nc.notes);
            // Merge arrays
            nc.channels.email.forEach(e => { if (!duplicate.channels.email.includes(e)) duplicate.channels.email.push(e); });
            nc.channels.phone.forEach(p => { if (!duplicate.channels.phone.includes(p)) duplicate.channels.phone.push(p); });
        } else {
            // Add as new
            nc.id = "id-" + Math.random().toString(36).substr(2, 9);
            existing.push(nc);
        }
    });

    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(existing, null, 2));
    console.log(`Successfully merged ${newOnes.length} contacts.`);
}

if (require.main === module) {
    ingestContacts().then(count => {
        console.log(`Done. Processed ${count} contacts.`);
    }).catch(err => {
        console.error("Ingestion failed:", err);
    });
}

module.exports = { ingestContacts };
