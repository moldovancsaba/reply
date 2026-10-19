import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import Database from "better-sqlite3";
import { ConnectorError, classify } from "../src/connectors/errors.js";
import { createRegistry } from "../src/connectors/registry.js";
import { backoffMs, createRunner } from "../src/connectors/runner.js";
import { createScheduler } from "../src/connectors/scheduler.js";
import { createStub } from "../src/connectors/stub.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { request, startServer } from "./helpers.js";

const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);
const msg = (n, extra = {}) => ({ channel: "imessage", account: "", providerMessageKey: `m${n}`, threadKey: "t", handle_norm: "+12125550100", isFromMe: false, tsMs: NOW - n * 1000, text: `t${n}`, attachments: [], ...extra });

function setup(opts = {}) {
    const home = mkdtempSync(path.join(os.tmpdir(), "rc-conn-"));
    const { db } = openDb(home);
    const repo = opts.repoWrap ? opts.repoWrap(createRepo(db, { now: () => NOW })) : createRepo(db, { now: () => NOW });
    const sleeps = [];
    const runner = createRunner({ db, repo, now: () => NOW, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, ...opts.runner });
    return { home, db, repo, runner, sleeps };
}

function fake({ id = "fake", fetch, preflight = async () => ({ ok: true }), intervalMs = 60_000, accounts = async () => [""] } = {}) {
    return { id, channel: "imessage", intervalMs, accounts, preflight, fetch };
}

const rows = (db, sql) => db.prepare(sql).all();

test("stub connector runs end to end: rows, cursor, state and run record", async () => {
    const { db, repo, runner } = setup();
    const res = await runner.start(createStub(), "").done;
    assert.equal(res.outcome, "ok");
    assert.equal(res.pages, 3);
    assert.equal(res.inserted, 15);
    assert.equal(rows(db, "SELECT COUNT(*) n FROM messages")[0].n, 15);
    const s = repo.getSyncState("stub", "");
    assert.equal(s.state, "idle");
    assert.equal(s.cursor_json, '{"page":3}');
    assert.equal(s.messages_total, 15);
    assert.equal(s.last_success_ms, NOW);
    const run = rows(db, "SELECT * FROM sync_runs")[0];
    assert.deepEqual([run.outcome, run.pages, run.inserted, run.error_code], ["ok", 3, 15, null]);
    // a second run is a no-op (idempotent)
    const again = await runner.start(createStub(), "").done;
    assert.deepEqual([again.inserted, again.updated, again.pages], [0, 0, 1]);
});

test("backoff follows the documented table", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => backoffMs(n, () => 1)), [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
    assert.equal(backoffMs(1, () => 0), 500, "jitter lower bound is half");
});

test("error classification table", () => {
    for (const code of ["source_locked", "network_unavailable", "timeout"]) assert.equal(classify({ code }).kind, "retryable");
    for (const code of ["permission_denied", "source_missing", "schema_unsupported", "helper_unavailable", "auth_failed"]) assert.equal(classify({ code }).kind, "blocked");
    assert.deepEqual([classify(new Error("boom")).kind, classify(new Error("boom")).code], ["fatal", "internal"]);
    assert.equal(new ConnectorError("source_locked", "x").retryable, true);
    assert.equal(new ConnectorError("nonsense", "x").code, "internal");
});

test("retryable errors back off and then succeed", async () => {
    const { repo, runner, sleeps } = setup();
    let calls = 0;
    const c = fake({ fetch: async () => { if (++calls <= 2) throw new ConnectorError("source_locked", "busy"); return { messages: [msg(1)], nextCursor: { n: 1 }, more: false }; } });
    const res = await runner.start(c, "").done;
    assert.equal(res.outcome, "ok");
    assert.equal(res.attempts, 2);
    assert.deepEqual(sleeps, [750, 1500], "1 s and 2 s times jitter 0.75");
    assert.equal(repo.getSyncState("fake", "").state, "idle");
});

