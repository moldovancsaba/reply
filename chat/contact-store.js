const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { ensureDataHome, dataPath } = require('./app-paths.js');

ensureDataHome();
const DB_PATH = process.env.REPLY_CONTACTS_DB_PATH || dataPath('contacts.db');
const CONTACT_STORE_REFRESH_TTL_MS = Math.max(
    0,
    parseInt(process.env.REPLY_CONTACTS_REFRESH_TTL_MS || '5000', 10) || 5000
);
const CONTACT_VISIBILITY_STATES = new Set(["active", "archived", "removed", "blocked"]);

function normalizeVisibilityState(value, fallback = "active") {
    const state = String(value || "").trim().toLowerCase();
    return CONTACT_VISIBILITY_STATES.has(state) ? state : fallback;
}

function readStoreChangeStamp() {
    const candidates = [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`];
    let latest = 0;
    for (const file of candidates) {
        try {
            const stat = fs.statSync(file);
            latest = Math.max(latest, stat.mtimeMs || 0, stat.size || 0);
        } catch {
            // Ignore absent files.
        }
    }
    return latest;
}

class ContactStore {
    constructor() {
        this._contacts = [];
        this._lastMtimeMs = null;
        this._lastRefreshAtMs = 0;
        this._contactsById = new Map();
        this._contactsByHandle = new Map();
        this._contactsByLookup = new Map();
        try {
            const dir = path.dirname(DB_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        } catch (e) {
            console.error('[contact-store] Could not create data directory:', e.message);
        }
        this._db = new sqlite3.Database(DB_PATH);
        this._db.on('error', (err) => {
            console.error('[contact-store] SQLite error:', err.message);
        });
        this._readyPromise = this._initDb();
    }

    async _initDb() {
        return new Promise((resolve) => {
            this._db.serialize(() => {
                this._db.run("PRAGMA journal_mode = WAL");
                this._db.run("PRAGMA busy_timeout = 5000");
                this._db.run("PRAGMA synchronous = NORMAL");
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
                    lastMtimeMs INTEGER,
                    primary_contact_id TEXT,
                    visibility_state TEXT,
                    visibility_changed_at TEXT
                )`);
                this._db.run("ALTER TABLE contacts ADD COLUMN primary_contact_id TEXT", () => {
                    // Ignore expected error if column already exists
                });
                this._db.run("ALTER TABLE contacts ADD COLUMN company TEXT", () => { });
                this._db.run("ALTER TABLE contacts ADD COLUMN linkedinUrl TEXT", () => { });
                this._db.run("ALTER TABLE contacts ADD COLUMN intro TEXT", () => { });
                this._db.run("ALTER TABLE contacts ADD COLUMN visibility_state TEXT", () => { });
                this._db.run("ALTER TABLE contacts ADD COLUMN visibility_changed_at TEXT", () => { });
                this._db.run(`CREATE TABLE IF NOT EXISTS contact_channels (
                    contact_id TEXT,
                    type TEXT,
                    value TEXT,
                    inbound_verified_at TEXT,
                    PRIMARY KEY (contact_id, type, value)
                )`);
                this._db.run("ALTER TABLE contact_channels ADD COLUMN inbound_verified_at TEXT", () => {
                    // Ignore expected error if column already exists
                });
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
        this._lastRefreshAtMs = Date.now();
        return new Promise((resolve, reject) => {
            this._db.all("SELECT * FROM contacts", (err, rows) => {
                if (err) return reject(err);

                this._db.all("SELECT * FROM contact_channels", (err, channels) => {
                    if (err) return reject(err);
                    this._db.all("SELECT * FROM contact_notes", (err, notes) => {
                        if (err) return reject(err);
                        this._db.all("SELECT * FROM contact_suggestions", (err, sugs) => {
                            if (err) return reject(err);

                            const channelsByContact = new Map();
                            for (const ch of channels || []) {
                                if (!ch?.contact_id) continue;
                                const list = channelsByContact.get(ch.contact_id) || [];
                                list.push(ch);
                                channelsByContact.set(ch.contact_id, list);
                            }

                            const notesByContact = new Map();
                            for (const note of notes || []) {
                                if (!note?.contact_id) continue;
                                const list = notesByContact.get(note.contact_id) || [];
                                list.push(note);
                                notesByContact.set(note.contact_id, list);
                            }

                            const suggestionsByContact = new Map();
                            for (const sug of sugs || []) {
                                if (!sug?.contact_id) continue;
                                const list = suggestionsByContact.get(sug.contact_id) || [];
                                list.push(sug);
                                suggestionsByContact.set(sug.contact_id, list);
                            }

                            const hydrated = (rows || []).map(c => {
                                const contact = { ...c };
                                contact.visibility_state = normalizeVisibilityState(contact.visibility_state);
                                contact.visibility_changed_at = contact.visibility_changed_at || null;
                                contact.visibilityState = contact.visibility_state;
                                contact.channels = { phone: [], email: [] };
                                contact.verifiedChannels = {};
                                const contactChannels = channelsByContact.get(c.id) || [];
                                for (const ch of contactChannels) {
                                    if (!contact.channels[ch.type]) contact.channels[ch.type] = [];
                                    contact.channels[ch.type].push(ch.value);
                                    if (ch.inbound_verified_at) {
                                        contact.verifiedChannels[ch.value] = ch.inbound_verified_at;
                                    }
                                }
                                contact.notes = (notesByContact.get(c.id) || [])
                                    .map((n) => {
                                        const raw = String(n.text || "");
                                        try {
                                            const o = JSON.parse(raw);
                                            if (o && typeof o === "object" && o.kind && typeof o.text === "string") {
                                                return {
                                                    ...n,
                                                    kind: String(o.kind).toLowerCase(),
                                                    text: o.text,
                                                    value: o.text
                                                };
                                            }
                                        } catch {
                                            /* plain */
                                        }
                                        return { ...n, kind: "note", text: raw, value: raw };
                                    });
                                const contactSuggestions = suggestionsByContact.get(c.id) || [];
                                contact.pendingSuggestions = contactSuggestions.filter(s => s.status === 'pending');
                                contact.rejectedSuggestions = contactSuggestions
                                    .filter(s => s.status === 'rejected')
                                    .map(s => s.content);
                                return contact;
                            });

                            const contactsById = new Map();
                            for (const contact of hydrated) {
                                if (contact?.id) contactsById.set(contact.id, contact);
                            }

                            const contactsByHandle = new Map();
                            const contactsByLookup = new Map();
                            const addLookup = (raw, canonical) => {
                                const key = String(raw || '').trim().toLowerCase();
                                if (!key || contactsByLookup.has(key)) return;
                                contactsByLookup.set(key, canonical);
                            };

                            for (const contact of hydrated) {
                                const canonical =
                                    (contact.primary_contact_id && contactsById.get(contact.primary_contact_id)) ||
                                    contact;
                                const handleKey = String(contact.handle || '').trim().toLowerCase();
                                if (handleKey && !contactsByHandle.has(handleKey)) {
                                    contactsByHandle.set(handleKey, contact);
                                }
                                addLookup(contact.handle, canonical);
                                addLookup(contact.displayName, canonical);
                                if (contact.channels) {
                                    for (const type in contact.channels) {
                                        const values = contact.channels[type];
                                        if (!Array.isArray(values)) continue;
                                        for (const value of values) addLookup(value, canonical);
                                    }
                                }
                            }

                            this._contacts = hydrated;
                            this._contactsById = contactsById;
                            this._contactsByHandle = contactsByHandle;
                            this._contactsByLookup = contactsByLookup;
                            this._lastMtimeMs = readStoreChangeStamp();
                            resolve(hydrated);
                        });
                    });
                });
            });
        });
    }

    async refreshIfChanged(maxAgeMs = CONTACT_STORE_REFRESH_TTL_MS) {
        const now = Date.now();
        const stamp = readStoreChangeStamp();
        const cacheFresh =
            this._contacts.length > 0 &&
            this._lastMtimeMs != null &&
            stamp === this._lastMtimeMs &&
            (now - this._lastRefreshAtMs) < maxAgeMs;

        if (cacheFresh) {
            return this._contacts;
        }

        return this.refresh();
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
                    const hasVisibilityState =
                        contact.visibility_state != null || contact.visibilityState != null;
                    const visibilityState = hasVisibilityState
                        ? normalizeVisibilityState(contact.visibility_state || contact.visibilityState)
                        : null;
                    this._db.run(`
                        INSERT INTO contacts (id, displayName, handle, lastContacted, lastChannel, profession, relationship, draft, status, primary_contact_id, company, linkedinUrl, intro, visibility_state, visibility_changed_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(handle) DO UPDATE SET
                            displayName = COALESCE(NULLIF(?, ''), displayName),
                            lastContacted = COALESCE(?, lastContacted),
                            lastChannel = COALESCE(NULLIF(?, ''), lastChannel),
                            profession = COALESCE(NULLIF(?, ''), profession),
                            relationship = COALESCE(NULLIF(?, ''), relationship),
                            draft = COALESCE(NULLIF(?, ''), draft),
                            status = COALESCE(NULLIF(?, ''), status),
                            primary_contact_id = COALESCE(NULLIF(?, ''), primary_contact_id),
                            company = COALESCE(NULLIF(?, ''), company),
                            linkedinUrl = COALESCE(NULLIF(?, ''), linkedinUrl),
                            intro = COALESCE(NULLIF(?, ''), intro),
                            visibility_state = COALESCE(NULLIF(?, ''), visibility_state),
                            visibility_changed_at = COALESCE(?, visibility_changed_at)
                    `,
                        [
                            contact.id, contact.displayName, contact.handle, contact.lastContacted, contact.lastChannel, contact.profession, contact.relationship, contact.draft, contact.status, contact.primary_contact_id, contact.company, contact.linkedinUrl, contact.intro,
                            visibilityState,
                            contact.visibility_changed_at || null,
                            contact.displayName, contact.lastContacted, contact.lastChannel, contact.profession, contact.relationship, contact.draft, contact.status, contact.primary_contact_id, contact.company, contact.linkedinUrl, contact.intro,
                            visibilityState,
                            contact.visibility_changed_at || null
                        ],
                        (err) => {
                            if (err) handleError(err);
                            else if (contact.company || contact.linkedinUrl) {
                                console.log(`[ContactStore] Saved KYC for ${contact.handle}: ${contact.company}, ${contact.linkedinUrl}`);
                            }
                        }
                    );

                    if (contact.channels) {
                        this._db.run("DELETE FROM contact_channels WHERE contact_id = ?", [contact.id], handleError);
                        Object.keys(contact.channels).forEach(type => {
                            const values = contact.channels[type];
                            if (Array.isArray(values)) {
                                values.forEach(v => {
                                    const verifiedAt = contact.verifiedChannels && contact.verifiedChannels[v] ? contact.verifiedChannels[v] : null;
                                    this._db.run("INSERT OR REPLACE INTO contact_channels (contact_id, type, value, inbound_verified_at) VALUES (?, ?, ?, ?)",
                                        [contact.id, type, v, verifiedAt],
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

    /**
     * Raw row lookup (no `primary_contact_id` follow). Used for merge/alias APIs (reply#19).
     * @param {string} id
     * @returns {object|null}
     */
    findById(id) {
        if (!id) return null;
        return this._contactsById.get(id) || null;
    }

    /** Match on `handle` column only (no alias resolution). Used by merge API (reply#19). */
    getContactRowByHandle(handle) {
        const search = String(handle || "").trim().toLowerCase();
        if (!search) return null;
        return this._contactsByHandle.get(search) || null;
    }

    /**
     * Contacts linked to this canonical profile (`primary_contact_id` pointer).
     * @param {string} canonicalId - Primary row `id`
     */
    listAliasesForCanonical(canonicalId) {
        if (!canonicalId) return [];
        return this._contacts.filter((c) => c.primary_contact_id === canonicalId);
    }

    /**
     * Clears `primary_contact_id` on one merged row (rollback link, not channel move) — reply#19.
     * @param {string} aliasContactId - SQLite row id of the alias profile
     */
    async unlinkAlias(aliasContactId) {
        const row = this.findById(aliasContactId);
        if (!row || !row.primary_contact_id) {
            throw new Error("Contact is not a linked alias");
        }
        return new Promise((resolve, reject) => {
            this._db.run(
                "UPDATE contacts SET primary_contact_id = NULL WHERE id = ?",
                [aliasContactId],
                (err) => {
                    if (err) return reject(err);
                    this.refresh().then(resolve).catch(reject);
                }
            );
        });
    }

    findContact(identifier) {
        if (!identifier) return null;
        const search = String(identifier).toLowerCase().trim();
        return this._contactsByLookup.get(search) || null;
    }

    isVisibleInInbox(identifier) {
        const contact = typeof identifier === "object" && identifier
            ? identifier
            : this.findContact(identifier);
        if (!contact) return true;
        return normalizeVisibilityState(contact.visibility_state || contact.visibilityState) === "active";
    }

    shouldUseForAnnotation(identifier) {
        const contact = typeof identifier === "object" && identifier
            ? identifier
            : this.findContact(identifier);
        if (!contact) return true;
        return normalizeVisibilityState(contact.visibility_state || contact.visibilityState) !== "blocked";
    }

    listHiddenContacts() {
        return this._contacts
            .filter((contact) => !this.isVisibleInInbox(contact))
            .sort((a, b) => {
                const da = a.visibility_changed_at ? new Date(a.visibility_changed_at).getTime() : 0;
                const db = b.visibility_changed_at ? new Date(b.visibility_changed_at).getTime() : 0;
                return db - da;
            });
    }

    getByHandle(handle) {
        if (!handle) return null;
        const search = String(handle).toLowerCase().trim();
        return this._contactsByHandle.get(search) || null;
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
                visibility_state: 'active',
                visibility_changed_at: null,
                channels: { phone: [], email: [] }
            };
            if (handle.includes('@')) contact.channels.email.push(handle);
            else if (/^\+?\d+$/.test(handle)) contact.channels.phone.push(handle);
            this._contacts.push(contact);
        }
        if (data.channels && typeof data.channels === "object") {
            contact.channels = { ...(contact.channels || {}), ...data.channels };
            delete data.channels;
        }
        Object.assign(contact, data);
        contact.visibility_state = normalizeVisibilityState(contact.visibility_state || contact.visibilityState);
        contact.visibilityState = contact.visibility_state;
        if (!("visibility_changed_at" in contact)) contact.visibility_changed_at = null;
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
            const direction = String(meta.direction || "").trim().toLowerCase();

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
                        visibility_state: 'active',
                        visibility_changed_at: null,
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
                if (
                    normalizeVisibilityState(contact.visibility_state || contact.visibilityState) === "archived" &&
                    direction !== "outbound"
                ) {
                    contact.visibility_state = "active";
                    contact.visibilityState = "active";
                    contact.visibility_changed_at = date.toISOString();
                }
                toSaveMap.set(handle, contact);
            }
        }

        const toSave = Array.from(toSaveMap.values());
        if (toSave.length > 0) {
            await this.saveContacts(toSave);
        }
    }

    async markChannelInboundVerified(handle, value, timestamp = new Date().toISOString()) {
        await this.waitUntilReady();
        const contact = this.findContact(handle);
        if (!contact) return;

        if (!contact.verifiedChannels) contact.verifiedChannels = {};

        // Keep the earliest or latest timestamp depending on requirement, usually latest inbound is best proof or perhaps oldest to show trust duration.
        // We'll just update it or set it if missing.
        if (!contact.verifiedChannels[value] || new Date(contact.verifiedChannels[value]) < new Date(timestamp)) {
            contact.verifiedChannels[value] = timestamp;
            await this.saveContact(contact);
        }
    }

    async setDraft(handle, text) {
        await this.waitUntilReady();
        const contact = this.findContact(handle);
        if (contact) {
            contact.draft = text;
            contact.status = text ? 'draft' : 'open';
            await this.saveContact(contact);
        }
    }

    async clearDraft(handle) {
        await this.setDraft(handle, null);
    }

    /**
     * @param {string} handle
     * @param {string} text
     * @param {{ kind?: string }} [opts] - kind !== "note" stores JSON `{ kind, text }` in `text` column (reply#39).
     */
    async addNote(handle, text, opts = {}) {
        const contact = this.findContact(handle);
        if (contact) {
            const kind = String(opts.kind || "note").toLowerCase();
            const rowText =
                kind === "note"
                    ? String(text || "")
                    : JSON.stringify({ kind, text: String(text || "") });
            const noteId = "note-" + Date.now() + Math.random().toString(36).substr(2, 5);
            return new Promise((resolve, reject) => {
                this._db.run(
                    "INSERT INTO contact_notes (id, contact_id, text, timestamp) VALUES (?, ?, ?, ?)",
                    [noteId, contact.id, rowText, new Date().toISOString()],
                    (err) => {
                        if (err) return reject(err);
                        this.refresh().then(resolve).catch(reject);
                    }
                );
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
        if (contact.verifiedChannels && typeof contact.verifiedChannels === "object") {
            for (const [addr, ts] of Object.entries(contact.verifiedChannels)) {
                if (ts && addr) handles.add(addr);
            }
        }
        return Array.from(handles);
    }

    getProfileContext(identifier) {
        const contact = this.findContact(identifier);
        if (!contact || !this.shouldUseForAnnotation(contact)) return "";

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

    async setVisibilityState(identifier, nextState) {
        await this.waitUntilReady();
        await this.refresh();
        const normalized = normalizeVisibilityState(nextState);
        const contact =
            this.findById(identifier) ||
            this.getContactRowByHandle(identifier) ||
            this.findContact(identifier);
        if (!contact) {
            throw new Error("Contact not found");
        }
        contact.visibility_state = normalized;
        contact.visibilityState = normalized;
        contact.visibility_changed_at = new Date().toISOString();
        await this.saveContact(contact);
        return contact;
    }

    async restoreContact(identifier) {
        return this.setVisibilityState(identifier, "active");
    }

    async updateNote(handle, noteId, text, opts = {}) {
        const contact = this.findContact(handle);
        const prev = contact?.notes?.find((n) => n.id === noteId);
        const kind = String(opts.kind || prev?.kind || "note").toLowerCase();
        const rowText =
            kind === "note" ? String(text || "") : JSON.stringify({ kind, text: String(text || "") });
        return new Promise((resolve, reject) => {
            this._db.run("UPDATE contact_notes SET text = ? WHERE id = ?", [rowText, noteId], (err) => {
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

    /**
     * Alias-based merge (reply#19): moves child data onto the canonical row and sets
     * `primary_contact_id` on the source so lookups resolve to the primary without deleting history keys.
     */
    async mergeContacts(targetId, sourceId) {
        if (!targetId || !sourceId || targetId === sourceId) return;
        return new Promise((resolve, reject) => {
            this._db.serialize(() => {
                this._db.run("BEGIN TRANSACTION");
                let hasError = false;
                const handleError = (err) => {
                    if (err) {
                        hasError = true;
                        console.error("Merge error:", err.message);
                    }
                };

                // Move channels
                this._db.run("UPDATE OR IGNORE contact_channels SET contact_id = ? WHERE contact_id = ?", [targetId, sourceId], handleError);
                this._db.run("DELETE FROM contact_channels WHERE contact_id = ?", [sourceId], handleError);

                // Move notes & suggestions
                this._db.run("UPDATE contact_notes SET contact_id = ? WHERE contact_id = ?", [targetId, sourceId], handleError);
                this._db.run("UPDATE contact_suggestions SET contact_id = ? WHERE contact_id = ?", [targetId, sourceId], handleError);

                // Source row remains as a reversible alias → canonical (see unlinkAlias)
                this._db.run("UPDATE contacts SET primary_contact_id = ? WHERE id = ?", [targetId, sourceId], handleError);

                if (hasError) {
                    this._db.run("ROLLBACK", () => reject(new Error("Merge transaction failed")));
                } else {
                    this._db.run("COMMIT", (err) => {
                        if (err) return reject(err);
                        this.refresh().then(resolve).catch(reject);
                    });
                }
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
