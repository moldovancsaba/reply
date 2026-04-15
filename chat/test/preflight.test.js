"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { buildPreflightReport, PREFLIGHT_SCHEMA_VERSION, API_CONTRACT_HUB } = require("../preflight.js");

function baseHealth(overrides = {}) {
    return {
        version: "0.0.0-test",
        db: { status: "ok" },
        services: {
            worker: { status: "online" },
            openclaw: { status: "online" },
            ollama: { status: "online" },
            hatori_api: { status: "skipped" }
        },
        ...overrides
    };
}

const pathsOk = {
    imessageDbPath: "/tmp/imsg",
    imessageDbReadable: true,
    whatsappDbPath: "/tmp/wa",
    whatsappDbReadable: true
};

test("buildPreflightReport: ready when worker, db, and required services ok", (t) => {
    const prev = process.env.REPLY_USE_HATORI;
    t.after(() => {
        if (prev === undefined) delete process.env.REPLY_USE_HATORI;
        else process.env.REPLY_USE_HATORI = prev;
    });
    process.env.REPLY_USE_HATORI = "0";
    const r = buildPreflightReport(baseHealth(), pathsOk, {
        settings: { global: { allowOpenClaw: true } }
    });
    assert.strictEqual(r.overall, "ready");
    assert.strictEqual(r.schemaVersion, PREFLIGHT_SCHEMA_VERSION);
    assert.ok(r.runId && r.runId.length > 8);
    assert.ok(Array.isArray(r.checks) && r.checks.length >= 6);
});

test("buildPreflightReport: blocked when worker offline", (t) => {
    const prev = process.env.REPLY_USE_HATORI;
    t.after(() => {
        if (prev === undefined) delete process.env.REPLY_USE_HATORI;
        else process.env.REPLY_USE_HATORI = prev;
    });
    process.env.REPLY_USE_HATORI = "0";
    const h = baseHealth({
        services: {
            ...baseHealth().services,
            worker: { status: "offline" }
        }
    });
    const r = buildPreflightReport(h, pathsOk, { settings: {} });
    assert.strictEqual(r.overall, "blocked");
    assert.ok(r.checks.some((c) => c.id === "background_worker" && c.status === "blocked"));
});

test("buildPreflightReport: openclaw critical when send transport needs it and gateway offline", (t) => {
    const prevH = process.env.REPLY_USE_HATORI;
    t.after(() => {
        if (prevH === undefined) delete process.env.REPLY_USE_HATORI;
        else process.env.REPLY_USE_HATORI = prevH;
    });
    process.env.REPLY_USE_HATORI = "0";
    process.env.REPLY_WHATSAPP_SEND_TRANSPORT = "openclaw_cli";
    try {
        const h = baseHealth({
            services: {
                ...baseHealth().services,
                openclaw: { status: "offline" }
            }
        });
        const r = buildPreflightReport(h, pathsOk, {
            settings: { global: { allowOpenClaw: true } }
        });
        assert.strictEqual(r.overall, "blocked");
        const oc = r.checks.find((c) => c.id === "openclaw_gateway");
        assert.strictEqual(oc.status, "blocked");
        assert.strictEqual(oc.severity, "critical");
    } finally {
        delete process.env.REPLY_WHATSAPP_SEND_TRANSPORT;
    }
});

test("API_CONTRACT_HUB is a non-empty semver-like label", () => {
    assert.match(API_CONTRACT_HUB, /^\d+\.\d+$/);
});

test("buildPreflightReport: Hatori lanes degraded when an agent is not ok", (t) => {
    const prev = process.env.REPLY_USE_HATORI;
    t.after(() => {
        if (prev === undefined) delete process.env.REPLY_USE_HATORI;
        else process.env.REPLY_USE_HATORI = prev;
    });
    process.env.REPLY_USE_HATORI = "1";
    const h = baseHealth({
        services: {
            ...baseHealth().services,
            hatori_api: {
                status: "online",
                detail: "ok · writer / drafter / judge",
                agents: [
                    { role: "writer", ok: true },
                    { role: "drafter", ok: false },
                    { role: "judge", ok: true }
                ],
                ui_url: "http://127.0.0.1:23571/chat"
            }
        }
    });
    const r = buildPreflightReport(h, pathsOk, { settings: {} });
    const row = r.checks.find((c) => c.id === "hatori_api");
    assert.strictEqual(row.status, "degraded");
    assert.strictEqual(row.severity, "warning");
});
