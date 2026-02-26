require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const chatUtils = require('../utils/chat-utils');

const DB_PATH = path.join(__dirname, '..', 'data', 'contacts.db');

async function run() {
    console.log(`Open DB: ${DB_PATH}`);
    if (!fs.existsSync(DB_PATH)) {
        console.error("contacts.db not found");
        process.exit(1);
    }
    const db = new sqlite3.Database(DB_PATH);

    const all = (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });

    const runSql = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

    const contacts = await all("SELECT * FROM contacts");
    const channels = await all("SELECT * FROM contact_channels WHERE type='phone'");

    console.log(`Found ${contacts.length} contacts and ${channels.length} phone channels`);

    let updatedContacts = 0;
    let updatedChannels = 0;

    for (let c of contacts) {
        if (c.handle && !c.handle.includes('@')) { // Assume handle might be a phone number
            const norm = chatUtils.normalizePhone(c.handle);
            if (norm && norm !== c.handle) {
                console.log(`Normalizing contact handle: ${c.handle} -> ${norm}`);
                try {
                    await runSql("UPDATE contacts SET handle = ? WHERE id = ?", [norm, c.id]);
                } catch (e) {
                    if (e.code === 'SQLITE_CONSTRAINT') {
                        // Handle already exists, we should merge or just skip setting it.
                        console.warn(`Could not update handle ${c.handle} to ${norm} because ${norm} already exists as a contact.`);
                    } else {
                        throw e;
                    }
                }
                updatedContacts++;
            }
        }
    }

    for (let ch of channels) {
        const norm = chatUtils.normalizePhone(ch.value);
        if (norm && norm !== ch.value) {
            console.log(`Normalizing phone channel: ${ch.value} -> ${norm}`);
            try {
                await runSql("UPDATE contact_channels SET value = ? WHERE contact_id = ? AND type = ? AND value = ?", [norm, ch.contact_id, ch.type, ch.value]);
            } catch (e) {
                if (e.code === 'SQLITE_CONSTRAINT') {
                    // Same number already bound, delete the old one
                    await runSql("DELETE FROM contact_channels WHERE contact_id = ? AND type = ? AND value = ?", [ch.contact_id, ch.type, ch.value]);
                } else {
                    throw e;
                }
            }
            updatedChannels++;
        }
    }

    console.log(`Done. Updated ${updatedContacts} contacts handles and ${updatedChannels} channels.`);
    db.close();
}

run().catch(console.error);
