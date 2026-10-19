import test from "node:test";
import assert from "node:assert/strict";
import { gracefulClose } from "../src/server.js";
import { request, startServer } from "./helpers.js";

test("health returns the documented payload", async (t) => {
    const { app, port } = await startServer();
    t.after(() => app.close());
    const r = await request(port, { path: "/api/health", headers: { host: `127.0.0.1:${port}` } });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, "ok");
    assert.equal(typeof r.json.version, "string");
    assert.equal(typeof r.json.uptimeSeconds, "number");
    assert.ok(!Number.isNaN(Date.parse(r.json.time)));
});

test("binds loopback only", async (t) => {
    const { app } = await startServer();
    t.after(() => app.close());
    assert.equal(app.server.address().address, "127.0.0.1");
});

test("localhost host and own origin are accepted", async (t) => {
    const { app, port } = await startServer();
    t.after(() => app.close());
    const r = await request(port, { path: "/api/health", headers: { host: `localhost:${port}`, origin: `http://localhost:${port}` } });
    assert.equal(r.status, 200);
});

test("foreign Host is rejected with the envelope", async (t) => {
    const { app, port } = await startServer();
    t.after(() => app.close());
    const r = await request(port, { path: "/api/health", headers: { host: "evil.example" } });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, "forbidden_host");
    assert.match(r.json.error.requestId, /^req_/);
    assert.equal(r.json.error.retryable, false);
});

test("foreign Origin is rejected, configured origin is accepted", async (t) => {
    const config = { home: "/tmp/x", port: 45511, logLevel: "info", allowedOrigins: ["http://127.0.0.1:5173"], unknownKeys: [] };
    const { app, port } = await startServer({ config });
    t.after(() => app.close());
    const host = `127.0.0.1:${port}`;
    const bad = await request(port, { path: "/api/health", headers: { host, origin: "https://evil.example" } });
    assert.equal(bad.status, 403);
    assert.equal(bad.json.error.code, "forbidden_origin");
    const ok = await request(port, { path: "/api/health", headers: { host, origin: "http://127.0.0.1:5173" } });
    assert.equal(ok.status, 200);
});

test("unknown route returns a 404 envelope", async (t) => {
    const { app, port } = await startServer();
    t.after(() => app.close());
    const r = await request(port, { path: "/api/nope", headers: { host: `127.0.0.1:${port}` } });
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, "not_found");
});

test("malformed JSON gives 400 invalid_request", async (t) => {
    const { app, port } = await startServer({ setup: (a) => a.post("/echo", async (req) => req.body) });
    t.after(() => app.close());
    const r = await request(port, { method: "POST", path: "/echo", headers: { host: `127.0.0.1:${port}`, "content-type": "application/json" }, body: "{not json" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "invalid_request");
});

test("body over 1 MiB gives 413 payload_too_large", async (t) => {
    const { app, port } = await startServer({ setup: (a) => a.post("/echo", async (req) => req.body) });
    t.after(() => app.close());
    const big = JSON.stringify({ x: "a".repeat(1024 * 1024 + 10) });
    const r = await request(port, { method: "POST", path: "/echo", headers: { host: `127.0.0.1:${port}`, "content-type": "application/json" }, body: big });
    assert.equal(r.status, 413);
    assert.equal(r.json.error.code, "payload_too_large");
});

test("unexpected errors give 500 without a stack trace and are logged with the request id", async (t) => {
    const { app, port, lines } = await startServer({ setup: (a) => a.get("/boom", async () => { throw new Error("db password hunter2"); }) });
    t.after(() => app.close());
    const r = await request(port, { path: "/boom", headers: { host: `127.0.0.1:${port}` } });
    assert.equal(r.status, 500);
    assert.equal(r.json.error.code, "internal_error");
    assert.equal(r.json.error.retryable, true);
    assert.ok(!r.text.includes("hunter2"));
    assert.ok(!r.text.includes("at "));
    assert.ok(lines.join("").includes(r.json.error.requestId));
});

test("request log line carries route, status and duration but no query or body", async (t) => {
    const { app, port, lines } = await startServer();
    t.after(() => app.close());
    await request(port, { path: "/api/health?q=secret", headers: { host: `127.0.0.1:${port}` } });
    const line = lines.map((l) => JSON.parse(l)).find((l) => l.msg === "request");
    assert.equal(line.route, "/api/health");
    assert.equal(line.status, 200);
    assert.equal(typeof line.durationMs, "number");
    assert.ok(!JSON.stringify(line).includes("secret"));
});

test("graceful close lets an in-flight request finish", async () => {
    const { app, port } = await startServer({ setup: (a) => a.get("/slow", async () => { await new Promise((r) => setTimeout(r, 300)); return { done: true }; }) });
    const pending = request(port, { path: "/slow", headers: { host: `127.0.0.1:${port}` } });
    await new Promise((r) => setTimeout(r, 50));
    const closing = gracefulClose(app, 2000);
    const r = await pending;
    assert.equal(r.status, 200);
    assert.equal(r.json.done, true);
    assert.equal(await closing, "closed");
});

test("graceful close gives up after the drain deadline", async () => {
    const { app, port } = await startServer({ setup: (a) => a.get("/stuck", async () => { await new Promise((r) => setTimeout(r, 1500)); return {}; }) });
    const pending = request(port, { path: "/stuck", headers: { host: `127.0.0.1:${port}` } }).catch(() => null);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(await gracefulClose(app, 200), "timeout");
    await pending;
});
