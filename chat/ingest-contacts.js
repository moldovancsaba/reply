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
        // Increase maxBuffer to 10MB to handle large contact lists
        exec(`osascript ${SCRIPT_PATH}`, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
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
                        email: emails ? emails.split(',').map(e => e.trim()).filter(e => e) : [],
                        phone: phones ? phones.split(',').map(p => p.trim()).filter(p => p) : []
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
        let duplicate = existing.find(ex => {
            const emailMatch = nc.channels.email.length > 0 && nc.channels.email.some(e => ex.channels.email.includes(e));
            const phoneMatch = nc.channels.phone.length > 0 && nc.channels.phone.some(p => ex.channels.phone.includes(p));
            return emailMatch || phoneMatch;
        });

        // Fallback: Check by Name if no identifier matches were found
        if (!duplicate && nc.displayName) {
            duplicate = existing.find(ex =>
                ex.displayName && ex.displayName.toLowerCase().trim() === nc.displayName.toLowerCase().trim()
            );
        }

        if (duplicate) {
            // Update existing with new info if missing
            if (!duplicate.profession && nc.profession) duplicate.profession = nc.profession;

            // Merge notes: only add if new note text isn't already in the structured log
            if (nc.notes) {
                if (!Array.isArray(duplicate.notes)) {
                    duplicate.notes = [];
                }
                const alreadyExists = duplicate.notes.some(n => n.text === nc.notes);
                if (!alreadyExists) {
                    duplicate.notes.push({
                        id: 'note-' + Date.now() + Math.random().toString(36).substr(2, 5),
                        text: nc.notes,
                        timestamp: new Date().toISOString()
                    });
                }
            }
            // Merge arrays
            nc.channels.email.forEach(e => { if (!duplicate.channels.email.includes(e)) duplicate.channels.email.push(e); });
            nc.channels.phone.forEach(p => { if (!duplicate.channels.phone.includes(p)) duplicate.channels.phone.push(p); });
        } else {
            // Add as new
            nc.id = "id-" + Math.random().toString(36).substr(2, 9);
            // Ensure n.notes is an array even for new contacts
            nc.notes = nc.notes ? [{
                id: 'note-' + Date.now() + Math.random().toString(36).substr(2, 5),
                text: nc.notes,
                timestamp: new Date().toISOString()
            }] : [];
            existing.push(nc);
        }
    });

    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(existing, null, 2));
    console.log(`Successfully merged ${newOnes.length} contacts.`);
}

if (require.main === module) {
    ingestContacts().then(async count => {
        console.log(`Done. Processed ${count} contacts.`);

        // Trigger KYC Agent analysis automatically
        try {
            const { run: runKYC } = require('./kyc-agent.js');
            console.log("Triggering automatic KYC analysis...");
            await runKYC();
        } catch (kycErr) {
            console.error("Automatic KYC analysis failed:", kycErr.message);
        }
    }).catch(err => {
        console.error("Ingestion failed:", err);
    });
}

module.exports = { ingestContacts };
