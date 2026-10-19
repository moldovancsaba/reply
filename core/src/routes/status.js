import { AppError } from "../errors.js";

export function registerStatus(app, { status }) {
    const send = (req, reply, report) => {
        const etag = status.etagOf(report);
        reply.header("etag", etag).header("cache-control", "private, max-age=0, must-revalidate");
        if (req.headers["if-none-match"] === etag) return reply.status(304).send();
        return reply.send(report);
    };
    const guard = async (fn) => {
        try {
            return await fn();
        } catch (err) {
            if (err instanceof AppError) throw err;
            throw new AppError(500, "status_unavailable", "The status report could not be built.", { retryable: true });
        }
    };
    app.get("/api/status", async (req, reply) => send(req, reply, await guard(() => status.build())));
    app.post("/api/status/recheck", async (req, reply) => {
        const report = await guard(() => status.recheck());
        return reply.header("cache-control", "no-store").send(report);
    });
}
