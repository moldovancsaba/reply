// The connectors the service knows how to run, by id. Which of them run is `REPLY_CORE_CONNECTORS` (default list: DEFAULT_ENABLED_IDS in config.js).
import { createAppleMailConnector } from "./apple-mail.js";
import { createContactsConnector } from "./contacts.js";
import { createImapConnector } from "./imap.js";
import { createImessageConnector } from "./imessage.js";
import { createStub } from "./stub.js";
import { createWhatsAppConnector } from "./whatsapp.js";

export const AVAILABLE = {
    imessage: (deps) => createImessageConnector(deps),
    contacts: (deps) => createContactsConnector(deps),
    "apple-mail": (deps) => createAppleMailConnector(deps),
    whatsapp: (deps) => createWhatsAppConnector(deps),
    imap: (deps) => createImapConnector(deps),
    stub: () => createStub(),
};

// `enabled` comes from REPLY_CORE_CONNECTORS (comma list). Unknown ids are reported, never silently ignored.
export function createRegistry({ enabled, available = AVAILABLE, deps = {} }) {
    const connectors = new Map();
    const unknown = [];
    for (const id of enabled) {
        if (!available[id]) unknown.push(id);
        else connectors.set(id, available[id](deps));
    }
    return {
        unknown,
        get: (id) => connectors.get(id) ?? null,
        list: () => [...connectors.values()],
        ids: () => [...connectors.keys()],
    };
}