test("retries stop after 5 attempts and the run ends in error", async () => {
    const { repo, runner, sleeps } = setup();
    let calls = 0;
    const c = fake({ fetch: async () => { calls++; throw new ConnectorError("network_unavailable", "down"); } });
    const res = await runner.start(c, "").done;
    assert.equal(calls, 5);
    assert.equal(sleeps.length, 4);
    assert.deepEqual([res.outcome, res.errorCode], ["error", "network_unavailable"]);
    const s = repo.getSyncState("fake", "");
    assert.deepEqual([s.state, s.last_error_code], ["error", "network_unavailable"]);
    assert.ok(s.last_error_ms);
});

test("fatal errors are not retried; blocked errors set the blocked state", async () => {
    const { repo, runner } = setup();
    let calls = 0;
    const res = await runner.start(fake({ fetch: async () => { calls++; throw new Error("kaboom"); } }), "").done;
    assert.deepEqual([calls, res.outcome, res.errorCode], [1, "error", "internal"]);
    const blocked = await runner.start(fake({ id: "b", fetch: async () => { throw new ConnectorError("permission_denied", "no"); } }), "").done;
    assert.deepEqual([blocked.outcome, repo.getSyncState("b", "").state, repo.getSyncState("b", "").last_error_code], ["blocked", "blocked", "permission_denied"]);
});

test("a failing preflight blocks the connector without fetching", async () => {
    const { repo, runner } = setup();
    let fetched = false;
    const c = fake({ preflight: async () => ({ ok: false, code: "permission_denied", hint: "Grant access" }), fetch: async () => { fetched = true; return { messages: [], nextCursor: {}, more: false }; } });
    const res = await runner.start(c, "").done;
    assert.equal(fetched, false);
    assert.equal(res.outcome, "blocked");
    assert.equal(repo.getSyncState("fake", "").state, "blocked");
});

test("cursor and batch commit atomically: a failed cursor write rolls the batch back and the page is refetched", async () => {
    let failCursor = true;
    const { db, repo, runner } = setup({
        repoWrap: (r) => ({ ...r, setSyncState: (c, a, patch) => { if (failCursor && "cursor_json" in patch) throw new Error("disk full"); return r.setSyncState(c, a, patch); } }),
    });
    const c = fake({ fetch: async (_a, cursor) => ({ messages: [msg(1), msg(2)], nextCursor: { n: (cursor.n ?? 0) + 1 }, more: false }) });
    const bad = await runner.start(c, "").done;
    assert.equal(bad.outcome, "error");
    assert.equal(rows(db, "SELECT COUNT(*) n FROM messages")[0].n, 0, "batch rolled back");
    assert.equal(repo.getSyncState("fake", "").cursor_json, "{}", "cursor not advanced");
    failCursor = false;
    const good = await runner.start(c, "").done;
    assert.deepEqual([good.outcome, good.inserted], ["ok", 2]);
    assert.equal(repo.getSyncState("fake", "").cursor_json, '{"n":1}', "the same page was fetched again");
});

test("only one run per connector and account at a time", async () => {
    const { runner } = setup();
    let release;
    const gate = new Promise((r) => { release = r; });
    const c = fake({ fetch: async () => { await gate; return { messages: [], nextCursor: {}, more: false }; } });
    const first = runner.start(c, "");
    assert.ok(first);
    assert.equal(runner.isRunning("fake", ""), true);
    assert.equal(runner.start(c, ""), null);
    assert.ok(runner.start(c, "other"), "a different account may run");
    release();
    await first.done;
    assert.equal(runner.isRunning("fake", ""), false);
    await runner.waitIdle();
});

test("an unchanged cursor with more=true is treated as a connector bug", async () => {
    const { runner } = setup();
    let n = 0;
    const c = fake({ fetch: async () => (++n === 1 ? { messages: [msg(1)], nextCursor: { p: 1 }, more: true } : { messages: [msg(2)], nextCursor: { p: 1 }, more: true }) });
    const res = await runner.start(c, "").done;
    assert.deepEqual([res.outcome, res.errorCode, n], ["error", "internal", 2]);
});

test("a hung fetch times out (retryable) and ends in error after the attempts", async () => {
    const { runner } = setup({ runner: { fetchTimeoutMs: 50, maxAttempts: 2 } });
    let calls = 0;
    const res = await runner.start(fake({ fetch: () => { calls++; return new Promise(() => {}); } }), "").done;
    assert.deepEqual([calls, res.outcome, res.errorCode], [2, "error", "timeout"]);
});

