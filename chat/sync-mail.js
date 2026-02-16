const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { addDocuments } = require('./vector-store.js');
const contactStore = require('./contact-store.js');

const MAX_BUFFER = 1024 * 1024 * 100; // 100MB for large mailboxes

function runAppleScript(script) {
    return new Promise((resolve, reject) => {
        const escapedScript = script.replace(/'/g, "'\\''");
        exec(`osascript -e '${escapedScript}'`, { maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout.trim());
        });
    });
}

/**
 * Enhanced sync script for Reply Hub v2.
 * Extracts: Date, Subject, Sender, Receiver, Content from Sent and Inbox.
 */
async function syncMail() {
    console.log("Synchronizing Apple Mail...");

    // We'll target the last 500 messages from each to keep it snappy for the POC
    const BATCH_SIZE = 500;
    const delimiter = "||MB||";
    const fieldDelimiter = "||FD||";

    const script = `
        set out to ""
        tell application "Mail"
            -- Process Sent Mailbox
            try
                set sentMsgs to (messages 1 thru ${BATCH_SIZE} of sent mailbox)
                repeat with msg in sentMsgs
                    set d to (date received of msg) as string
                    set s to (subject of msg)
                    set r to (address of (recipient 1 of msg))
                    set c to (content of msg)
                    set out to out & d & "${fieldDelimiter}" & s & "${fieldDelimiter}" & r & "${fieldDelimiter}" & "me" & "${fieldDelimiter}" & c & "${delimiter}"
                end repeat
            end try

            -- Process Inbox
            try
                set inboxMsgs to (messages 1 thru ${BATCH_SIZE} of inbox)
                repeat with msg in inboxMsgs
                    set d to (date received of msg) as string
                    set s to (subject of msg)
                    set r to (sender of msg)
                    set c to (content of msg)
                    set out to out & d & "${fieldDelimiter}" & s & "${fieldDelimiter}" & r & "${fieldDelimiter}" & "contact" & "${fieldDelimiter}" & c & "${delimiter}"
                end repeat
            end try
        end tell
        return out
    `;

    try {
        const raw = await runAppleScript(script);
        const entries = raw.split(delimiter).filter(e => e.includes(fieldDelimiter));

        console.log(`Processing ${entries.length} emails...`);

        const docs = [];

        for (const entry of entries) {
            const [date, subject, handle, direction, body] = entry.split(fieldDelimiter);
            if (!handle || !body) continue;

            const cleanHandle = handle.toLowerCase().trim();

            // 1. Update Contact Store
            contactStore.updateLastContacted(cleanHandle, date);

            // 2. Prepare Vector Document
            docs.push({
                id: `mail-${Buffer.from(date + subject + cleanHandle).toString('base64').slice(0, 16)}`,
                text: `[${date}] ${direction === 'me' ? 'Me' : cleanHandle}: Subject: ${subject}\n\n${body.slice(0, 1000)}`,
                source: 'Mail',
                path: `mailto:${cleanHandle}`
            });
        }

        if (docs.length > 0) {
            await addDocuments(docs);
            console.log("Mail sync complete.");
        }

        return docs.length;

    } catch (e) {
        console.error("Mail Sync Error:", e);
        throw e;
    }
}

if (require.main === module) {
    syncMail().then(count => console.log(`Finished. Synced ${count} emails.`));
}

module.exports = { syncMail };
