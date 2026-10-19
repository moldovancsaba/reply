// Deterministic demo connector (REPLY_CORE_CONNECTORS=stub): three pages of synthetic messages, then idle.
// Exists to exercise the framework end to end without any source app.
const BASE = Date.UTC(2026, 9, 1);

export function createStub({ pages = 3, perPage = 5, intervalMs = 60_000 } = {}) {
    return {
        id: "stub",
        channel: "imessage",
        intervalMs,
        accounts: async () => [""],
        preflight: async () => ({ ok: true }),
        async fetch(_account, cursor, { limit }) {
            const page = cursor.page ?? 0;
            if (page >= pages) return { messages: [], nextCursor: cursor, more: false };
            const messages = Array.from({ length: Math.min(perPage, limit) }, (_, i) => {
                const n = page * perPage + i;
                return {
                    channel: "imessage", account: "", providerMessageKey: `stub-${n}`, threadKey: "stub", handle_norm: `+1212555${String(n % 3).padStart(4, "0")}`,
                    isFromMe: n % 2 === 0, tsMs: BASE + n * 60_000, text: `Stub message ${n}`, attachments: [],
                };
            });
            return { messages, nextCursor: { page: page + 1 }, more: page + 1 < pages };
        },
    };
}
