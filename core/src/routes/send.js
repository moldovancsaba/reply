import { execFile } from "node:child_process";
import { AppError } from "../errors.js";

import { MAX_FILE_BYTES } from "../send/uploads.js";

const KEYS = ["contactId", "channel", "handle", "text", "subject", "clientId", "attachmentIds"];

export function registerSend(app, { sender, uploads, appPath }) {
    app.post("/api/send", async (req, reply) => {
        const b = req.body ?? {};
        if (typeof b !== "object" || Array.isArray(b) || Object.keys(b).some((k) => !KEYS.includes(k))) throw new AppError(400, "invalid_request", `Body may only contain ${KEYS.join(", ")}.`);
        if (typeof b.contactId !== "string" || !b.contactId) throw new AppError(400, "invalid_request", "contactId is required.");
        if (b.handle !== undefined && typeof b.handle !== "string") throw new AppError(400, "invalid_request", "handle must be a string.");
        const r = await sender.send(b);
        return reply.header("cache-control", "no-store").send(r);
    });

    // A file picked in the Reply box: the raw bytes of the body, the name in ?name=. It waits in <home>/outbox until it is sent,
    // removed or an hour has passed.
    if (uploads) {
        app.post("/api/uploads", { bodyLimit: MAX_FILE_BYTES + 1024 }, async (req, reply) => {
            if (Object.keys(req.query).some((k) => k !== "name")) throw new AppError(400, "invalid_request", "Only ?name= is allowed.");
            if (!Buffer.isBuffer(req.body)) throw new AppError(415, "unsupported_media_type", "Send the file as application/octet-stream.");
            return reply.status(201).header("cache-control", "no-store").send(uploads.add(req.query.name, req.body));
        });
        app.delete("/api/uploads/:id", async (req, reply) => { uploads.remove(req.params.id); return reply.send({ removed: true }); });
    }

    // Opens the {reply} app in a permission mode so macOS shows its prompts for it: "sending" asks for Automation
    // (Messages, Mail, System Events) and Accessibility, "contacts" for the address book. /api/send/consent stays
    // as the older name for kind "sending".
    const FLAGS = { sending: "--consent-send", contacts: "--consent" };
    const consent = async (kind, reply) => {
        if (!Object.hasOwn(FLAGS, kind)) throw new AppError(400, "invalid_request", `kind must be one of ${Object.keys(FLAGS).join(", ")}.`);
        if (!appPath) throw new AppError(501, "consent_unavailable", "Reply Core is not running from the {reply} app, so it cannot ask macOS for permission. Run: node scripts/reply-core build-app, then install-agent.");
        await new Promise((resolve, reject) => execFile("/usr/bin/open", ["-a", appPath, "--args", FLAGS[kind]], (err) => (err ? reject(new AppError(502, "consent_failed", "The {reply} app could not be opened.")) : resolve())));
        return reply.status(202).send({ opened: true });
    };
    app.post("/api/consent", (req, reply) => consent(req.body?.kind, reply));
    app.post("/api/send/consent", (req, reply) => consent("sending", reply));
}
