import os from "node:os";
import path from "node:path";
import { defaultHelperPath, helperDoctor, HelperError, runHelper } from "../helper/index.js";
import { normalizeHandle } from "../identity/normalize.js";
import { ConnectorError } from "./errors.js";

const HINTS = {
    permission_denied: "Grant Full Disk Access to the app that starts Reply Core, then recheck.",
    source_missing: "Messages has no database yet. Open Messages and sign in.",
    source_locked: "The Messages database is busy. It will be retried.",
    schema_unsupported: "This version of Messages uses a layout Reply Core does not know yet.",
    helper_unavailable: "The native helper is not built. Run core/helper/build.sh.",
};

export const defaultImessageDb = () => path.join(os.homedir(), "Library", "Messages", "chat.db");

// Maps one helper `message` record to a NormalizedMessage, or says why it is skipped.
export function toNormalized(rec, region) {
    if (rec.isReaction) return { skip: "reaction" };
    const handle = rec.isGroup ? normalizeHandle(`group:${rec.threadKey}`, undefined, region) : normalizeHandle(rec.counterpartHandle, undefined, region);
    if (!handle) return { skip: "bad_handle" };
    const sender = rec.isGroup && rec.counterpartHandle ? normalizeHandle(rec.counterpartHandle, undefined, region)?.handle_norm : undefined;
    return {
        message: {
            channel: "imessage", account: "", providerMessageKey: rec.providerMessageKey, threadKey: rec.threadKey, handle_norm: handle.handle_norm,
            isFromMe: rec.isFromMe, tsMs: rec.tsMs, subject: rec.subject, text: rec.text, attachments: rec.attachments ?? [],
            meta: { service: rec.service, ...(rec.isGroup ? { isGroup: true, ...(sender ? { sender } : {}) } : {}) },
        },
    };
}

export function createImessageConnector({ config = {}, logger, helper = defaultHelperPath() } = {}) {
    const dbPath = config.imessageDb || defaultImessageDb();
    const region = config.defaultRegion ?? "HU";
    const asConnectorError = (e) => (e instanceof HelperError ? Object.assign(new ConnectorError(e.code, e.message, { hint: HINTS[e.code] }), { cause: e }) : e);
    return {
        id: "imessage",
        channel: "imessage",
        intervalMs: 60_000,
        accounts: async () => [""],
        async preflight() {
            try {
                const { report } = await helperDoctor(["--db", dbPath, "--only", "imessage"], { helper, timeoutMs: 10_000 });
                if (report.imessage === "ok") return { ok: true };
                return { ok: false, code: report.imessage, hint: HINTS[report.imessage] };
            } catch (e) {
                if (e instanceof HelperError) return { ok: false, code: e.code, hint: HINTS[e.code] ?? e.message };
                throw e;
            }
        },
        async fetch(_account, cursor, { limit, signal }) {
            const t0 = performance.now();
            let out;
            try {
                out = await runHelper(["imessage", "--db", dbPath, "--after", String(cursor.rowid ?? 0), "--limit", String(limit)], { helper, signal, timeoutMs: 30_000 });
            } catch (e) {
                throw asConnectorError(e);
            }
            const messages = [];
            const skipped = { reaction: 0, bad_handle: 0 };
            for (const rec of out.messages) {
                const r = toNormalized(rec, region);
                if (r.skip) skipped[r.skip]++;
                else messages.push(r.message);
            }
            const undecodable = out.warnings.find((w) => w.code === "undecodable_text")?.count ?? 0;
            logger?.info({ connector: "imessage", messages: messages.length, skippedReactions: skipped.reaction, skippedBadHandle: skipped.bad_handle, undecodable, ms: Math.round(performance.now() - t0) }, "connector.imessage page");
            const cur = out.cursor?.cursor?.rowid ?? cursor.rowid ?? 0;
            return { messages, nextCursor: { rowid: cur }, more: Boolean(out.cursor?.more) };
        },
    };
}
