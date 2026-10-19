import { ImapFlow } from "imapflow";

const NAMES_SENT = ["sent", "sent items", "sent messages", "sent mail", "[gmail]/sent mail", "inbox.sent"];

// TLS only: `secure: true` and certificate verification on. `tls` is overridable for tests only.
export function openClient({ host, port, user, pass }, { tls = {}, timeouts = {} } = {}) {
    return new ImapFlow({
        host, port, secure: true, auth: { user, pass }, logger: false,
        tls: { rejectUnauthorized: true, ...tls },
        connectionTimeout: timeouts.connection ?? 15_000, greetingTimeout: timeouts.greeting ?? 15_000, socketTimeout: timeouts.socket ?? 60_000,
    });
}

export async function findSentBox(client) {
    const boxes = await client.list();
    return boxes.find((b) => b.specialUse === "\\Sent")?.path ?? boxes.find((b) => NAMES_SENT.includes(b.path.toLowerCase()))?.path ?? null;
}

// Maps whatever ImapFlow threw to a connector error code.
export function imapErrorCode(err) {
    if (err?.authenticationFailed) return "auth_failed";
    const c = String(err?.code ?? "");
    if (/^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONNRESET|EPIPE)$/.test(c)) return "network_unavailable";
    if (/^(ETIMEDOUT|ESOCKETTIMEDOUT)$/.test(c) || /timeout/i.test(String(err?.message))) return "timeout";
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|SSL/i.test(c) || /certificate|tls|ssl/i.test(String(err?.message))) return "network_unavailable"; // untrusted certificate: refused
    if (/(rate|throttl|too many|unavailable|try again)/i.test(String(err?.responseText ?? err?.message))) return "network_unavailable";
    return "internal";
}

export const isTlsRefusal = (err) => /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(String(err?.code ?? "")) || /certificate/i.test(String(err?.message));
