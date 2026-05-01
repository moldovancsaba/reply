/**
 * {reply} - Channel Bridge Routes
 * Handles external inbound events and provides sync summaries.
 */

const { writeJson, readJsonBody } = require("../utils/server-utils");
const { readSettings, getChannelBridgeInboundMode, CHANNEL_BRIDGE_CHANNELS } = require("../settings-store");
const {
    normalizeInboundEvent,
    toVectorDoc,
    ingestInboundEvent,
    ingestInboundEvents,
    readBridgeEventLog
} = require("../channel-bridge");

async function serveInbound(req, res, invalidateCaches) {
    try {
        const payload = await readJsonBody(req);
        const events = Array.isArray(payload)
            ? payload
            : (Array.isArray(payload?.events) ? payload.events : [payload]);

        if (!events.length) {
            writeJson(res, 400, { error: "Inbound payload is empty." });
            return;
        }

        const settings = readSettings();
        const normalizedForPolicy = events.map((evt) => normalizeInboundEvent(evt));
        const denied = normalizedForPolicy
            .map((event, index) => ({
                index,
                channel: event.channel,
                inboundMode: getChannelBridgeInboundMode(settings, event.channel),
            }))
            .filter((x) => x.inboundMode !== "draft_only");

        if (denied.length > 0) {
            writeJson(res, 403, {
                error: "Channel bridge inbound is disabled for one or more channels.",
                code: "channel_bridge_disabled",
                denied,
            });
            return;
        }

        const globalDryRun = payload?.dryRun === true;
        const allDryRun = globalDryRun || events.every((evt) => evt?.dryRun === true);

        if (allDryRun) {
            const normalized = normalizedForPolicy.map((event, idx) => {
                const doc = toVectorDoc(event);
                return {
                    index: idx,
                    status: "dry-run",
                    event,
                    doc: { id: doc.id, source: doc.source, path: doc.path },
                };
            });

            writeJson(res, 200, normalized.length === 1 ? normalized[0] : {
                status: "dry-run",
                total: normalized.length,
                results: normalized,
            });
            return;
        }

        const ingestInput = globalDryRun
            ? events.map((evt) => ({ ...(evt || {}), dryRun: false }))
            : events;

        if (ingestInput.length === 1) {
            const out = await ingestInboundEvent(ingestInput[0]);
            if (!out.duplicate && invalidateCaches) invalidateCaches();
            writeJson(res, 200, {
                status: out.duplicate ? "duplicate" : "ok",
                event: out.event,
                doc: out.doc,
                duplicate: Boolean(out.duplicate),
            });
            return;
        }

        const out = await ingestInboundEvents(ingestInput, { failFast: false });
        if (out.accepted > 0 && invalidateCaches) invalidateCaches();
        writeJson(res, 200, {
            status: out.errors > 0 ? "partial" : "ok",
            accepted: out.accepted,
            skipped: out.skipped,
            errors: out.errors,
            total: out.total,
            results: out.results,
        });
    } catch (e) {
        writeJson(res, 400, { error: e?.message || "Invalid channel bridge payload" });
    }
}

function serveEventsList(req, res, url) {
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 500));
    const events = readBridgeEventLog(limit);
    writeJson(res, 200, {
        status: "ok",
        total: events.length,
        events,
    });
}

function serveSummary(req, res, url) {
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 2000));
    const events = readBridgeEventLog(limit);
    const settings = readSettings();
    const counts = { total: events.length, ingested: 0, duplicate: 0, error: 0, other: 0 };
    const channels = {};
    let lastEventAt = null;
    let lastErrorAt = null;

    for (const evt of events) {
        const status = String(evt?.status || "").toLowerCase();
        const channel = String(evt?.channel || "unknown").toLowerCase() || "unknown";
        const at = String(evt?.at || "").trim();

        if (status === "ingested") counts.ingested += 1;
        else if (status === "duplicate") counts.duplicate += 1;
        else if (status === "error") counts.error += 1;
        else counts.other += 1;

        if (!channels[channel]) {
            channels[channel] = { ingested: 0, duplicate: 0, error: 0, other: 0, total: 0, lastAt: null };
        }
        channels[channel].total += 1;
        if (status === "ingested") channels[channel].ingested += 1;
        else if (status === "duplicate") channels[channel].duplicate += 1;
        else if (status === "error") channels[channel].error += 1;
        else channels[channel].other += 1;
        if (at) channels[channel].lastAt = at;
        if (at) lastEventAt = at;
        if (status === "error" && at) lastErrorAt = at;
    }

    writeJson(res, 200, {
        status: "ok",
        summary: {
            limit,
            sampleSize: events.length,
            counts,
            channels,
            rollout: Object.fromEntries(
                CHANNEL_BRIDGE_CHANNELS.map((channel) => [
                    channel,
                    getChannelBridgeInboundMode(settings, channel),
                ])
            ),
            lastEventAt,
            lastErrorAt,
        }
    });
}

module.exports = {
    serveInbound,
    serveEventsList,
    serveSummary
};
