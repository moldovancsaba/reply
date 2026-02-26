/**
 * {reply} - Contacts & KYC Routes
 */

const { writeJson, readJsonBody } = require("../utils/server-utils");
const contactStore = require("../contact-store");

async function serveMerge(req, res, invalidateCaches) {
    try {
        const payload = await readJsonBody(req);
        if (!payload.targetId || !payload.sourceId) {
            writeJson(res, 400, { error: "targetId and sourceId are required" });
            return;
        }
        const sourceContact = contactStore.findContact(payload.sourceId);
        const targetContact = contactStore.findContact(payload.targetId);
        if (!sourceContact || !targetContact) {
            writeJson(res, 404, { error: "Source or Target contact not found" });
            return;
        }
        if (sourceContact.id === targetContact.id) {
            writeJson(res, 400, { error: "Cannot merge a contact into itself" });
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

module.exports = {
    serveMerge,
    serveUpdateContact,
    serveAddNote,
    serveUpdateNote,
    serveDeleteNote,
    serveAcceptSuggestion,
    serveDeclineSuggestion
};
