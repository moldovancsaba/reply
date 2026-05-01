const { execFile } = require('child_process');
const path = require('path');
const contactStore = require('./contact-store');
const chatUtils = require('./utils/chat-utils');
const statusManager = require('./status-manager');

const SWIFT_CONTACTS_EXPORTER = path.join(__dirname, 'native', 'apple-contacts-export.swift');
const XCRUN_BIN = '/usr/bin/xcrun';

function updateStatus(status) {
    statusManager.update('contacts', status);
}

function execFilePromise(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, options, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                return reject(error);
            }
            resolve({ stdout, stderr });
        });
    });
}

async function exportContactsNative() {
    const binPath = path.join(__dirname, 'data', 'apple-contacts-export');
    await execFilePromise(XCRUN_BIN, ['--sdk', 'macosx', 'swiftc', '-parse-as-library', SWIFT_CONTACTS_EXPORTER, '-o', binPath], {
        maxBuffer: 20 * 1024 * 1024,
        timeout: 120000
    });
    const { stdout } = await execFilePromise(binPath, [], {
        maxBuffer: 100 * 1024 * 1024,
        timeout: 300000
    });
    const parsed = JSON.parse(stdout || '[]');
    if (!Array.isArray(parsed)) {
        throw new Error('Native Contacts exporter returned invalid JSON.');
    }
    return parsed.map((row) => ({
        displayName: row.displayName || '',
        profession: row.profession || '',
        company: row.company || '',
        linkedinUrl: row.linkedinUrl || '',
        notes: row.notes || '',
        channels: {
            email: Array.isArray(row.emails) ? row.emails.filter(Boolean) : [],
            phone: Array.isArray(row.phones) ? row.phones.filter(Boolean) : []
        }
    }));
}

/**
 * Execute AppleScript and parse results.
 */
function ingestContacts() {
    return new Promise((resolve, reject) => {
        (async () => {
            updateStatus({
                state: 'running',
                progress: 0,
                processed: 0,
                total: 0,
                message: 'Reading Apple Contacts...'
            });
            const newContactsData = await exportContactsNative();

            updateStatus({
                state: 'running',
                progress: 40,
                message: `Merging ${newContactsData.length} contacts into Reply...`,
                total: newContactsData.length
            });

            mergeWithExisting(newContactsData).then(() => {
                updateStatus({
                    state: 'idle',
                    progress: 100,
                    message: `Contacts sync complete. ${newContactsData.length} contacts processed.`,
                    lastSync: new Date().toISOString(),
                    total: newContactsData.length,
                    processed: newContactsData.length
                });
                resolve(newContactsData.length);
            }).catch((err) => {
                updateStatus({ state: 'error', progress: 0, message: String(err) });
                reject(err);
            });
        })().catch((error) => {
            const detail = error.stderr?.trim() || error.message;
            updateStatus({ state: 'error', progress: 0, message: `Apple Contacts export failed: ${detail}` });
            reject(`Apple Contacts export failed: ${detail}`);
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
