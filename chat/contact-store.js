const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'contacts.json');

class ContactStore {
    constructor() {
        this._contacts = [];
        this._lastMtimeMs = null;
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
                const stat = fs.statSync(DATA_FILE);
                if (this._lastMtimeMs !== null && stat.mtimeMs === this._lastMtimeMs) {
                    return; // No changes on disk
                }
                this._lastMtimeMs = stat.mtimeMs;
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
                // Also save if we found duplicates to clean the file (use _contacts to avoid getter loop)
                if (raw.length > this._contacts.length) {
                    console.log(`Deduplicated contacts: ${raw.length} -> ${this._contacts.length}`);
                    this.save();
                }
            } else {
                this._lastMtimeMs = null;
            }
        } catch (err) {
            console.error("Error loading contacts:", err);
            // DO NOT wipe _contacts if load fails to prevent wiping the file on next save
            if (!this._contacts || this._contacts.length === 0) {
                this._contacts = [];
            }
        }
    }

    save() {
        try {
            // Use internal property to avoid triggering load() recursively
            fs.writeFileSync(DATA_FILE, JSON.stringify(this._contacts, null, 2));
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
     * Get a contact by exact handle match (case-insensitive).
     * Prefer this when you already have a normalized handle string.
     * @param {string} handle
     * @returns {object|null}
     */
    getByHandle(handle) {
        if (!handle) return null;
        this.load();
        const search = String(handle).toLowerCase().trim();
        return this.contacts.find(c => c.handle && c.handle.toLowerCase().trim() === search) || null;
    }

    /**
     * Update the last contacted timestamp for a contact.
     * @param {string} identifier handle or name
     * @param {Date|string} timestamp 
     * @param {object} meta Optional metadata (e.g. { channel: 'whatsapp' })
     */
    updateLastContacted(identifier, timestamp, meta = {}) {
        if (!identifier) return;
        this.load();
        const search = identifier.toLowerCase().trim();
        const channel = (meta?.channel || meta?.lastChannel || "").toString().trim().toLowerCase();

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
                lastContacted: date.toISOString(),
                ...(channel ? { lastChannel: channel } : {})
            };
            this.contacts.push(contact);
        }

        if (!contact.lastContacted || date > new Date(contact.lastContacted)) {
            contact.lastContacted = date.toISOString();
            if (channel) contact.lastChannel = channel;
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
                kind: 'note',
                value: text,
                text: text,
                source: 'user',
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
     * Update a specific note's text.
     * @param {string} handle
     * @param {string} noteId
     * @param {string} text
     * @returns {object|null} updated note or null if not found
     */
    updateNote(handle, noteId, text) {
        this.load();
        const contact = this.findContact(handle);
        if (!contact || !Array.isArray(contact.notes)) return null;
        const note = contact.notes.find(n => n.id === noteId);
        if (!note) return null;
        const nextText = String(text ?? '');
        note.text = nextText;
        if (note.value !== undefined) note.value = nextText;
        note.editedAt = new Date().toISOString();
        this.save();
        return note;
    }

    /**
     * Add a pending suggestion to the contact.
     * @param {string} handle 
     * @param {string} type 'links', 'emails', 'phones', 'notes'
     * @param {string} content 
     */
    addSuggestion(handle, type, content) {
        this.load();
        const contact = this.findContact(handle);
        if (!contact) return;

        // Initialize suggestions array if needed
        if (!contact.pendingSuggestions) contact.pendingSuggestions = [];
        if (!contact.rejectedSuggestions) contact.rejectedSuggestions = [];

        // Check if already rejected
        if (contact.rejectedSuggestions.includes(content)) return;

        // Check if already exists in notes (simple text check)
        if (contact.notes && contact.notes.some(n => (n.text && n.text.includes(content)) || (n.value && String(n.value).includes(content)))) return;

        // Check if already exists in channels (for structured suggestions)
        if (type === 'emails' && contact.channels?.email && contact.channels.email.some(e => String(e).toLowerCase() === String(content).toLowerCase())) return;
        if (type === 'phones' && contact.channels?.phone && contact.channels.phone.some(p => String(p).replace(/\s+/g, '') === String(content).replace(/\s+/g, ''))) return;

        // Check if already pending
        if (contact.pendingSuggestions.some(s => s.content === content)) return;

        contact.pendingSuggestions.push({
            id: 'sugg-' + Date.now() + Math.random().toString(36).substr(2, 5),
            type: type,
            content: content,
            timestamp: new Date().toISOString()
        });
        this.save();
    }

    /**
     * Add a typed entry to Local Intelligence (notes log).
     * @param {string} handle
     * @param {string} kind 'note'|'link'|'email'|'phone'|'address'|'hashtag'
     * @param {string} content
     * @param {object} meta
     */
    addLocalIntelligence(handle, kind, content, meta = {}) {
        this.load();
        const contact = this.findContact(handle);
        if (!contact) return;
        if (!contact.notes || !Array.isArray(contact.notes)) contact.notes = [];

        const value = String(content ?? '').trim();
        if (!value) return;

        // Dedupe by kind+value
        const k = String(kind || 'note').toLowerCase();
        if (contact.notes.some(n => String(n.kind || 'note').toLowerCase() === k && String(n.value || n.text || '').trim() === value)) {
            return;
        }

        contact.notes.push({
            id: 'note-' + Date.now() + Math.random().toString(36).substr(2, 5),
            kind: k,
            value,
            text: value,
            timestamp: new Date().toISOString(),
            ...(meta && typeof meta === 'object' ? meta : {}),
        });
        this.save();
    }

    /**
     * Accept a suggestion: remove from pending, add to notes/profile.
     */
    acceptSuggestion(handle, suggestionId) {
        this.load();
        const contact = this.findContact(handle);
        if (!contact || !contact.pendingSuggestions) return;

        const suggestionIndex = contact.pendingSuggestions.findIndex(s => s.id === suggestionId);
        if (suggestionIndex === -1) return;

        const suggestion = contact.pendingSuggestions[suggestionIndex];

        // Remove from pending
        contact.pendingSuggestions.splice(suggestionIndex, 1);

        // Add to permanent record based on type
        if (suggestion.type === "emails" || suggestion.type === "phones") {
            if (!contact.channels) contact.channels = { phone: [], email: [] };
            if (!contact.channels.phone) contact.channels.phone = [];
            if (!contact.channels.email) contact.channels.email = [];

            if (suggestion.type === "emails") {
                const email = String(suggestion.content).trim();
                if (email && !contact.channels.email.some(e => String(e).toLowerCase() === email.toLowerCase())) {
                    contact.channels.email.push(email);
                }
                this.addLocalIntelligence(handle, 'email', email, { source: 'ai' });
            }

            if (suggestion.type === "phones") {
                const phone = String(suggestion.content).trim();
                const norm = phone.replace(/\s+/g, '');
                if (phone && !contact.channels.phone.some(p => String(p).replace(/\s+/g, '') === norm)) {
                    contact.channels.phone.push(phone);
                }
                this.addLocalIntelligence(handle, 'phone', phone, { source: 'ai' });
            }
        } else {
            const type = String(suggestion.type || 'notes').toLowerCase();
            if (type === 'links') this.addLocalIntelligence(handle, 'link', suggestion.content, { source: 'ai' });
            else if (type === 'addresses') this.addLocalIntelligence(handle, 'address', suggestion.content, { source: 'ai' });
            else if (type === 'hashtags') this.addLocalIntelligence(handle, 'hashtag', suggestion.content, { source: 'ai' });
            else this.addLocalIntelligence(handle, 'note', suggestion.content, { source: 'ai' });
        }

        this.save();
        return contact;
    }

    /**
     * Decline a suggestion: remove from pending, add to rejected list.
     */
    declineSuggestion(handle, suggestionId) {
        this.load();
        const contact = this.findContact(handle);
        if (!contact || !contact.pendingSuggestions) return;

        const suggestionIndex = contact.pendingSuggestions.findIndex(s => s.id === suggestionId);
        if (suggestionIndex === -1) return;

        const suggestion = contact.pendingSuggestions[suggestionIndex];

        // Remove from pending
        contact.pendingSuggestions.splice(suggestionIndex, 1);

        // Add content to rejected list to prevent re-suggestion
        if (!contact.rejectedSuggestions) contact.rejectedSuggestions = [];
        contact.rejectedSuggestions.push(suggestion.content);

        this.save();
        return contact;
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
        if (contact.relationship) context += `Relationship: ${contact.relationship}\n`;
        if (contact.intro) context += `Intro: ${contact.intro}\n`;
        if (contact.channels) {
            const phones = Array.isArray(contact.channels.phone) ? contact.channels.phone : [];
            const emails = Array.isArray(contact.channels.email) ? contact.channels.email : [];
            if (phones.length || emails.length) {
                context += `Channels:\n`;
                if (phones.length) context += `- Phones: ${phones.join(', ')}\n`;
                if (emails.length) context += `- Emails: ${emails.join(', ')}\n`;
            }
        }
        if (contact.notes && Array.isArray(contact.notes)) {
            const weight = (n) => {
                const src = String(n?.source || '').toLowerCase();
                if (src === 'user') return 3;
                if (src === 'ai') return 2; // accepted AI suggestions
                return 1;
            };
            const sorted = [...contact.notes].sort((a, b) => {
                const wa = weight(a);
                const wb = weight(b);
                if (wa !== wb) return wb - wa;
                return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
            });
            const top = sorted.slice(0, 30);
            context += `Local Intelligence (VERY HIGH PRIORITY; user-added first, then accepted AI; showing ${top.length}${sorted.length > top.length ? ` of ${sorted.length}` : ""}):\n`;
            top.forEach(n => {
                const kind = String(n.kind || 'note').toLowerCase();
                const src = String(n.source || '').toLowerCase();
                const label = kind === 'link' ? 'LINK'
                    : (kind === 'email' ? 'EMAIL'
                        : (kind === 'phone' ? 'PHONE'
                            : (kind === 'address' ? 'ADDRESS'
                                : (kind === 'hashtag' ? 'HASHTAG' : 'NOTE'))));
                const source = src === 'user' ? 'user' : (src === 'ai' ? 'ai-accepted' : (src ? src : ''));
                const val = (n.value ?? n.text ?? '').toString().trim();
                if (!val) return;
                context += `- ${source ? `(${source}) ` : ''}[${label}] ${val}\n`;
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