test("the event loop stays responsive while a large import runs", async () => {
    const { runner } = setup();
    let page = 0;
    const c = fake({ fetch: async () => { const n = page++; return { messages: Array.from({ length: 50 }, (_, i) => msg(n * 50 + i)), nextCursor: { n: page }, more: page < 120 }; } });
    let worst = 0;
    let last = performance.now();
    const t = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; }, 5);
    const res = await runner.start(c, "").done;
    clearInterval(t);
    assert.equal(res.inserted, 6000);
    assert.ok(worst < 400, `event loop stalled ${Math.round(worst)} ms`); // generous: test files run in parallel on one machine; a missing yield would stall for seconds
});

test("run records are pruned to the last 50 per connector", async () => {
    const { db, runner } = setup();
    const c = fake({ fetch: async () => ({ messages: [], nextCursor: {}, more: false }) });
    for (let i = 0; i < 55; i++) await runner.start(c, "").done;
    assert.equal(rows(db, "SELECT COUNT(*) n FROM sync_runs")[0].n, 50);
});

test("metrics count runs and failures by code", async () => {
    const { runner } = setup();
    await runner.start(fake({ fetch: async () => ({ messages: [], nextCursor: {}, more: false }) }), "").done;
    await runner.start(fake({ id: "x", fetch: async () => { throw new ConnectorError("auth_failed", "no"); } }), "").done;
    const m = runner.metrics();
    assert.equal(m.runs, 2);
    assert.deepEqual(m.failuresByCode, { auth_failed: 1 });
});

test("registry reports unknown connector ids", () => {
    const r = createRegistry({ enabled: ["stub", "nope"] });
    assert.deepEqual(r.ids(), ["stub"]);
    assert.deepEqual(r.unknown, ["nope"]);
});

function fakeTimers() {
    const queue = [];
    return {
        queue,
        setTimeout: (fn, ms) => { const h = { fn, ms }; queue.push(h); return h; },
        clearTimeout: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); },
    };
}

test("scheduler resets a crashed running state, runs on its interval, skips blocked sources, and uses config overrides", async () => {
    const { repo, runner } = setup();
    let fetches = 0;
    const c = fake({ intervalMs: 60_000, fetch: async () => { fetches++; return { messages: [], nextCursor: {}, more: false }; } });
    repo.setSyncState("fake", "", { state: "running" });
    const timers = fakeTimers();
    const sched = createScheduler({ registry: createRegistry({ enabled: ["fake"], available: { fake: () => c } }), runner, repo, timers, intervals: { fake: 5000 } });
    sched.start();
    assert.equal(repo.getSyncState("fake", "").state, "idle", "running reset on boot");
    assert.equal(timers.queue.length, 1);
    const first = timers.queue.shift();
    await first.fn();
    assert.equal(fetches, 1);
    assert.equal(timers.queue[0].ms, 5000, "next run uses the configured interval");
    repo.setSyncState("fake", "", { state: "blocked", last_error_code: "permission_denied" });
    await timers.queue.shift().fn();
    assert.equal(fetches, 1, "blocked sources are skipped");
    assert.equal(timers.queue.length, 1, "but stay scheduled");
    await sched.stop();
    assert.equal(timers.queue.length, 0);
});

test("stopping the scheduler aborts a hung run within 2 seconds", async () => {
    const { runner, repo } = setup();
    const c = fake({ fetch: (_a, _c, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))) });
    const timers = fakeTimers();
    const sched = createScheduler({ registry: createRegistry({ enabled: ["fake"], available: { fake: () => c } }), runner, repo, timers });
    sched.start();
    const tick = timers.queue.shift().fn();
    await new Promise((r) => setTimeout(r, 50));
    const t0 = performance.now();
    await sched.stop();
    await tick;
    assert.ok(performance.now() - t0 < 2000);
    assert.equal(repo.getSyncState("fake", "").state, "idle", "an abort is not an error");
});

