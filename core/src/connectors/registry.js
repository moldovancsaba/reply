// Connector ids known to the service, in the default enabled order. Connector issues append here.
import { createStub } from "./stub.js";

export const AVAILABLE = {
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
