import { defaultHelperPath, HelperError, runHelper } from "../helper/index.js";

export const SERVICE = "reply-core.imap";

// Secret store for IMAP app passwords. The real one is the macOS login keychain, reached through the native helper
// (secrets on stdin/stdout only). Tests inject the in-memory one.
export function createKeychain({ helper = defaultHelperPath() } = {}) {
    const args = (verb, account) => ["keychain", verb, "--service", SERVICE, "--account", account];
    return {
        async set(account, secret) { await runHelper(args("set", account), { helper, input: `${secret}\n`, timeoutMs: 30_000 }); },
        async get(account) {
            try {
                const out = await runHelper(args("get", account), { helper, timeoutMs: 30_000 });
                if (out.secret === null) throw new HelperError("source_missing", "no saved password");
                return out.secret;
            } catch (err) {
                if (err instanceof HelperError && err.code === "source_missing") return null;
                throw err;
            }
        },
        async delete(account) { await runHelper(args("delete", account), { helper, timeoutMs: 30_000 }); },
    };
}

export function createMemoryKeychain() {
    const m = new Map();
    return { set: async (a, s) => { m.set(a, s); }, get: async (a) => m.get(a) ?? null, delete: async (a) => { m.delete(a); }, size: () => m.size, dump: () => JSON.stringify([...m]) };
}
