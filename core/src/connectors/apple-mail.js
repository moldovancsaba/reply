import os from "node:os";
import path from "node:path";
import { defaultHelperPath, helperDoctor, HelperError, runHelper } from "../helper/index.js";
import { normalizeHandle } from "../identity/normalize.js";
import { ConnectorError } from "./errors.js";

const HINTS = {
    permission_denied: "Grant Full Disk Access to the app that starts Reply Core, then recheck.",
    source_missing: "Add an account in the Mail app, then recheck.",
    source_locked: "The Mail index is busy. It will be retried.",
    schema_unsupported: "This version of Mail uses a layout Reply Core does not know yet.",
    helper_unavailable: "The native helper is not built. Run core/helper/build.sh.",
};

// Mailboxes whose contents are not conversations.
const EXCLUDED = new Set(["drafts", "junk", "trash"]);

export const defaultMailRoot = () => path.join(os.homedir(), "Library", "Mail");

// Maps one helper `mail` record to a NormalizedMessage, or says why it is skipped. Email text is Mail's stored
// summary (not the full body), which the `isSummary` flag lets the UI say honestly.
export function toNormalized(rec, region) {
    if (EXCLUDED.has(rec.mailboxKind)) return { skip: "excluded" };
    const handle = normalizeHandle(rec.counterpartHandle, "email", region);
    if (!handle) return { skip: "no_counterpart" }; // for example mail sent only to undisclosed recipients
    return {
        message: {
            channel: "email", account: rec.account, providerMessageKey: rec.providerMessageKey, threadKey: rec.threadKey, handle_norm: handle.handle_norm,
            isFromMe: rec.isFromMe, tsMs: rec.tsMs, subject: rec.subject, text: [rec.subject, rec.text].filter(Boolean).join("\n\n"), attachments: [],
            // the mailbox is deliberately not stored: the same message can sit in several (Gmail) and must not change when a copy arrives later
            meta: { isSummary: true, recipients: rec.to ?? [], accountLabel: rec.accountLabel ?? rec.account },
        },
    };
}

export function createAppleMailConnector({ config = {}, logger, helper = defaultHelperPath() } = {}) {
    const root = config.mailRoot || defaultMailRoot();
    const region = config.defaultRegion ?? "HU";
    const asConnectorError = (e) => (e instanceof HelperError ? Object.assign(new ConnectorError(e.code, e.message, { hint: HINTS[e.code] }), { cause: e }) : e);
    return {
        id: "apple-mail",
        channel: "email",
        intervalMs: 120_000,
        accounts: async () => [""],
        async preflight() {
            try {
                const { report } = await helperDoctor(["--root", root, "--only", "mail"], { helper, timeoutMs: 10_000 });
                if (report.mail === "ok") return { ok: true };
                return { ok: false, code: report.mail, hint: HINTS[report.mail] };
            } catch (e) {
                if (e instanceof HelperError) return { ok: false, code: e.code, hint: HINTS[e.code] ?? e.message };
                throw e;
            }
        },
        async fetch(_account, cursor, { limit, signal }) {
            const t0 = performance.now();
            let out;
            try {
                out = await runHelper(["mail", "--root", root, "--after", String(cursor.rowid ?? 0), "--limit", String(limit)], { helper, signal, timeoutMs: 30_000 });
            } catch (e) {
                throw asConnectorError(e);
            }
            const messages = [];
            const skipped = { excluded: 0, no_counterpart: 0 };
            for (const rec of out.messages) {
                const r = toNormalized(rec, region);
                if (r.skip) skipped[r.skip]++;
                else messages.push(r.message);
            }
            logger?.info({ connector: "apple-mail", messages: messages.length, excluded: skipped.excluded, quarantined: skipped.no_counterpart, ms: Math.round(performance.now() - t0) }, "connector.apple-mail page");
            return { messages, nextCursor: { rowid: out.cursor?.cursor?.rowid ?? cursor.rowid ?? 0 }, more: Boolean(out.cursor?.more) };
        },
    };
}
