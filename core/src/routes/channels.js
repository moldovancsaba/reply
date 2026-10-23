import { createHash } from "node:crypto";
import { AppError } from "../errors.js";
import { ordered } from "../channels/registry.js";

// GET /api/channels: the channel registry, read-only, with what is enabled and what can send right now (#288).
export function registerChannels(app, { registry, sender }) {
    app.get("/api/channels", async (req, reply) => {
        const extra = Object.keys(req.query)[0];
        if (extra) throw new AppError(400, "invalid_request", `Unknown parameter: ${extra}.`);
        const items = ordered().map((d) => {
            const send = sender.capability(d.id);
            return {
                id: d.id, label: d.label, appLabel: d.appLabel, order: d.order, icon: d.icon, capabilities: { ...d.capabilities },
                enabled: registry.get(d.connector) != null, sendAvailable: send.available, sendReason: send.available ? null : (send.reason ?? null),
            };
        });
        const json = JSON.stringify({ items });
        const etag = `W/"${createHash("sha1").update(json).digest("hex").slice(0, 20)}"`;
        reply.header("etag", etag).header("cache-control", "no-cache");
        if (req.headers["if-none-match"] === etag) return reply.status(304).send();
        return reply.type("application/json").send(json);
    });
}
