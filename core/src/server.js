import { randomUUID } from "node:crypto";
import Fastify, { LogController } from "fastify";
import { forbidden, toEnvelope } from "./errors.js";
import { registerHealth } from "./routes/health.js";
import { registerIdentity } from "./routes/identity.js";
import { registerRead } from "./routes/read.js";
import { registerStatus } from "./routes/status.js";
import { registerSync } from "./routes/sync.js";

const BODY_LIMIT = 1024 * 1024;

// Blocks DNS-rebinding (foreign Host) and drive-by browser requests (foreign Origin).
// The allowed values are derived from the port the socket really listens on, so ephemeral ports work in tests.
export function guards(config) {
    return async function onRequest(req) {
        const port = req.raw.socket.localPort;
        const host = String(req.headers.host || "").toLowerCase();
        if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
            throw forbidden("forbidden_host", "This service only answers on its own loopback address.");
        }
        const origin = req.headers.origin;
        if (origin) {
            const own = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
            if (!own.includes(origin) && !config.allowedOrigins.includes(origin)) {
                throw forbidden("forbidden_origin", "This origin is not allowed to call the service.");
            }
        }
    };
}

export function createServer(config, logger, deps = {}) {
    const app = Fastify({
        loggerInstance: logger,
        logController: new LogController({ disableRequestLogging: true }),
        bodyLimit: BODY_LIMIT,
        genReqId: () => `req_${randomUUID().slice(0, 12)}`,
    });

    // Same as Fastify's default JSON parser except that an empty body is `{}`: clients that send a JSON content type with no body are fine.
    app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
        if (body === "") return done(null, {});
        try {
            done(null, JSON.parse(body));
        } catch (err) {
            err.statusCode = 400;
            done(err);
        }
    });

    app.addHook("onRequest", guards(config));
    app.addHook("onResponse", async (req, reply) => {
        req.log.info(
            { requestId: req.id, route: req.routeOptions?.url ?? "unmatched", status: reply.statusCode, durationMs: Math.round(reply.elapsedTime) },
            "request",
        );
    });

    app.setErrorHandler((err, req, reply) => {
        const { status, body } = toEnvelope(err, req.id);
        if (status >= 500) req.log.error({ requestId: req.id, err }, "request failed");
        reply.status(status).send(body);
    });
    app.setNotFoundHandler((req, reply) => {
        const { status, body } = toEnvelope({ statusCode: 404 }, req.id);
        reply.status(status).send(body);
    });

    registerHealth(app, config);
    if (deps.runner) registerSync(app, deps);
    if (deps.identity) registerIdentity(app, deps);
    if (deps.read) registerRead(app, deps);
    if (deps.status) registerStatus(app, deps);
    // API responses are never cached unless a route opts in (first pages of lists and threads revalidate by ETag)
    app.addHook("onSend", async (req, reply) => {
        if (req.url.startsWith("/api/") && !reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    });
    return app;
}

// Stops accepting requests, lets in-flight ones finish, force-resolves after drainMs.
export async function gracefulClose(app, drainMs = 5000) {
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve("timeout"), drainMs);
    });
    // Keep-alive connections that go idle after their last response would otherwise hold close() open.
    const sweep = setInterval(() => app.server.closeIdleConnections(), 50);
    const result = await Promise.race([app.close().then(() => "closed"), timeout]);
    clearTimeout(timer);
    clearInterval(sweep);
    return result;
}
