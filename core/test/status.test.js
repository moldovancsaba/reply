import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import { CODES, ConnectorError } from "../src/connectors/errors.js";
import { createRegistry } from "../src/connectors/registry.js";
import { createRunner } from "../src/connectors/runner.js";
import { sha256File } from "../src/helper/index.js";
import { createStatus, deriveState } from "../src/status/index.js";
import { CATALOG, describe, LABELS } from "../src/status/recovery.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { request, startServer } from "./helpers.js";

const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);
const schemaDoc = JSON.parse(readFileSync(new URL("../schema/api-status.json", import.meta.url), "utf8"));
const ajv = new Ajv({ strict: false });
ajv.addFormat("date-time", true);
ajv.addSchema(schemaDoc);
const isReport = (doc) => { const v = ajv.getSchema(`${schemaDoc.$id}#/definitions/StatusReport`); assert.ok(v(doc), JSON.stringify([v.errors, doc]).slice(0, 700)); };
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "rc-status-"));

function stubHelper({ version = "1.0.0 schema=1", counter } = {}) {
    const bin = path.join(tmp(), "helper");
    writeFileSync(bin, `#!/bin/sh\n${counter ? `echo x >> "${counter}"\n` : ""}if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\nexit 2\n`);
    chmodSync(bin, 0o755);
    writeFileSync(`${bin}.sha256`, sha256File(bin));
    return bin;
}

const fake = (id, over = {}) => ({ id, channel: "imessage", intervalMs: 60_000, accounts: async () => [""], preflight: async () => ({ ok: true }), fetch: async () => ({ messages: [], nextCursor: {}, more: false }), ...over });

function setup({ connectors = [], helper = stubHelper(), clock } = {}) {
    const home = tmp();
    const { db } = openDb(home);
    const repo = createRepo(db, { now: () => NOW });
    const runner = createRunner({ db, repo, sleep: async () => {}, now: () => NOW });
    const registry = createRegistry({ enabled: connectors.map((c) => c.id), available: Object.fromEntries(connectors.map((c) => [c.id, () => c])) });
    const next = new Map();
    const scheduler = { nextRunAt: (id) => next.get(id) ?? null };
    const t = { now: NOW };
    const status = createStatus({ db, config: { home }, registry, runner, scheduler, repo, helper, now: clock ? () => t.now : () => NOW });
    return { db, repo, runner, registry, scheduler, next, status, t, home };
}

const connectorOf = (r, id) => r.connectors.find((c) => c.id === id);

test("deriveState covers every sync_state combination", () => {
    assert.equal(deriveState(null, false), "never_synced");
    assert.equal(deriveState({ state: "idle", last_success_ms: null }, false), "never_synced");
    assert.equal(deriveState({ state: "idle", last_success_ms: 5 }, false), "ok");
    assert.equal(deriveState({ state: "running" }, false), "syncing");
    assert.equal(deriveState({ state: "idle", last_success_ms: 5 }, true), "syncing");
    assert.equal(deriveState({ state: "blocked" }, false), "blocked");
    assert.equal(deriveState({ state: "error" }, false), "error");
});

test("the recovery catalog covers every connector error code with ordered, plain steps", () => {
    for (const id of Object.keys(LABELS)) {
        for (const code of CODES) {
            const d = describe(code, id);
            assert.ok(d.message && d.message.endsWith("."), `${id}/${code} message`);
            assert.ok(Array.isArray(d.recovery) && d.recovery.length > 0, `${id}/${code} steps`);
            d.recovery.forEach((step, i) => {
                assert.equal(step.order, i + 1, `${id}/${code} steps are numbered 1..n`);
                assert.ok(step.text.length > 10);
                if (step.deepLink) assert.match(step.deepLink, /^x-apple\.systempreferences:/);
            });
        }
    }
    assert.ok(CATALOG.storage.storage_corrupt && CATALOG.storage.storage_unavailable);
    assert.match(describe("permission_denied", "imessage").recovery[0].deepLink, /Privacy_AllFiles/);
    assert.match(describe("permission_denied", "contacts").recovery[0].deepLink, /Privacy_Contacts/);
    assert.match(describe("source_missing", "apple-mail").recovery[0].text, /add an account/i);
});

