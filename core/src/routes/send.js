import { execFile } from "node:child_process";
import { AppError } from "../errors.js";

const KEYS = ["contactId", "channel", "handle", "text", "subject", "clientId"];

export function registerSend(app, { sender, appPath }) {
    app.post("/api/send", async (req, reply) => {
        const b = req.body ?? {};
        if (typeof b !== "object" || Array.isArray(b) || Object.keys(b).some((k) => !KEYS.includes(k))) throw new AppError(400, "invalid_request", `Body may only contain ${KEYS.join(", ")}.`);
        if (typeof b.contactId !== "string" || !b.contactId) throw new AppError(400, "invalid_request", "contactId is required.");
        if (b.handle !== undefined && typeof b.handle !== "string") throw new AppError(400, "invalid_request", "handle must be a string.");
        const r = await sender.send(b);
        return reply.header("cache-control", "no-store").send(r);
    });

    // Opens the {reply} app in its "ask for permission" mode so macOS shows its Automation (and Accessibility) prompts for it.
    app.post("/api/send/consent", async (req, reply) => {
        if (!appPath) throw new AppError(501, "consent_unavailable", "Reply Core is not running from the {reply} app, so it cannot ask macOS for permission. Run: node scripts/reply-core build-app, then install-agent.");
        await new Promise((resolve, reject) => execFile("/usr/bin/open", ["-a", appPath, "--args", "--consent-send"], (err) => (err ? reject(new AppError(502, "consent_failed", "The {reply} app could not be opened.")) : resolve())));
        return reply.status(202).send({ opened: true });
    });
}
