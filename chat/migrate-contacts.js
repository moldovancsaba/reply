const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const JSON_PATH = path.join(__dirname, '../chat/data/contacts.json');
const DB_PATH = path.join(__dirname, '../chat/data/contacts.db');

if (!fs.existsSync(JSON_PATH)) {
    console.error("contacts.json not found.");
    process.exit(1);
}

const contacts = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    // Create Tables
    db.run(`CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        displayName TEXT,
        handle TEXT UNIQUE,
        lastContacted TEXT,
        lastChannel TEXT,
        profession TEXT,
        relationship TEXT,
        draft TEXT,
        status TEXT,
        lastMtimeMs INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS contact_channels (
        contact_id TEXT,
        type TEXT,
        value TEXT,
        PRIMARY KEY (contact_id, type, value)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS contact_notes (
        id TEXT PRIMARY KEY,
        contact_id TEXT,
        text TEXT,
        timestamp TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS contact_suggestions (
        id TEXT PRIMARY KEY,
        contact_id TEXT,
        type TEXT,
        content TEXT,
        timestamp TEXT,
        status TEXT
    )`);

    // Migration logic
    db.run("BEGIN TRANSACTION");
    const stmtContact = db.prepare("INSERT OR REPLACE INTO contacts (id, displayName, handle, lastContacted, lastChannel, profession, relationship, draft, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const stmtChannel = db.prepare("INSERT OR REPLACE INTO contact_channels (contact_id, type, value) VALUES (?, ?, ?)");
    const stmtNote = db.prepare("INSERT OR REPLACE INTO contact_notes (id, contact_id, text, timestamp) VALUES (?, ?, ?, ?)");
    const stmtSug = db.prepare("INSERT OR REPLACE INTO contact_suggestions (id, contact_id, type, content, timestamp, status) VALUES (?, ?, ?, ?, ?, ?)");

    contacts.forEach(c => {
        stmtContact.run(c.id, c.displayName, c.handle, c.lastContacted, c.lastChannel, c.profession, c.relationship, c.draft, c.status);

        if (c.channels) {
            Object.keys(c.channels).forEach(type => {
                const values = c.channels[type];
                if (Array.isArray(values)) {
                    values.forEach(v => {
                        stmtChannel.run(c.id, type, v);
                    });
                }
            });
        }

        if (c.notes) {
            c.notes.forEach(n => {
                stmtNote.run(n.id || `note-${Date.now()}-${Math.random()}`, c.id, n.text, n.timestamp);
            });
        }

        if (c.pendingSuggestions) {
            c.pendingSuggestions.forEach(s => {
                stmtSug.run(s.id, c.id, s.type, s.content, s.timestamp, 'pending');
            });
        }

        if (c.rejectedSuggestions) {
            c.rejectedSuggestions.forEach(s => {
                const sid = typeof s === 'string' ? `rej-${Date.now()}-${Math.random()}` : s.id;
                const content = typeof s === 'string' ? s : s.content;
                stmtSug.run(sid, c.id, 'rejected_text', content, new Date().toISOString(), 'rejected');
            });
        }
    });

    stmtContact.finalize();
    stmtChannel.finalize();
    stmtNote.finalize();
    stmtSug.finalize();
    db.run("COMMIT", (err) => {
        if (err) console.error("Migration failed:", err);
        else console.log(`Migrated ${contacts.length} contacts to SQLite.`);
        db.close();
    });
});
