const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const contactStore = require('./contact-store');
const chatUtils = require('./utils/chat-utils');

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
                const [name, emails, phones, job, notes, company, linkedinUrl] = line.split('|SEP|');

                newContactsData.push({
                    displayName: name,
                    profession: job,
                    company: company || '',
                    linkedinUrl: linkedinUrl || '',
                    notes: notes ? notes.split('[NL]').join('\n') : "",
                    channels: {
                        email: emails ? emails.split(',').map(e => e.trim()).filter(e => e) : [],
                        phone: phones ? phones.split(',').map(p => p.trim()).filter(p => p) : []
                    }
                });
            });

            mergeWithExisting(newContactsData).then(() => {
                resolve(newContactsData.length);
            }).catch(reject);
        });
    });
}

/**
 * Merge new contacts with existing contactStore (SQLite).
 */
async function mergeWithExisting(newOnes) {
    await contactStore.waitUntilReady();

    let mergedCount = 0;
    for (const nc of newOnes) {
        let duplicate = null;

        // Find by emails
        for (const e of nc.channels.email) {
            duplicate = contactStore.findContact(e);
            if (duplicate) break;
        }

        // Find by phones
        if (!duplicate) {
            for (const p of nc.channels.phone) {
                const normP = chatUtils.normalizePhone(p);
                if (normP) {
                    duplicate = contactStore.findContact(normP);
                    if (duplicate) break;
                }
            }
        }

        // Find by name
        if (!duplicate && nc.displayName) {
            duplicate = contactStore.findContact(nc.displayName);
        }

        if (duplicate) {
            let updated = false;
            if (!duplicate.profession && nc.profession) { duplicate.profession = nc.profession; updated = true; }
            if (!duplicate.company && nc.company) { duplicate.company = nc.company; updated = true; }
            if (!duplicate.linkedinUrl && nc.linkedinUrl) { duplicate.linkedinUrl = nc.linkedinUrl; updated = true; }
            if (nc.displayName && !duplicate.displayName) { duplicate.displayName = nc.displayName; updated = true; }

            if (nc.notes) {
                const alreadyExists = duplicate.notes && duplicate.notes.some(n => n.text === nc.notes);
                if (!alreadyExists) {
                    await contactStore.addNote(duplicate.handle || duplicate.id, nc.notes);
                }
            }

            if (!duplicate.channels) duplicate.channels = { phone: [], email: [] };
            nc.channels.email.forEach(e => {
                if (!duplicate.channels.email.includes(e)) { duplicate.channels.email.push(e); updated = true; }
            });
            nc.channels.phone.forEach(p => {
                const normP = chatUtils.normalizePhone(p);
                if (normP && !duplicate.channels.phone.includes(normP)) { duplicate.channels.phone.push(normP); updated = true; }
            });

            if (updated) {
                await contactStore.saveContact(duplicate);
            }
            mergedCount++;
        } else {
            const handle = nc.channels.email[0] || (nc.channels.phone[0] ? chatUtils.normalizePhone(nc.channels.phone[0]) : null) || nc.displayName;
            if (!handle) continue;

            const newContact = {
                id: "id-" + Math.random().toString(36).substr(2, 9),
                displayName: nc.displayName,
                profession: nc.profession,
                company: nc.company,
                linkedinUrl: nc.linkedinUrl,
                handle: handle,
                status: 'open',
                channels: {
                    email: nc.channels.email,
                    phone: nc.channels.phone.map(p => chatUtils.normalizePhone(p)).filter(Boolean)
                }
            };
            await contactStore.saveContact(newContact);
            if (nc.notes) {
                await contactStore.addNote(newContact.handle, nc.notes);
            }
            mergedCount++;
        }
    }

    console.log(`Successfully merged ${mergedCount} contacts into SQLite database.`);
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
