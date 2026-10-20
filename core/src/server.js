import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify, { LogController } from "fastify";
import { forbidden, toEnvelope } from "./errors.js";
import { registerHealth } from "./routes/health.js";
import { registerDrafts } from "./routes/drafts.js";
import { registerHandoff } from "./routes/handoff.js";
import { registerIdentity } from "./routes/identity.js";
import { registerProfile } from "./routes/profile.js";
import { registerRead } from "./routes/read.js";
import { registerSend } from "./routes/send.js";
import { registerStatus } from "./routes/status.js";
import { registerSync } from "./routes/sync.js";

const BODY_LIMIT = 1024 * 1024;
// The app is one same-origin page: no inline or remote scripts, no remote connections. Inline styles are allowed because the
// GDS component library sets style attributes at runtime.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

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
    const uiDir = deps.uiDir && existsSync(path.join(deps.uiDir, "index.html")) ? deps.uiDir : null;
    app.setNotFoundHandler((req, reply) => {
        // client-side routes (/inbox/123) are answered with the app; unknown API paths and non-page requests stay JSON 404s
        if (uiDir && req.method === "GET" && !req.url.startsWith("/api/") && String(req.headers.accept ?? "").includes("text/html")) return reply.sendFile("index.html");
        const { status, body } = toEnvelope({ statusCode: 404 }, req.id);
        reply.status(status).send(body);
    });
    if (uiDir) {
        app.register(fastifyStatic, {
            root: uiDir, prefix: "/", index: "index.html", cacheControl: false,
        });
    }
    app.addHook("onSend", async (_req, reply, payload) => {
        if (String(reply.getHeader("content-type") ?? "").startsWith("text/html")) {
            reply.header("content-security-policy", CSP);
            reply.header("x-content-type-options", "nosniff");
            reply.header("referrer-policy", "no-referrer");
        }
        return payload;
    });

    registerHealth(app, config);
    if (deps.runner) registerSync(app, deps);
    if (deps.identity) registerIdentity(app, deps);
    if (deps.read) registerRead(app, deps);
    if (deps.profile) registerProfile(app, deps);
    if (deps.sender) registerSend(app, deps);
    if (deps.status) registerStatus(app, deps);
    if (deps.handoffs) registerHandoff(app, deps);
    if (deps.drafting) registerDrafts(app, deps);
    // API responses are never cached unless a route opts in (first pages of lists and threads revalidate by ETag)
    app.addHook("onSend", async (req, reply) => {
        if (reply.hasHeader("cache-control")) return;
        // API answers are never cached unless a route opts in; hashed build files never change; the page itself is always revalidated
        if (req.url.startsWith("/api/")) reply.header("cache-control", "no-store");
        else if (req.url.startsWith("/assets/") && reply.statusCode === 200) reply.header("cache-control", "public, max-age=31536000, immutable");
        else if (String(reply.getHeader("content-type") ?? "").startsWith("text/html")) reply.header("cache-control", "no-cache");
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
