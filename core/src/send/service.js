import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import { CHANNELS } from "../storage/repo.js";
import { SendError } from "./drivers.js";

const MAX_TEXT = 4000; // an app message, not a URL: far above what a person writes, far below what could hurt
const MAX_SUBJECT = 300;
const RATE_PER_MINUTE = 10;

const NOTE = { imessage: "Sent through Messages.", email: "Sent through Mail.", whatsapp: "Sent through WhatsApp." };

// Sending a message from the app: one explicit request per message (the UI asks the person first), checked against the
// contact's own handles, idempotent per `clientId`, rate limited, one at a time, audited without content.
export function createSender({ db, handoffs, drivers, confirmers = {}, nudges = {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), confirmMs = 15_000, enabled = true, now = () => Date.now(), onSent, logger }) {
    const q = {
        byClient: db.prepare("SELECT * FROM sends WHERE client_id = ?"),
        insert: db.prepare("INSERT INTO sends (id, client_id, ts_ms, contact_id, channel, handle_kind, text_length, status) VALUES (?,?,?,?,?,?,?, 'sending')"),
        finish: db.prepare("UPDATE sends SET status = ?, error_code = ?, done_ms = ? WHERE id = ?"),
        recent: db.prepare("SELECT COUNT(*) n FROM sends WHERE ts_ms >= ?"),
    };
    let inFlight = false;

    // Which channels this app can send on for a contact: all three, unless sending is turned off.
    const capability = (channel) => (enabled && drivers[channel] ? { available: true } : { available: false, reason: enabled ? "Sending through this channel is not available." : "Sending is turned off (REPLY_CORE_SENDING=off)." });

    function check(body) {
        const { contactId, channel, handle, text, subject, clientId } = body;
        if (typeof clientId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(clientId)) throw new AppError(400, "invalid_request", "clientId must be 8 to 80 letters, digits, - or _.");
        if (!CHANNELS.includes(channel)) throw new AppError(400, "invalid_request", `channel must be one of ${CHANNELS.join(", ")}.`);
        if (typeof text !== "string") throw new AppError(400, "invalid_request", "text must be a string.");
        if (!text.trim()) throw new AppError(400, "text_empty", "Write a message first.");
        if (text.length > MAX_TEXT) throw new AppError(413, "text_too_long", `Messages over ${MAX_TEXT.toLocaleString("en-US")} characters cannot be sent from here.`);
        if (subject !== undefined && (typeof subject !== "string" || subject.length > MAX_SUBJECT)) throw new AppError(400, "invalid_request", `subject must be text of at most ${MAX_SUBJECT} characters.`);
        return { contactId, channel, handle, text, subject, clientId };
    }

    async function send(body) {
        const { contactId, channel, handle, text, subject, clientId } = check(body);
        const prior = q.byClient.get(clientId);
        if (prior) {
            // the same request again (a double click, a retry after a lost answer): never a second message
            if (prior.status === "sending") throw new AppError(409, "send_in_progress", "This message is still being sent.");
            if (prior.status === "sent") return { sendId: prior.id, status: "sent", channel: prior.channel, note: NOTE[prior.channel], replayed: true };
            throw Object.assign(new AppError(409, "already_attempted", prior.status === "unknown" ? "This message may already have been sent. Check the conversation before sending again." : "This attempt failed. Write it again to send a new one."), { details: { status: prior.status, errorCode: prior.error_code } });
        }
        if (!enabled) throw new AppError(403, "sending_disabled", "Sending is turned off. Set REPLY_CORE_SENDING=on to use it.");
        if (!drivers[channel]) throw new AppError(422, "channel_not_supported", "Sending through that channel is not available.");
        const { chosen, kind } = handoffs.resolve({ contactId, channel, handle });
        if (inFlight) throw new AppError(429, "send_rate_limited", "Another message is being sent. Wait a moment.", { retryable: true });
        if (q.recent.get(now() - 60_000).n >= RATE_PER_MINUTE) throw new AppError(429, "send_rate_limited", `At most ${RATE_PER_MINUTE} messages a minute can be sent from here. Wait a moment.`, { retryable: true });

        const id = `s_${randomUUID().slice(0, 12)}`;
        q.insert.run(id, clientId, now(), contactId, channel, kind, text.length);
        inFlight = true;
        try {
            const startedAt = now();
            try {
                await drivers[channel]({ handle: chosen.value, text, subject });
            } catch (err) {
                const e = err instanceof SendError ? err : new SendError("send_failed", "The message was not sent.");
                q.finish.run(e.unknownOutcome ? "unknown" : "failed", e.code, now(), id);
                logger?.warn({ channel, code: e.code }, "send.failed");
                const status = e.code === "automation_denied" || e.code === "accessibility_denied" ? 403 : e.code === "recipient_not_found" ? 422 : e.code === "send_timeout" ? 504 : 502;
                throw Object.assign(new AppError(status, e.code, e.message, { retryable: false }), e.recovery ? { details: { recovery: e.recovery } } : {});
            }
            // WhatsApp has no sending interface (a key press), so look for the message in its database: only then is it "sent".
            let confirmed;
            if (channel === "whatsapp" && !confirmers[channel]) confirmed = false; // a key press cannot say whether anything was sent
            if (confirmers[channel]) {
                const since = startedAt - 2000;
                let seen = "none";
                for (let waited = 0; seen === "none" && waited <= confirmMs; waited += 1000) {
                    if (waited) await sleep(1000);
                    // the first Return may have been lost (the chat was still loading): press it once more, it is harmless on an empty box
                    if (waited === 5000 && nudges[channel]) await nudges[channel]().catch(() => {});
                    seen = await confirmers[channel]({ handle: chosen.value, text, sinceMs: since });
                    if (seen === "unavailable") break;
                }
                if (seen === "other") {
                    q.finish.run("failed", "whatsapp_wrong_chat", now(), id);
                    logger?.warn({ channel, code: "whatsapp_wrong_chat" }, "send.failed");
                    throw new AppError(502, "whatsapp_wrong_chat", "The message went to a different WhatsApp chat than the one you chose. Open WhatsApp and check it.", { retryable: false });
                }
                if (seen === "none") {
                    q.finish.run("unknown", "unconfirmed", now(), id);
                    logger?.warn({ channel, code: "unconfirmed" }, "send.unconfirmed");
                    throw new AppError(504, "send_unconfirmed", "WhatsApp did not show the message in this chat. It may have been sent: check the conversation before sending again.", { retryable: false });
                }
                confirmed = seen === "chat"; // "unavailable": the database cannot be read, so it stays unconfirmed
            }
            q.finish.run("sent", null, now(), id);
            logger?.info({ channel, textLength: text.length, confirmed }, "send.ok"); // never the text, the subject or the address
            try { onSent?.(channel); } catch { /* a failed refresh must not turn a sent message into an error */ }
            return { sendId: id, status: "sent", channel, handleLabel: chosen.label, note: confirmed === false ? "Pressed Send in WhatsApp. It could not be confirmed that the message arrived." : NOTE[channel], ...(confirmed === undefined ? {} : { confirmed }) };
        } finally {
            inFlight = false;
        }
    }

    return { send, capability };
}
