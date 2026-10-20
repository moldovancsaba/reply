import { AppError } from "../errors.js";

export function registerProfile(app, { profile }) {
    const noQuery = (req) => { if (Object.keys(req.query).length) throw new AppError(400, "invalid_request", `Unknown parameter: ${Object.keys(req.query)[0]}.`); };
    app.get("/api/contacts/:id/profile", async (req, reply) => {
        noQuery(req);
        return reply.header("cache-control", "no-store").send(profile.get(req.params.id));
    });
    app.get("/api/contacts/:id/photo", async (req, reply) => {
        const p = profile.photo(req.params.id);
        if (!p) throw new AppError(404, "photo_not_found", "This contact has no photo.");
        return reply.header("content-type", p.mime).header("x-content-type-options", "nosniff").header("cache-control", "private, max-age=300").send(p.data);
    });
    app.put("/api/contacts/:id/profile", async (req, reply) => reply.header("cache-control", "no-store").send(profile.setProfile(req.params.id, req.body)));
    app.post("/api/contacts/:id/notes", async (req, reply) => reply.status(201).header("cache-control", "no-store").send(profile.addNote(req.params.id, req.body)));
    app.delete("/api/contacts/:id/notes/:noteId", async (req, reply) => reply.header("cache-control", "no-store").send(profile.deleteNote(req.params.id, req.params.noteId)));
}