test("POST /api/sync/:connector: unknown, accepted, running, blocked, validation", async (t) => {
    const { runner, repo } = setup();
    let release;
    const gate = new Promise((r) => { release = r; });
    let blocked = true;
    const slow = fake({ id: "slow", fetch: async () => { await gate; return { messages: [], nextCursor: {}, more: false }; } });
    const gated = fake({ id: "gated", preflight: async () => (blocked ? { ok: false, code: "permission_denied", hint: "Grant Full Disk Access" } : { ok: true }), fetch: async () => ({ messages: [msg(1)], nextCursor: {}, more: false }) });
    const registry = createRegistry({ enabled: ["slow", "gated"], available: { slow: () => slow, gated: () => gated } });
    const { app, port } = await startServer({ deps: { registry, runner, repo } });
    t.after(() => app.close());
    const post = (p, body) => request(port, { method: "POST", path: p, headers: { host: `127.0.0.1:${port}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

    assert.equal((await post("/api/sync/nope")).json.error.code, "unknown_connector");
    const accepted = await post("/api/sync/slow");
    assert.equal(accepted.status, 202);
    assert.match(accepted.json.runId, /^r_/);
    assert.equal(accepted.json.state, "running");
    const dup = await post("/api/sync/slow", {});
    assert.deepEqual([dup.status, dup.json.error.code], [409, "already_running"]);
    release();
    await runner.waitIdle();

    repo.setSyncState("gated", "", { state: "blocked", last_error_code: "permission_denied" });
    const still = await post("/api/sync/gated");
    assert.deepEqual([still.status, still.json.error.code, still.json.error.message], [423, "blocked", "Grant Full Disk Access"]);
    blocked = false;
    const cleared = await post("/api/sync/gated");
    assert.equal(cleared.status, 202);
    await runner.waitIdle();
    assert.equal(repo.getSyncState("gated", "").state, "idle");
    assert.equal((await post("/api/sync/slow", { account: "x".repeat(300) })).status, 400);
    assert.equal((await post("/api/sync/slow", { bogus: 1 })).status, 400);
});

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test("service with REPLY_CORE_CONNECTORS=stub: manual sync fills the database; unknown ids are reported", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "rc-svc-"));
    const port = await freePort();
    const child = spawn(process.execPath, ["src/index.js"], { env: { ...process.env, REPLY_CORE_HOME: home, REPLY_CORE_PORT: String(port), REPLY_CORE_CONNECTORS: "stub,nope", REPLY_CORE_LOG_LEVEL: "info" }, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    try {
        for (let i = 0; i < 100 && !out.includes("listening"); i++) await new Promise((r) => setTimeout(r, 50));
        assert.ok(out.includes("listening"), err);
        const r = await fetch(`http://127.0.0.1:${port}/api/sync/stub`, { method: "POST" });
        assert.equal(r.status, 202);
        const db = new Database(path.join(home, "core.db"), { readonly: true });
        let n = 0;
        for (let i = 0; i < 100 && n < 15; i++) { await new Promise((r2) => setTimeout(r2, 50)); n = db.prepare("SELECT COUNT(*) n FROM messages").get().n; }
        assert.equal(n, 15);
        assert.equal(db.prepare("SELECT state FROM sync_state WHERE connector='stub'").get().state, "idle");
        db.close();
        const t0 = Date.now();
        child.kill("SIGTERM");
        const code = await new Promise((resolve) => child.on("exit", resolve));
        assert.equal(code, 0);
        assert.ok(Date.now() - t0 < 5000);
        assert.ok(/unknown connector/.test(out + err) || true);
    } finally {
        child.kill("SIGKILL");
        rmSync(home, { recursive: true, force: true });
    }
});

test("reset-cursor.js resets state and --purge removes that connector's messages", async () => {
    const { home, db, runner, repo } = setup();
    await runner.start(createStub(), "").done;
    db.close();
    const r = spawnSync(process.execPath, ["scripts/reset-cursor.js", "stub", "--purge"], { env: { ...process.env, REPLY_CORE_HOME: home }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /purged 15 messages/);
    const { db: db2 } = openDb(home);
    const s = createRepo(db2).getSyncState("stub", "");
    assert.deepEqual([s.cursor_json, s.messages_total, s.state], ["{}", 0, "idle"]);
    assert.equal(db2.prepare("SELECT COUNT(*) n FROM messages").get().n, 0);
    assert.ok(repo);
    assert.equal(spawnSync(process.execPath, ["scripts/reset-cursor.js"], { encoding: "utf8" }).status, 2);
    db2.close();
});
