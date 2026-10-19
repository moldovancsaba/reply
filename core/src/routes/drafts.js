import { AppError } from "../errors.js";

const KEYS = ["contactId", "channel", "instruction"];

export function registerDrafts(app, { drafting }) {
    app.get("/api/drafts/capabilities", async () => drafting.capabilities());
    app.post("/api/drafts/suggest", async (req, reply) => {
        const b = req.body ?? {};
        if (typeof b !== "object" || Array.isArray(b) || Object.keys(b).some((k) => !KEYS.includes(k))) throw new AppError(400, "invalid_request", `Body may only contain ${KEYS.join(", ")}.`);
        if (typeof b.contactId !== "string" || !b.contactId) throw new AppError(400, "invalid_request", "contactId is required.");
        // a closed connection cancels the model call
        const ac = new AbortController();
        reply.raw.once("close", () => { if (!reply.raw.writableFinished) ac.abort(); });
        return drafting.suggest(b, { signal: ac.signal });
    });
}
