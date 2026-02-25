const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.REPLY_CONTACTS_DB_PATH || path.join(__dirname, 'data', 'contacts.db');

class ContactStore {
    constructor() {
        this._contacts = [];
        this._lastMtimeMs = null;
        this._db = new sqlite3.Database(DB_PATH);
        this._readyPromise = this._initDb();
    }

    async _initDb() {
        return new Promise((resolve) => {
            this._db.serialize(() => {
                this._db.run("PRAGMA journal_mode = WAL");
                this._db.run("PRAGMA busy_timeout = 5000");
                this._db.run(`CREATE TABLE IF NOT EXISTS contacts (
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
                this._db.run(`CREATE TABLE IF NOT EXISTS contact_channels (
                    contact_id TEXT,
                    type TEXT,
                    value TEXT,
                    PRIMARY KEY (contact_id, type, value)
                )`);
                this._db.run(`CREATE TABLE IF NOT EXISTS contact_notes (
                    id TEXT PRIMARY KEY,
                    contact_id TEXT,
                    text TEXT,
                    timestamp TEXT
                )`);
                this._db.run(`CREATE TABLE IF NOT EXISTS contact_suggestions (
                    id TEXT PRIMARY KEY,
                    contact_id TEXT,
                    type TEXT,
                    content TEXT,
                    timestamp TEXT,
                    status TEXT
                )`);
                this.refresh().then(resolve);
            });
        });
    }

    async waitUntilReady() {
        return this._readyPromise;
    }

    get contacts() {
        return this._contacts;
    }

    async refresh() {
        return new Promise((resolve, reject) => {
            this._db.all("SELECT * FROM contacts", (err, rows) => {
                if (err) return reject(err);

                this._db.all("SELECT * FROM contact_channels", (err, channels) => {
                    if (err) return reject(err);
                    this._db.all("SELECT * FROM contact_notes", (err, notes) => {
                        if (err) return reject(err);
                        this._db.all("SELECT * FROM contact_suggestions", (err, sugs) => {
                            if (err) return reject(err);

                            const hydrated = (rows || []).map(c => {
                                const contact = { ...c };
                                contact.channels = { phone: [], email: [] };
                                if (channels) {
                                    channels.filter(ch => ch.contact_id === c.id).forEach(ch => {
                                        if (!contact.channels[ch.type]) contact.channels[ch.type] = [];
                                        contact.channels[ch.type].push(ch.value);
                                    });
                                }
                                contact.notes = (notes || []).filter(n => n.contact_id === c.id);
                                contact.pendingSuggestions = (sugs || []).filter(s => s.contact_id === c.id && s.status === 'pending');
                                contact.rejectedSuggestions = (sugs || []).filter(s => s.contact_id === c.id && s.status === 'rejected').map(s => s.content);
                                return contact;
                            });

                            this._contacts = hydrated;
                            resolve(hydrated);
                        });
                    });
                });
            });
        });
    }

    async saveContact(contact) {
        return this.saveContacts([contact]);
    }

    async saveContacts(contacts) {
        if (!contacts || contacts.length === 0) return;
        return new Promise((resolve, reject) => {
            this._db.serialize(() => {
                this._db.run("BEGIN TRANSACTION");
                let hasError = false;
                const handleError = (err) => {
                    if (err) {
                        hasError = true;
                        console.error("Database error in transaction:", err.message);
                    }
                };

                contacts.forEach(contact => {
                    this._db.run(`
                        INSERT INTO contacts (id, displayName, handle, lastContacted, lastChannel, profession, relationship, draft, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(handle) DO UPDATE SET
                            displayName = COALESCE(NULLIF(?, ''), displayName),
                            lastContacted = COALESCE(?, lastContacted),
                            lastChannel = COALESCE(NULLIF(?, ''), lastChannel),
                            profession = COALESCE(NULLIF(?, ''), profession),
                            relationship = COALESCE(NULLIF(?, ''), relationship),
                            draft = COALESCE(NULLIF(?, ''), draft),
                            status = COALESCE(NULLIF(?, ''), status)
                    `,
                        [
                            contact.id, contact.displayName, contact.handle, contact.lastContacted, contact.lastChannel, contact.profession, contact.relationship, contact.draft, contact.status,
                            contact.displayName, contact.lastContacted, contact.lastChannel, contact.profession, contact.relationship, contact.draft, contact.status
                        ],
                        handleError
                    );

                    if (contact.channels) {
                        this._db.run("DELETE FROM contact_channels WHERE contact_id = ?", [contact.id], handleError);
                        Object.keys(contact.channels).forEach(type => {
                            const values = contact.channels[type];
                            if (Array.isArray(values)) {
                                values.forEach(v => {
                                    this._db.run("INSERT OR REPLACE INTO contact_channels (contact_id, type, value) VALUES (?, ?, ?)",
                                        [contact.id, type, v],
                                        handleError
                                    );
                                });
                            }
                        });
                    }
                });

                if (hasError) {
                    this._db.run("ROLLBACK", () => {
                        reject(new Error("Transaction failed and was rolled back"));
                    });
                    return;
                }

                this._db.run("COMMIT", (err) => {
                    if (err) {
                        console.error("COMMIT failed:", err.message);
                        this._db.run("ROLLBACK");
                        return reject(err);
                    }
                    this.refresh().then(resolve).catch(reject);
                });
            });
        });
    }

    findContact(identifier) {
        if (!identifier) return null;
        const search = identifier.toLowerCase().trim();

        return this._contacts.find(c => {
            if (c.handle && c.handle.toLowerCase() === search) return true;
            if (c.displayName && c.displayName.toLowerCase() === search) return true;
            if (c.channels) {
                for (const type in c.channels) {
                    const values = c.channels[type];
                    if (Array.isArray(values) && values.some(v => v.toLowerCase() === search)) return true;
                }
            }
            return false;
        });
    }

    getByHandle(handle) {
        if (!handle) return null;
        const search = String(handle).toLowerCase().trim();
        return this._contacts.find(c => c.handle && c.handle.toLowerCase().trim() === search) || null;
    }

    async updateContact(handle, data) {
        await this.waitUntilReady();
        // Force refresh to ensure we have the latest ground-truth before updating
        await this.refresh();

        let contact = this.findContact(handle);
        if (!contact) {
            contact = {
                id: 'id-' + Math.random().toString(36).substr(2, 9),
                handle: handle,
                displayName: handle,
                lastContacted: new Date().toISOString(),
                status: 'open',
                channels: { phone: [], email: [] }
            };
            if (handle.includes('@')) contact.channels.email.push(handle);
            else if (/^\+?\d+$/.test(handle)) contact.channels.phone.push(handle);
            this._contacts.push(contact);
        }
        Object.assign(contact, data);
        await this.saveContact(contact);
        return contact;
    }

    async updateLastContacted(handle, timestamp, meta = {}) {
        await this.updateLastContactedBatch([{ handle, timestamp, meta }]);
    }

    async updateLastContactedBatch(updates) {
        await this.waitUntilReady();
        const toSaveMap = new Map();
        for (const update of updates) {
            const { handle, timestamp, meta } = update;
            if (!handle) continue;

            let contact = this.findContact(handle);
            const date = new Date(timestamp);
            const channel = meta.channel || meta.lastChannel || "";

            if (!contact) {
                contact = toSaveMap.get(handle);
                if (!contact) {
                    contact = {
                        id: 'id-' + Math.random().toString(36).substr(2, 9),
                        handle: handle,
                        displayName: handle,
                        lastContacted: date.toISOString(),
                        lastChannel: channel,
                        status: 'open',
                        channels: { phone: [], email: [] }
                    };
                    if (handle.includes('@')) contact.channels.email.push(handle);
                    else if (/^\+?\d+$/.test(handle)) contact.channels.phone.push(handle);

                    this._contacts.push(contact);
                    toSaveMap.set(handle, contact);
                }
            }

            if (date > new Date(contact.lastContacted || 0)) {
                contact.lastContacted = date.toISOString();
                if (channel) contact.lastChannel = channel;
                toSaveMap.set(handle, contact);
            }
        }

        const toSave = Array.from(toSaveMap.values());
        if (toSave.length > 0) {
            await this.saveContacts(toSave);
        }
    }

    async setDraft(handle, text) {
        await this.waitUntilReady();
        const contact = this.findContact(handle);
        if (contact) {
            contact.draft = text;
            contact.status = text ? "draft" : "open";
            await this.saveContact(contact);
        }
    }

    async clearDraft(handle) {
        await this.setDraft(handle, null);
    }

    async addNote(handle, text) {
        const contact = this.findContact(handle);
        if (contact) {
            const noteId = 'note-' + Date.now() + Math.random().toString(36).substr(2, 5);
            return new Promise((resolve, reject) => {
                this._db.run("INSERT INTO contact_notes (id, contact_id, text, timestamp) VALUES (?, ?, ?, ?)",
                    noteId, contact.id, text, new Date().toISOString(), (err) => {
                        if (err) return reject(err);
                        this.refresh().then(resolve).catch(reject);
                    });
            });
        }
    }

    async deleteNote(handle, noteId) {
        return new Promise((resolve, reject) => {
            this._db.run("DELETE FROM contact_notes WHERE id = ?", noteId, (err) => {
                if (err) return reject(err);
                this.refresh().then(resolve).catch(reject);
            });
        });
    }

    getAllHandles(identifier) {
        const contact = this.findContact(identifier);
        if (!contact) return [identifier];
        const handles = new Set();
        if (contact.handle) handles.add(contact.handle);
        if (contact.channels) {
            for (const type in contact.channels) {
                const values = contact.channels[type];
                if (Array.isArray(values)) values.forEach(h => handles.add(h));
            }
        }
        return Array.from(handles);
    }

    getProfileContext(identifier) {
        const contact = this.findContact(identifier);
        if (!contact) return "";

        let context = `\n\n[IDENTITY CONTEXT]\n`;
        context += `You are talking to: ${contact.displayName}\n`;
        if (contact.profession) context += `Profession: ${contact.profession}\n`;
        if (contact.relationship) context += `Relationship: ${contact.relationship}\n`;

        if (contact.notes && contact.notes.length) {
            context += `Notes:\n`;
            contact.notes.forEach(n => context += `- ${n.text}\n`);
        }
        return context;
    }

    async setPendingKYC(handle, suggestions) {
        const contact = this.findContact(handle);
        if (contact) {
            contact.pendingKYC = suggestions;
            await this.saveContact(contact);
        }
    }

    async clearPendingKYC(handle) {
        const contact = this.findContact(handle);
        if (contact) {
            delete contact.pendingKYC;
            await this.saveContact(contact);
        }
    }

    async updateStatus(handle, status) {
        const contact = this.findContact(handle);
        if (contact) {
            contact.status = status;
            await this.saveContact(contact);
        }
    }

    async updateNote(handle, noteId, text) {
        return new Promise((resolve, reject) => {
            this._db.run("UPDATE contact_notes SET text = ? WHERE id = ?", text, noteId, (err) => {
                if (err) return reject(err);
                this.refresh().then(resolve).catch(reject);
            });
        });
    }

    async addSuggestion(handle, type, content) {
        const contact = this.findContact(handle);
        if (!contact) return;
        if (contact.pendingSuggestions && contact.pendingSuggestions.some(s => s.content === content)) return;
        if (contact.rejectedSuggestions && contact.rejectedSuggestions.includes(content)) return;

        return new Promise((resolve, reject) => {
            const id = 'sugg-' + Date.now() + Math.random().toString(36).substr(2, 5);
            this._db.run("INSERT INTO contact_suggestions (id, contact_id, type, content, timestamp, status) VALUES (?, ?, ?, ?, ?, ?)",
                id, contact.id, type, content, new Date().toISOString(), 'pending', (err) => {
                    if (err) return reject(err);
                    this.refresh().then(resolve).catch(reject);
                });
        });
    }

    async acceptSuggestion(handle, suggestionId) {
        return new Promise((resolve, reject) => {
            this._db.run("UPDATE contact_suggestions SET status = 'accepted' WHERE id = ?", suggestionId, (err) => {
                if (err) return reject(err);
                this.refresh().then(resolve).catch(reject);
            });
        });
    }

    async declineSuggestion(handle, suggestionId) {
        return new Promise((resolve, reject) => {
            this._db.run("UPDATE contact_suggestions SET status = 'rejected' WHERE id = ?", suggestionId, (err) => {
                if (err) return reject(err);
                this.refresh().then(resolve).catch(reject);
            });
        });
    }

    async getStats() {
        const stats = {
            total: this._contacts.length,
            draft: 0,
            active: 0,
            resolved: 0,
            byChannel: {
                linkedin: 0,
                email: 0,
                whatsapp: 0,
                imessage: 0,
                apple_contacts: 0
            }
        };

        this._contacts.forEach(c => {
            if (c.status === 'draft') stats.draft++;
            else if (c.status === 'closed') stats.resolved++;
            else stats.active++;

            let hasInboundChannel = false;
            if (c.channels) {
                if ((c.channels.linkedin && c.channels.linkedin.length > 0) ||
                    (c.handle && c.handle.startsWith('linkedin://'))) {
                    stats.byChannel.linkedin++;
                    hasInboundChannel = true;
                }
                if (c.channels.email && c.channels.email.length > 0) {
                    stats.byChannel.email++;
                    hasInboundChannel = true;
                }
                // Check both 'whatsapp' and 'phone' keys
                if ((c.channels.whatsapp && c.channels.whatsapp.length > 0) ||
                    (c.channels.phone && c.channels.phone.length > 0)) {
                    stats.byChannel.whatsapp++;
                    hasInboundChannel = true;
                }
                if (c.channels.imessage && c.channels.imessage.length > 0) {
                    stats.byChannel.imessage++;
                    hasInboundChannel = true;
                }
            }

            if (!hasInboundChannel) {
                stats.byChannel.apple_contacts++;
            }
        });
        return stats;
    }
}

module.exports = new ContactStore();
