import { createHash } from "node:crypto";
import { AppError } from "../errors.js";
import { CHANNELS } from "../storage/repo.js";

const bad = (message) => new AppError(400, "invalid_request", message);

function intParam(raw, name, def, max) {
    if (raw === undefined) return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > max) throw bad(`${name} must be an integer from 1 to ${max}.`);
    return n;
}
function channelParam(raw) {
    if (raw === undefined || raw === "" || raw === "all") return undefined;
    if (!CHANNELS.includes(raw)) throw bad(`channel must be one of ${CHANNELS.join(", ")} or all.`);
    return raw;
}
function textParam(raw, name, max) {
    if (raw === undefined) return undefined;
    if (typeof raw !== "string" || raw.length > max) throw bad(`${name} must be text of at most ${max} characters.`);
    return raw.trim() || undefined;
}
const noParams = (query, allowed) => {
    const extra = Object.keys(query).filter((k) => !allowed.includes(k));
    if (extra.length) throw bad(`Unknown parameter: ${extra[0]}.`);
};

// First pages carry an ETag so a client revalidating an unchanged list or thread gets 304; everything else is no-store.
function respond(req, reply, body, { firstPage }) {
    if (!firstPage) return reply.header("cache-control", "no-store").send(body);
    const json = JSON.stringify(body);
    const etag = `W/"${createHash("sha1").update(json).digest("hex").slice(0, 20)}"`;
    reply.header("etag", etag).header("cache-control", "private, max-age=0, must-revalidate");
    if (req.headers["if-none-match"] === etag) return reply.status(304).send();
    return reply.type("application/json; charset=utf-8").send(json);
}

export function registerRead(app, { read }) {
    app.get("/api/contacts", async (req, reply) => {
        noParams(req.query, ["q", "channel", "limit", "cursor", "includeEmpty"]);
        const cursor = textParam(req.query.cursor, "cursor", 500);
        const body = read.listContacts({
            query: textParam(req.query.q, "q", 200), channel: channelParam(req.query.channel), limit: intParam(req.query.limit, "limit", 30, 100),
            cursor, includeEmpty: req.query.includeEmpty === "true",
        });
        return respond(req, reply, body, { firstPage: !cursor });
    });

    app.get("/api/contacts/:id", async (req, reply) => {
        noParams(req.query, []);
        return reply.header("cache-control", "no-store").send(read.getContact(req.params.id));
    });

    app.get("/api/contacts/:id/messages", async (req, reply) => {
        noParams(req.query, ["before", "limit", "channel"]);
        const before = textParam(req.query.before, "before", 500);
        const body = read.getThread(req.params.id, { before, limit: intParam(req.query.limit, "limit", 50, 100), channel: channelParam(req.query.channel) });
        return respond(req, reply, body, { firstPage: !before });
    });

    app.get("/api/search", async (req, reply) => {
        noParams(req.query, ["q", "channel", "contactId", "limit", "cursor"]);
        const text = textParam(req.query.q, "q", 200);
        if (!text) throw bad("q is required.");
        if ([...text].length < 2) throw new AppError(400, "query_too_short", "Type at least 2 characters to search.");
        const body = read.search({
            q: text, channel: channelParam(req.query.channel), contactId: textParam(req.query.contactId, "contactId", 80),
            limit: intParam(req.query.limit, "limit", 30, 100), cursor: textParam(req.query.cursor, "cursor", 500),
        });
        return reply.header("cache-control", "no-store").send(body);
    });
}
