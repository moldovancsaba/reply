const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'contacts.json');

class ContactStore {
    constructor() {
        this._contacts = [];
        this.load();
    }

    get contacts() {
        this.load();
        return this._contacts;
    }

    set contacts(val) {
        this._contacts = val;
    }

    load() {
        try {
            if (fs.existsSync(DATA_FILE)) {
                const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                // Deduplicate by handle on load
                const merged = {};
                raw.forEach(c => {
                    if (!c.handle && !c.displayName) return;

                    // Migration: Convert string notes to array
                    if (c.notes && typeof c.notes === 'string') {
                        c.notes = [{
                            id: 'note-' + Date.now() + Math.random().toString(36).substr(2, 5),
                            text: c.notes,
                            timestamp: c.lastContacted || new Date().toISOString()
                        }];
                    } else if (!c.notes) {
                        c.notes = [];
                    }

                    const key = (c.handle || c.displayName).toLowerCase().trim();
                    if (!merged[key]) {
                        merged[key] = c;
                    } else {
                        // Intelligent merge: preserve existing values if new ones are empty
                        const existing = merged[key];
                        if (!existing.profession && c.profession) existing.profession = c.profession;
                        if (!existing.relationship && c.relationship) existing.relationship = c.relationship;

                        // Merge notes arrays
                        if (c.notes && Array.isArray(c.notes)) {
                            if (!existing.notes) existing.notes = [];
                            c.notes.forEach(newNote => {
                                if (!existing.notes.some(en => en.text === newNote.text)) {
                                    existing.notes.push(newNote);
                                }
                            });
                        }

                        if (c.draft && !existing.draft) existing.draft = c.draft;
                        if (c.status === 'draft' && existing.status !== 'draft') existing.status = 'draft';
                        if ((!existing.lastContacted || new Date(c.lastContacted) > new Date(existing.lastContacted)) && c.lastContacted) {
                            existing.lastContacted = c.lastContacted;
                        }
                        // Merge channels
                        if (c.channels) {
                            if (!existing.channels) existing.channels = { phone: [], email: [] };
                            if (c.channels.phone) {
                                c.channels.phone.forEach(p => { if (!existing.channels.phone.includes(p)) existing.channels.phone.push(p); });
                            }
                            if (c.channels.email) {
                                c.channels.email.forEach(e => { if (!existing.channels.email.includes(e)) existing.channels.email.push(e); });
                            }
                        }
                    }
                });
                this._contacts = Object.values(merged);
                // Also save if we found duplicates to clean the file
                if (raw.length > this._contacts.length) {
                    this.save();
                }
            }
        } catch (err) {
            console.error("Error loading contacts:", err);
            this._contacts = [];
        }
    }