test("a report shows every state with the right fields and rolls up to blocked", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    let page = 0;
    const syncing = fake("syncing", { fetch: async () => { if (page++ === 0) return { messages: [{ channel: "imessage", account: "", providerMessageKey: "a", threadKey: "t", handle_norm: "+12125550100", isFromMe: false, tsMs: NOW - 1000, text: "x", attachments: [] }], nextCursor: { p: 1 }, more: true }; await gate; return { messages: [], nextCursor: { p: 1 }, more: false }; } });
    const s = setup({ connectors: [fake("imessage"), fake("apple-mail"), fake("contacts"), fake("whatsapp"), syncing] });
    s.repo.setSyncState("apple-mail", "", { state: "idle", last_success_ms: NOW - 5000, messages_total: 5 });
    s.repo.setSyncState("contacts", "", { state: "blocked", last_error_code: "permission_denied", last_error_ms: NOW - 1000 });
    s.repo.setSyncState("whatsapp", "", { state: "error", last_error_code: "timeout", last_error_ms: NOW - 2000, last_success_ms: NOW - 99999 });
    s.next.set("whatsapp", NOW + 30_000);
    s.next.set("apple-mail", NOW + 120_000);
    const run = s.runner.start(syncing, "");
    for (let i = 0; i < 100 && !s.runner.progress("syncing", ""); i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 30)); // first page committed, second page waiting
    const r = await s.status.build();
    isReport(r);
    assert.deepEqual(r.connectors.map((c) => [c.id, c.state]), [["imessage", "never_synced"], ["apple-mail", "ok"], ["contacts", "blocked"], ["whatsapp", "error"], ["syncing", "syncing"]]);
    const mail = connectorOf(r, "apple-mail");
    assert.deepEqual([mail.messagesTotal, mail.nextRunAt, mail.message], [5, new Date(NOW + 120_000).toISOString(), "Up to date."]);
    const contacts = connectorOf(r, "contacts");
    assert.deepEqual([contacts.code, contacts.message], ["permission_denied", "Reply Core is not allowed to read your Contacts."]);
    assert.match(contacts.recovery[0].deepLink, /Privacy_Contacts/);
    const wa = connectorOf(r, "whatsapp");
    assert.deepEqual([wa.code, wa.retryAt, wa.recovery], ["timeout", new Date(NOW + 30_000).toISOString(), undefined]);
    assert.equal(connectorOf(r, "syncing").messagesThisRun, 1);
    assert.equal(connectorOf(r, "imessage").message, "Not synced yet.");
    assert.equal(r.overall, "blocked");
    assert.equal(r.helper.state, "ok");
    assert.deepEqual([r.storage.state, r.storage.version >= 5, r.storage.dbBytes > 0], ["ok", true, true]);
    release();
    await run.done;
});

test("overall: ok, degraded (an error) and blocked (a blocked source, a bad helper, bad storage)", async () => {
    const a = setup({ connectors: [fake("imessage")] });
    a.repo.setSyncState("imessage", "", { state: "idle", last_success_ms: NOW });
    assert.equal((await a.status.build()).overall, "ok");
    const b = setup({ connectors: [fake("imessage")] });
    b.repo.setSyncState("imessage", "", { state: "error", last_error_code: "internal", last_error_ms: NOW });
    assert.equal((await b.status.build()).overall, "degraded");
    const c = setup({ connectors: [fake("imessage")], helper: "/nonexistent/helper" });
    c.repo.setSyncState("imessage", "", { state: "idle", last_success_ms: NOW });
    const rc = await c.status.build();
    assert.deepEqual([rc.helper.state, rc.overall], ["missing", "blocked"]);
});

test("helper states: ok with version, missing, checksum mismatch", async () => {
    const ok = await setup({ helper: stubHelper({ version: "1.2.3 schema=1" }) }).status.build();
    assert.deepEqual(ok.helper, { state: "ok", version: "1.2.3 schema=1" });
    assert.equal((await setup({ helper: "/nonexistent/helper" }).status.build()).helper.state, "missing");
    const bad = stubHelper();
    writeFileSync(bad, "#!/bin/sh\necho tampered\n");
    assert.equal((await setup({ helper: bad }).status.build()).helper.state, "checksum_mismatch");
    assert.equal((await setup({ helper: stubHelper({ version: "1.0.0 schema=9" }) }).status.build()).helper.state, "missing", "a helper with an unsupported schema counts as unusable");
});

test("storage failure is reported with a recovery path", async () => {
    const s = setup();
    const broken = { prepare: () => { throw Object.assign(new Error("database disk image is malformed"), { code: "SQLITE_CORRUPT" }); } };
    const status = createStatus({ db: broken, config: { home: s.home }, registry: s.registry, runner: s.runner, scheduler: s.scheduler, repo: s.repo, helper: stubHelper(), now: () => NOW });
    const r = await status.build();
    assert.deepEqual([r.storage.state, r.storage.code, r.overall], ["error", "storage_corrupt", "blocked"]);
    assert.ok(r.storage.recovery.length >= 2);
    isReport(r);
});

test("the helper is probed at most every 30 s and a report is reused for 2 s", async () => {
    const counter = path.join(tmp(), "count");
    writeFileSync(counter, "");
    const s = setup({ helper: stubHelper({ counter }), clock: true });
    const spawns = () => readFileSync(counter, "utf8").split("\n").filter(Boolean).length;
    const first = await s.status.build();
    for (let i = 0; i < 20; i++) await s.status.build();
    assert.equal(spawns(), 1, "20 requests, one helper call");
    s.t.now += 2500; // report expires, helper cache still valid
    assert.notEqual((await s.status.build()).generatedAt, first.generatedAt);
    assert.equal(spawns(), 1);
    s.t.now += 31_000;
    await s.status.build();
    assert.equal(spawns(), 2);
});

