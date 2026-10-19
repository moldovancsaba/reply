import { AppError } from "../errors.js";

const KEYS = ["contactId", "channel", "handle", "text", "subject"];

export function registerHandoff(app, { handoffs, logger }) {
    app.post("/api/handoff", async (req) => {
        const b = req.body ?? {};
        if (typeof b !== "object" || Array.isArray(b) || Object.keys(b).some((k) => !KEYS.includes(k))) throw new AppError(400, "invalid_request", `Body may only contain ${KEYS.join(", ")}.`);
        if (typeof b.contactId !== "string" || !b.contactId) throw new AppError(400, "invalid_request", "contactId is required.");
        if (b.handle !== undefined && typeof b.handle !== "string") throw new AppError(400, "invalid_request", "handle must be a string.");
        const r = handoffs.handoff(b);
        req.log.info({ channel: r.channel, action: r.action, textLength: b.text.length }, "handoff"); // never the handle or the text
        void logger;
        return r;
    });
}
