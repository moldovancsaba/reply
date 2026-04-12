/**
 * {reply} - Contacts & KYC Routes
 */

const { writeJson, readJsonBody } = require("../utils/server-utils");
const contactStore = require("../contact-store");

/** Resolve UI merge endpoint id or handle to a concrete SQLite row (reply#19). */
function resolveMergeParticipant(key) {
    if (key == null || key === "") return null;
    const k = String(key).trim();
    if (k.startsWith("id-")) return contactStore.findById(k);
    const byHandle = contactStore.getContactRowByHandle(k);
    if (byHandle) return byHandle;
    return contactStore.findContact(k);
}

async function serveMerge(req, res, invalidateCaches) {
    try {
        const payload = await readJsonBody(req);
        if (!payload.targetId || !payload.sourceId) {
            writeJson(res, 400, { error: "targetId and sourceId are required" });
            return;
        }
        await contactStore.waitUntilReady();
        let targetContact = resolveMergeParticipant(payload.targetId);
        const sourceContact = resolveMergeParticipant(payload.sourceId);
        if (!sourceContact || !targetContact) {
            writeJson(res, 404, { error: "Source or Target contact not found" });
            return;
        }
        if (targetContact.primary_contact_id) {
            const p = contactStore.findById(targetContact.primary_contact_id);
            if (p) targetContact = p;
        }
        if (sourceContact.id === targetContact.id) {
            writeJson(res, 400, { error: "Cannot merge a contact into itself" });
            return;
        }
        if (sourceContact.primary_contact_id === targetContact.id) {
            writeJson(res, 400, { error: "Source is already linked to this primary" });
            return;
        }

        await contactStore.mergeContacts(targetContact.id, sourceContact.id);
        if (invalidateCaches) invalidateCaches();
        writeJson(res, 200, { status: "merged", targetId: targetContact.id, sourceId: sourceContact.id });
    } catch (e) {
        console.error("[Merge API Error]", e);
        writeJson(res, 500, { error: e.message });
    }
}

async function serveUpdateContact(req, res) {
    try {
        const { handle, data } = await readJsonBody(req);
        if (!handle || !data) {
            writeJson(res, 400, { error: "Missing handle or data" });
            return;
        }
        const updatedContact = await contactStore.updateContact(handle, data);
        writeJson(res, 200, { status: "ok", contact: updatedContact });
    } catch (e) {
        writeJson(res, 500, { error: e.message });
    }
}

async function serveAddNote(req, res) {
    try {
        const { handle, text } = await readJsonBody(req);
        if (!handle || !text) {
            writeJson(res, 400, { error: "Missing handle or text" });
            return;
        }
        await contactStore.addNote(handle, text);
        writeJson(res, 200, { status: "ok" });
    } catch (e) {
        writeJson(res, 500, { error: e.message });
    }
}

async function serveUpdateNote(req, res) {
    try {
        const { handle, id, text } = await readJsonBody(req);
        if (!handle || !id) {
            writeJson(res, 400, { error: "Missing handle or id" });
            return;
        }
        await contactStore.updateNote(handle, id, text);
        writeJson(res, 200, { status: "ok" });
    } catch (e) {
        writeJson(res, 500, { error: e.message });
    }
}

async function serveDeleteNote(req, res, url) {
    const handle = url.searchParams.get("handle");
    const id = url.searchParams.get("id");
    if (handle && id) {
        await contactStore.deleteNote(handle, id);
        writeJson(res, 200, { status: "ok" });
    } else {
        writeJson(res, 400, { error: "Missing handle or id" });
    }
}

async function serveAcceptSuggestion(req, res) {
    try {
        const { handle, id } = await readJsonBody(req);

        await contactStore.waitUntilReady();
        const contact = contactStore.findContact(handle);
        if (contact && contact.pendingSuggestions) {
            const suggestion = contact.pendingSuggestions.find(s => s.id === id);
            if (suggestion) {
                let updated = false;
                if (suggestion.type === 'company' || suggestion.type === 'linkedinUrl') {
                    contact[suggestion.type] = suggestion.content;
                    updated = true;
                } else if (suggestion.type === 'notes') {
                    await contactStore.addNote(handle, suggestion.content);
                } else {
                    if (!contact.channels) contact.channels = {};
                    if (!contact.channels[suggestion.type]) contact.channels[suggestion.type] = [];
                    if (!contact.channels[suggestion.type].includes(suggestion.content)) {
                        contact.channels[suggestion.type].push(suggestion.content);
                        updated = true;
                    }
                }
                if (updated) {
                    await contactStore.saveContact(contact);
                }
            }
        }

        await contactStore.acceptSuggestion(handle, id);
        const updatedContact = contactStore.findContact(handle);
        writeJson(res, 200, { status: "ok", contact: updatedContact });
    } catch (e) {
        writeJson(res, 500, { error: e.message });
    }
}

async function serveDeclineSuggestion(req, res) {
    try {
        const { handle, id } = await readJsonBody(req);
        await contactStore.declineSuggestion(handle, id);
        const contact = contactStore.findContact(handle);
        writeJson(res, 200, { status: "ok", contact });
    } catch (e) {
        writeJson(res, 500, { error: e.message });
    }
}

/**
 * GET /api/contacts/aliases?for=<handle|id> — rows pointing at this canonical via `primary_contact_id`.
 */
async function serveListAliases(req, res, url) {
    try {
        await contactStore.waitUntilReady();
        const forParam = (url.searchParams.get("for") || "").trim();
        if (!forParam) {
            writeJson(res, 400, { error: "Missing query: for" });
            return;
        }
        const row = contactStore.findById(forParam) || contactStore.getContactRowByHandle(forParam) || contactStore.findContact(forParam);
        if (!row) {
            writeJson(res, 404, { error: "Contact not found" });
            return;
        }
        let canonical = row;
        if (row.primary_contact_id) {
            const p = contactStore.findById(row.primary_contact_id);
            if (p) canonical = p;
        }
        const raw = contactStore.listAliasesForCanonical(canonical.id);
        const aliases = raw.map((c) => ({
            id: c.id,
            handle: c.handle,
            displayName: c.displayName || c.handle
        }));
        writeJson(res, 200, { canonicalId: canonical.id, aliases });
    } catch (e) {
        console.error("[contacts/aliases]", e);
        writeJson(res, 500, { error: e.message });
    }
}

/**
 * POST /api/contacts/unlink-alias { aliasContactId } — clear merge pointer (reply#19).
 */
async function serveUnlinkAlias(req, res, invalidateCaches) {
    try {
        const payload = await readJsonBody(req);
        const aliasContactId = payload.aliasContactId || payload.aliasId;
        if (!aliasContactId) {
            writeJson(res, 400, { error: "aliasContactId is required" });
            return;
        }
        await contactStore.waitUntilReady();
        await contactStore.unlinkAlias(aliasContactId);
        if (invalidateCaches) invalidateCaches();
        writeJson(res, 200, { status: "unlinked", aliasContactId });
    } catch (e) {
        console.error("[contacts/unlink-alias]", e);
        writeJson(res, 400, { error: e.message || "Unlink failed" });
    }
}

module.exports = {
    serveMerge,
    serveListAliases,
    serveUnlinkAlias,
    serveUpdateContact,
    serveAddNote,
    serveUpdateNote,
    serveDeleteNote,
    serveAcceptSuggestion,
    serveDeclineSuggestion
};