test("a last-success time in the future is clamped to now", async () => {
    const s = setup({ connectors: [fake("imessage")] });
    s.repo.setSyncState("imessage", "", { state: "idle", last_success_ms: NOW + 3_600_000 });
    assert.equal(connectorOf(await s.status.build(), "imessage").lastSuccessAt, new Date(NOW).toISOString());
});

test("several accounts are aggregated: the worst state on top, every account listed", async () => {
    const multi = fake("multi", { accounts: async () => ["a", "b"] });
    const s = setup({ connectors: [multi] });
    s.repo.setSyncState("multi", "a", { state: "idle", last_success_ms: NOW, messages_total: 3 });
    s.repo.setSyncState("multi", "b", { state: "blocked", last_error_code: "auth_failed", messages_total: 4 });
    const c = connectorOf(await s.status.build(), "multi");
    assert.deepEqual([c.state, c.code, c.messagesTotal, c.accounts.map((a) => [a.account, a.state])], ["blocked", "auth_failed", 7, [["a", "ok"], ["b", "blocked"]]]);
    assert.match(c.recovery[0].text, /app password/);
});

test("recheck: forgets caches, clears a source that now works and starts its sync", async () => {
    let allowed = false;
    let fetched = 0;
    const gated = fake("imessage", { preflight: async () => (allowed ? { ok: true } : { ok: false, code: "permission_denied" }), fetch: async () => { fetched++; return { messages: [], nextCursor: {}, more: false }; } });
    const s = setup({ connectors: [gated] });
    s.repo.setSyncState("imessage", "", { state: "blocked", last_error_code: "permission_denied" });
    const still = await s.status.recheck();
    assert.deepEqual([connectorOf(still, "imessage").state, fetched], ["blocked", 0]);
    allowed = true;
    const after = await s.status.recheck();
    await s.runner.waitIdle();
    assert.ok(["syncing", "ok", "never_synced"].includes(connectorOf(after, "imessage").state));
    assert.equal(fetched, 1);
    assert.equal(s.repo.getSyncState("imessage", "").state, "idle");
    assert.equal(connectorOf(await s.status.recheck(), "imessage").state, "ok");
});

test("the report never contains message content or contact details", async () => {
    const s = setup({ connectors: [fake("imessage")] });
    s.repo.upsertMessages([{ channel: "imessage", account: "", providerMessageKey: "k", threadKey: "t", handle_norm: "+36301234567", isFromMe: false, tsMs: NOW - 1000, text: "secret words", attachments: [] }]);
    s.repo.setSyncState("imessage", "", { state: "idle", last_success_ms: NOW, messages_total: 1 });
    const json = JSON.stringify(await s.status.build());
    for (const secret of ["secret words", "36301234567"]) assert.ok(!json.includes(secret), secret);
});

test("HTTP: GET /api/status with ETag/304 and POST /api/status/recheck", async (t) => {
    const s = setup({ connectors: [fake("imessage", { preflight: async () => ({ ok: false, code: "permission_denied" }) })] });
    s.repo.setSyncState("imessage", "", { state: "blocked", last_error_code: "permission_denied" });
    const { app, port } = await startServer({ deps: { status: s.status } });
    t.after(() => app.close());
    const get = (p, headers = {}) => request(port, { path: p, headers: { host: `127.0.0.1:${port}`, ...headers } });
    const r = await get("/api/status");
    assert.equal(r.status, 200);
    isReport(r.json);
    assert.match(r.headers.etag, /^W\/"[0-9a-f]{20}"$/);
    assert.equal((await get("/api/status", { "if-none-match": r.headers.etag })).status, 304);
    const re = await request(port, { method: "POST", path: "/api/status/recheck", headers: { host: `127.0.0.1:${port}` } });
    assert.equal(re.status, 200);
    isReport(re.json);
    assert.equal(re.headers["cache-control"], "no-store");
    assert.equal(connectorOf(re.json, "imessage").state, "blocked");
});

test("a report that cannot be built is a retryable status_unavailable", async (t) => {
    const status = { build: async () => { throw new Error("boom"); }, recheck: async () => { throw new Error("boom"); }, etagOf: () => "x" };
    const { app, port } = await startServer({ deps: { status } });
    t.after(() => app.close());
    const r = await request(port, { path: "/api/status", headers: { host: `127.0.0.1:${port}` } });
    assert.deepEqual([r.status, r.json.error.code, r.json.error.retryable], [500, "status_unavailable", true]);
    assert.equal(new ConnectorError("timeout", "x").retryable, true);
});
