import { AppError } from "../errors.js";

const isId = (v) => typeof v === "string" && v.length > 0 && v.length <= 80;

export function registerIdentity(app, { identity }) {
    app.post("/api/contacts/:id/merge", async (req) => {
        const sourceContactId = req.body?.sourceContactId;
        if (!isId(sourceContactId) || Object.keys(req.body).some((k) => k !== "sourceContactId")) throw new AppError(400, "invalid_request", 'Body must be {"sourceContactId": "<id>"}.');
        return identity.merge(sourceContactId, req.params.id);
    });
    app.post("/api/contacts/:id/unmerge", async (req) => {
        const mergeLogId = req.body?.mergeLogId;
        if (!isId(mergeLogId) || Object.keys(req.body).some((k) => k !== "mergeLogId")) throw new AppError(400, "invalid_request", 'Body must be {"mergeLogId": "<id>"}.');
        const r = identity.unmerge(mergeLogId);
        return { restoredContactId: r.restoredContactId, restoredHandles: r.restoredHandles };
    });
    // Proposals only; the user confirms with the normal merge. See docs/CORE_IDENTITY.md.
    app.get("/api/contacts/:id/duplicates", async (req) => ({ items: identity.duplicatesOf(req.params.id) }));
    app.post("/api/contacts/:id/duplicates/dismiss", async (req) => {
        const otherContactId = req.body?.otherContactId;
        if (!isId(otherContactId) || Object.keys(req.body).some((k) => k !== "otherContactId")) throw new AppError(400, "invalid_request", 'Body must be {"otherContactId": "<id>"}.');
        identity.dismissDuplicate(req.params.id, otherContactId);
        return { dismissed: true };
    });
    app.get("/api/contacts/:id/merges", async (req) => ({ items: identity.history(req.params.id) }));
}
