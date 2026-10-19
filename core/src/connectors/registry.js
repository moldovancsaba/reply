// Connector ids known to the service, in the default enabled order. Connector issues append here.
import { createImessageConnector } from "./imessage.js";
import { createStub } from "./stub.js";

export const AVAILABLE = {
    imessage: (deps) => createImessageConnector(deps),
    stub: () => createStub(),
};
export const DEFAULT_ENABLED = [];

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