    save() {
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(this.contacts, null, 2));
        } catch (err) {
            console.error("Error saving contacts:", err);
        }
    }

    /**
     * Find a contact by name, alias, or email.
     * @param {string} identifier 
     * @returns {object|null}
     */
    findContact(identifier) {
        if (!identifier) return null;
        this.load(); // Reload to get latest from other processes
        const search = identifier.toLowerCase().trim();

        return this.contacts.find(c => {
            // 1. Check Handle (Exact)
            if (c.handle && c.handle.toLowerCase() === search) return true;

            // 2. Check Display Name (Exact)
            if (c.displayName && c.displayName.toLowerCase() === search) return true;

            // 3. Check Aliases (Exact)
            if (c.aliases && c.aliases.some(a => a.toLowerCase() === search)) return true;

            // 4. Check Channels (Exact)
            if (c.channels) {
                if (c.channels.email && c.channels.email.some(e => e.toLowerCase() === search)) return true;
                if (c.channels.phone && c.channels.phone.some(p => p.toLowerCase() === search)) return true;
                // Basic handle check inside channels as well
                if (c.channels.phone && c.channels.phone.some(p => p.replace(/\s+/g, '').includes(search.replace(/\s+/g, '')))) return true;
            }

            return false;
        });
    }

    /**
     * Update the last contacted timestamp for a contact.
     * @param {string} identifier handle or name
     * @param {Date|string} timestamp 
     */
    updateLastContacted(identifier, timestamp) {
        if (!identifier) return;
        this.load();
        const search = identifier.toLowerCase().trim();

        // Try exact handle match first to avoid findContact's broader search logic
        let contact = this.contacts.find(c => c.handle && c.handle.toLowerCase() === search);

        if (!contact) {
            contact = this.findContact(identifier);
        }

        const date = new Date(timestamp);

        if (!contact) {
            // Auto-create contact for new handle
            const isEmail = identifier.includes('@');
            contact = {
                id: 'id-' + Math.random().toString(36).substr(2, 9),
                displayName: identifier,
                handle: identifier,
                channels: isEmail ? { email: [identifier] } : { phone: [identifier] },
                lastContacted: date.toISOString()
            };
            this.contacts.push(contact);
        }

        if (!contact.lastContacted || date > new Date(contact.lastContacted)) {
            contact.lastContacted = date.toISOString();
        }
        this.save();
    }

    /**
     * Update an existing contact with new data.
     * @param {string} handle 
     * @param {object} data 
     */
    updateContact(handle, data) {
        this.load();
        let contact = this.findContact(handle);
        if (!contact) {
            // Create new contact if it doesn't exist
            contact = {
                id: Date.now().toString(),
                handle: handle,
                displayName: handle,
                lastContacted: new Date().toISOString()
            };
            this.contacts.push(contact);
        }

        Object.assign(contact, data);
        this.save();
        return contact;
    }

    setDraft(handle, text) {
        this.load();
        const contact = this.findContact(handle);
        if (contact) {
            contact.draft = text;
            contact.status = text ? "draft" : "open";
            this.save();
        }
    }

    clearDraft(handle) {
        this.setDraft(handle, null);
    }

    setPendingKYC(handle, suggestions) {
        this.load();
        const contact = this.findContact(handle);
        if (contact) {
            contact.pendingKYC = suggestions;
            this.save();
        }
    }

    clearPendingKYC(handle) {
        const contact = this.findContact(handle);
        if (contact) {
            delete contact.pendingKYC;
            this.save();
        }
    }

    getAllHandles(identifier) {
        this.load();
        const contact = this.findContact(identifier);
        if (!contact) return [identifier];

        const handles = new Set();
        if (contact.handle) handles.add(contact.handle);
        if (contact.channels) {
            if (contact.channels.phone) contact.channels.phone.forEach(h => handles.add(h));
            if (contact.channels.email) contact.channels.email.forEach(h => handles.add(h));
        }
        return Array.from(handles);
    }

    /**
     * Add a timestamped note to a contact.
     * @param {string} handle 
     * @param {string} text 
     */
    addNote(handle, text) {
        this.load();
        const contact = this.findContact(handle);
        if (contact) {
            if (!contact.notes || !Array.isArray(contact.notes)) contact.notes = [];
            contact.notes.push({
                id: 'note-' + Date.now() + Math.random().toString(36).substr(2, 5),
                text: text,
                timestamp: new Date().toISOString()
            });
            this.save();
        }
    }

    /**
     * Delete a specific note by ID.
     * @param {string} handle 
     * @param {string} noteId 
     */
    deleteNote(handle, noteId) {
        this.load();
        const contact = this.findContact(handle);
        if (contact && contact.notes) {
            contact.notes = contact.notes.filter(n => n.id !== noteId);
            this.save();
        }
    }

    /**
     * Manually override the contact status.
     * @param {string} handle 
     * @param {string} status 'open', 'draft', or 'closed'
     */
    updateStatus(handle, status) {
        this.load();
        const contact = this.findContact(handle);
        if (contact) {
            contact.status = status;
            // If setting back to active/open, we might want to preserve the draft or clear it?
            // User said "change status from orange back to green", usually implies they won't use that draft.
            this.save();
        }
    }

    /**
     * Get formatted context for the LLM.
     * @param {string} identifier 
     */
    getProfileContext(identifier) {
        const contact = this.findContact(identifier);
        if (!contact) return "";

        let context = `\n\n[IDENTITY CONTEXT]\n`;
        context += `You are talking to: ${contact.displayName}\n`;
        if (contact.profession) context += `Profession: ${contact.profession}\n`;
        if (contact.intro) context += `Intro: ${contact.intro}\n`;
        if (contact.notes && Array.isArray(contact.notes)) {
            context += `Notes (Latest first):\n`;
            [...contact.notes].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).forEach(n => {
                context += `- [${n.timestamp}] ${n.text}\n`;
            });
        }

        return context;
    }
    /**
     * Get aggregate statistics about the contact database.
     */
    getStats() {
        this.load();
        const stats = {
            total: this.contacts.length,
            draft: 0,
            active: 0,
            resolved: 0
        };

        this.contacts.forEach(c => {
            if (c.status === 'draft') stats.draft++;
            else if (c.status === 'closed') stats.resolved++;
            else stats.active++;
        });

        return stats;
    }
}

module.exports = new ContactStore();
