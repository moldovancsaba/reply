import { simpleParser } from "mailparser";
import { loadAccounts } from "../imap/accounts.js";
import { imapErrorCode, isTlsRefusal, openClient } from "../imap/client.js";
import { createKeychain } from "../imap/keychain.js";
import { htmlToText } from "../imap/text.js";
import { normalizeHandle } from "../identity/normalize.js";
import { ConnectorError } from "./errors.js";
import { maskAccount } from "./runner.js";

const MAX_SOURCE = 256 * 1024;

const HINTS = {
    auth_failed: "Create a new app password at your email provider, then run reply-core accounts add-imap again.",
    network_unavailable: "Check your internet connection. Reply Core will try again.",
    timeout: "The mail server took too long. Reply Core will try again.",
};

// A parsed message -> NormalizedMessage (or why it is skipped). Full text bodies are stored (not just a summary).
export function toNormalized(parsed, { account, box, kind, uid }, region) {
    const self = new Set([account.user, ...(account.selfAddresses ?? [])].map((a) => a.toLowerCase()));
    const from = parsed.from?.value?.[0]?.address?.toLowerCase();
    const to = (parsed.to?.value ?? []).map((a) => a.address?.toLowerCase()).filter(Boolean);
    const isFromMe = kind === "sent" || (from ? self.has(from) : false);
    const counterpart = isFromMe ? to[0] : from;
    const handle = counterpart ? normalizeHandle(counterpart, "email", region) : null;
    if (!handle) return { skip: "no_counterpart" };
    const raw = parsed.text ?? htmlToText(parsed.html || "");
    const text = String(raw).replace(/\r/g, "").replace(/\u00a0/g, " ").trim().slice(0, MAX_SOURCE);
    const messageId = (parsed.messageId ?? "").trim();
    const refs = Array.isArray(parsed.references) ? parsed.references[0] : parsed.references;
    return {
        message: {
            channel: "email", account: account.id, providerMessageKey: messageId || `uid:${box}:${uid}`, threadKey: refs || messageId || `uid:${box}:${uid}`,
            handle_norm: handle.handle_norm, isFromMe, tsMs: (parsed.date ?? new Date(0)).getTime(), subject: parsed.subject || undefined, text, attachments: [],
            meta: { isSummary: false, recipients: to, accountLabel: account.label || account.id },
        },
    };
}

export function createImapConnector({ config = {}, logger, keychain = createKeychain(), tls, timeouts, region = config.defaultRegion ?? "HU" } = {}) {
    const home = () => config.home;
    const accountsList = () => loadAccounts(home());
    const find = (id) => accountsList().find((a) => a.id === id);

    async function credentials(account) {
        const pass = await keychain.get(account.id);
        if (!pass) throw new ConnectorError("auth_failed", "no saved password for this account", { hint: HINTS.auth_failed });
        return { host: account.host, port: account.port, user: account.user, pass };
    }

    function wrap(err) {
        if (err instanceof ConnectorError) return err;
        const code = imapErrorCode(err);
        const message = isTlsRefusal(err) ? "the mail server's TLS certificate is not trusted" : String(err?.message ?? err).slice(0, 200);
        return Object.assign(new ConnectorError(code, message, { hint: HINTS[code] }), { cause: err });
    }

    return {
        id: "imap",
        channel: "email",
        intervalMs: 300_000,
        accounts: async () => accountsList().map((a) => a.id),
        async preflight() {
            try {
                for (const a of accountsList()) if (!(await keychain.get(a.id))) return { ok: false, code: "auth_failed", hint: HINTS.auth_failed };
                return { ok: true };
            } catch (err) {
                return { ok: false, code: err?.code === "source_missing" ? "auth_failed" : (err?.code ?? "internal"), hint: err?.message };
            }
        },
        async fetch(accountId, cursor, { limit, signal }) {
            const t0 = performance.now();
            const account = find(accountId);
            if (!account) throw new ConnectorError("source_missing", "that IMAP account was removed");
            const boxes = [["inbox", account.boxes?.inbox ?? "INBOX"], ...(account.boxes?.sent ? [["sent", account.boxes.sent]] : [])];
            const next = { ...cursor };
            const messages = [];
            let more = false;
            let skipped = 0;
            const client = openClient(await credentials(account), { tls, timeouts });
            client.on("error", () => {}); // surfaced through the failing call, not as an unhandled event
            const onAbort = () => client.close();
            signal?.addEventListener("abort", onAbort, { once: true });
            try {
                await client.connect();
                for (const [kind, box] of boxes) {
                    if (messages.length >= limit) { more = true; break; }
                    const lock = await client.getMailboxLock(box, { readOnly: true });
                    try {
                        const validity = Number(client.mailbox.uidValidity);
                        let c = next[box];
                        if (c && c.uidValidity !== validity) c = undefined; // the server renumbered the mailbox: read it again (ids are Message-IDs, so nothing duplicates)
                        let lastUid = c?.lastUid ?? 0;
                        if (client.mailbox.exists === 0) { next[box] = { uidValidity: validity, lastUid }; continue; }
                        for await (const msg of client.fetch(`${lastUid + 1}:*`, { uid: true, source: { maxLength: MAX_SOURCE } }, { uid: true })) {
                            if (msg.uid <= lastUid) continue; // "n:*" always returns the last message, even when it is older than n
                            if (messages.length >= limit) { more = true; break; }
                            const parsed = await simpleParser(msg.source);
                            const r = toNormalized(parsed, { account, box, kind, uid: msg.uid }, region);
                            if (r.message) messages.push(r.message);
                            else skipped++;
                            lastUid = msg.uid;
                        }
                        next[box] = { uidValidity: validity, lastUid };
                    } finally {
                        lock.release();
                    }
                }
            } catch (err) {
                throw wrap(err);
            } finally {
                signal?.removeEventListener("abort", onAbort);
                await client.logout().catch(() => client.close());
            }
            logger?.info({ connector: "imap", account: maskAccount(accountId), fetched: messages.length, skippedNoCounterpart: skipped, more, ms: Math.round(performance.now() - t0) }, "connector.imap page");
            return { messages, nextCursor: next, more };
        },
    };
}
