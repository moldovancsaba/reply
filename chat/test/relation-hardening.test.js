"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {
  detectRuntimeMode,
  resolveLinkedInIngestMode,
  buildRelations,
} = require("../routes/system.js");
const { resolveLinkedInIngestMode: resolveLinkedInSyncMode } = require("../sync-linkedin.js");

test("detectRuntimeMode prefers explicit runtime mode env", () => {
  const previousMode = process.env.REPLY_RUNTIME_MODE;
  const previousRelease = process.env.REPLY_RELEASE_MODE;
  process.env.REPLY_RUNTIME_MODE = "launchd";
  process.env.REPLY_RELEASE_MODE = "1";
  try {
    assert.equal(detectRuntimeMode(), "launchd");
  } finally {
    if (previousMode == null) delete process.env.REPLY_RUNTIME_MODE;
    else process.env.REPLY_RUNTIME_MODE = previousMode;
    if (previousRelease == null) delete process.env.REPLY_RELEASE_MODE;
    else process.env.REPLY_RELEASE_MODE = previousRelease;
  }
});

test("detectRuntimeMode falls back to app-managed and session defaults", () => {
  const previousMode = process.env.REPLY_RUNTIME_MODE;
  const previousRelease = process.env.REPLY_RELEASE_MODE;
  delete process.env.REPLY_RUNTIME_MODE;
  process.env.REPLY_RELEASE_MODE = "1";
  try {
    assert.equal(detectRuntimeMode(), "app_managed");
    delete process.env.REPLY_RELEASE_MODE;
    assert.equal(detectRuntimeMode(), "session");
  } finally {
    if (previousMode == null) delete process.env.REPLY_RUNTIME_MODE;
    else process.env.REPLY_RUNTIME_MODE = previousMode;
    if (previousRelease == null) delete process.env.REPLY_RELEASE_MODE;
    else process.env.REPLY_RELEASE_MODE = previousRelease;
  }
});

test("LinkedIn ingest mode defaults to browser bridge across health + sync layers", () => {
  const previous = process.env.REPLY_LINKEDIN_INGEST_MODE;
  process.env.REPLY_LINKEDIN_INGEST_MODE = "browser_bridge";
  try {
    assert.equal(resolveLinkedInIngestMode({}), "browser_bridge");
    assert.equal(resolveLinkedInSyncMode(), "browser_bridge");
  } finally {
    if (previous == null) delete process.env.REPLY_LINKEDIN_INGEST_MODE;
    else process.env.REPLY_LINKEDIN_INGEST_MODE = previous;
  }
});

test("buildRelations reports browser bridge mode separately from sidecar runtime", () => {
  const relations = buildRelations({
    settings: {},
    services: {
      ollama: { status: "online" },
      openclaw: { status: "online" },
    },
    channels: {
      mail: { connected: true, account: "operator@example.com" },
      imessage: { state: "ok", ingestedTotal: 12, lastSuccessfulSync: "2026-05-19T10:00:00Z" },
      whatsapp: { state: "ok", ingestedTotal: 6, lastSuccessfulSync: "2026-05-19T10:00:00Z" },
      linkedin_messages: { state: "idle", message: "Bridge waiting", lastAt: "2026-05-19T10:00:00Z" },
    },
    launch: { stage: "ready" },
    runtimeMode: "session",
    nativeApp: { configured: true, status: "online", appBundlePath: "/Applications/reply.app", missingPaths: [] },
    trinityProviderStatus: "ready",
    mailProvider: "gmail",
    linkedinIngestMode: "browser_bridge",
  });

  assert.equal(relations.runtime_mode.activeMode, "session");
  assert.equal(relations.linkedin_ingest.activeMode, "browser_bridge");
  assert.equal(relations.gmail_connector.status, "online");
});

test("buildRelations exposes causal Trinity health and recovered LinkedIn state", () => {
  const dataHome = path.join(__dirname, "..", ".tmp-test-relations");
  fs.mkdirSync(dataHome, { recursive: true });
  const previousDataHome = process.env.REPLY_DATA_HOME;
  process.env.REPLY_DATA_HOME = dataHome;
  const logPath = path.join(dataHome, "trinity-runtime.log");
  fs.writeFileSync(logPath, [
    JSON.stringify({
      at: "2026-05-20T09:00:00Z",
      kind: "timeout",
      command: "suggest",
      detail: "Trinity command timed out after 45000ms: suggest",
      elapsed_ms: 45000,
      timeout_ms: 45000,
    }),
  ].join("\n"));

  try {
    const relations = buildRelations({
      settings: {},
      services: {
        ollama: { status: "online" },
        openclaw: { status: "online" },
      },
      channels: {
        mail: { connected: true, account: "operator@example.com" },
        imessage: { state: "ok", ingestedTotal: 12, lastSuccessfulSync: "2026-05-19T10:00:00Z" },
        whatsapp: {
          state: "error",
          message: "Lance commit conflict during sync",
          ingestedTotal: 6,
          lastSuccessfulSync: "2026-05-19T10:00:00Z",
          lastAttemptedSync: "2026-05-20T09:30:00Z",
        },
        linkedin_messages: {
          state: "ok",
          message: "Previously queued",
          lastAt: "2026-05-20T10:00:00Z",
          lastSuccessfulSync: "2026-05-20T10:00:00Z",
          lastAttemptedSync: "2026-05-20T09:00:00Z",
        },
      },
      launch: { stage: "ready" },
      runtimeMode: "session",
      nativeApp: { configured: true, status: "online", appBundlePath: "/Applications/reply.app", missingPaths: [] },
      trinityProviderStatus: "ready",
      mailProvider: "gmail",
      linkedinIngestMode: "browser_bridge",
    });

    assert.equal(relations.trinity_runtime.activeMode, "local_fallback");
    assert.equal(relations.trinity_runtime.recoveryState, "degraded_fallback_active");
    assert.equal(relations.trinity_runtime.failureClass, "timeout");
    assert.equal(relations.whatsapp_source.failureClass, "concurrency_conflict");
    assert.equal(relations.linkedin_ingest.status, "online");
    assert.equal(relations.linkedin_ingest.recoveryState, "steady");
    assert.equal(relations.linkedin_ingest.failureClass, null);
    assert.match(String(relations.linkedin_ingest.detail || ""), /browser bridge ready/i);
  } finally {
    if (previousDataHome == null) delete process.env.REPLY_DATA_HOME;
    else process.env.REPLY_DATA_HOME = previousDataHome;
    fs.rmSync(dataHome, { recursive: true, force: true });
  }
});

test("server health aliases include /api/system/health", () => {
  const src = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert.ok(src.includes('pathname === "/api/system/health"'), "server should expose /api/system/health alias");
});

test("verify script adds bounded step timeouts", () => {
  const src = fs.readFileSync(path.join(__dirname, "../scripts/verify-trinity-train-integration.js"), "utf8");
  assert.ok(src.includes("TRINITY_COMMAND_TIMEOUT_MS"), "verify script should cap CLI step duration");
  assert.ok(src.includes("TRINITY_ASYNC_TIMEOUT_MS"), "verify script should cap async step duration");
  assert.ok(src.includes("runTimedStep"), "verify script should emit per-step timing");
  assert.match(src, /status:\s*"error"/, "verify script should emit structured failure summaries");
  assert.ok(src.includes("steps: stepTimings"), "verify script should include partial step timings on failure");
});

test("foundation verification gate is available locally and in CI", () => {
  const pkg = fs.readFileSync(path.join(__dirname, "../package.json"), "utf8");
  const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/ci.yml"), "utf8");
  const makefile = fs.readFileSync(path.join(__dirname, "../../Makefile"), "utf8");
  const verifyScript = fs.readFileSync(path.join(__dirname, "../scripts/verify-foundation.js"), "utf8");
  assert.ok(pkg.includes('"verify:foundation"'), "package.json should expose a foundation verification script");
  assert.ok(makefile.includes("verify-foundation"), "Makefile should expose a foundation verification target");
  assert.ok(workflow.includes("npm run verify:foundation"), "CI should run the foundation verification gate");
  assert.ok(workflow.includes("swift build"), "CI should keep a native Swift build job");
  assert.ok(verifyScript.includes("FOUNDATION_TEST_FILES"), "foundation verification should lock a targeted regression suite");
  assert.ok(verifyScript.includes("verify:trinity-train"), "foundation verification should support optional Trinity smoke coverage");
});

test("vector store normalizes annotation schema during writes", () => {
  const src = fs.readFileSync(path.join(__dirname, "../vector-store.js"), "utf8");
  assert.ok(src.includes("normalizeStoredDocument"), "vector-store should normalize documents before insert");
  assert.ok(src.includes("ensureAnnotationSchema"), "vector-store should repair legacy schema drift");
  assert.ok(src.includes("isAlreadyExistsError"), "vector-store should handle create/open races");
  assert.ok(src.includes("enqueueVectorWrite"), "vector-store should serialize Lance writes");
  assert.ok(!src.includes("replace: true"), "vector-store should not recreate the text index on every write");
});

test("channel bridge persists quickly and defers slow follow-up work", () => {
  const bridgeSrc = fs.readFileSync(path.join(__dirname, "../channel-bridge.js"), "utf8");
  const storeSrc = fs.readFileSync(path.join(__dirname, "../message-store.js"), "utf8");
  const workerSrc = fs.readFileSync(path.join(__dirname, "../background-worker.js"), "utf8");
  assert.ok(bridgeSrc.includes("{ deferMaintenance: true }"), "bridge ingest should defer heavy message-store maintenance");
  assert.ok(bridgeSrc.includes('scheduleBridgeTask("contact_update"'), "bridge ingest should schedule contact enrichment asynchronously");
  assert.ok(bridgeSrc.includes("queued_persistence"), "bridge ingest should spool message writes when chat.db is busy");
  assert.ok(bridgeSrc.includes("pending_reconciled"), "bridge replay should reconcile already-persisted messages");
  assert.ok(bridgeSrc.includes("setInterval(() =>"), "bridge ingest should retry queued writes in the background");
  assert.ok(storeSrc.includes("options.deferMaintenance"), "message-store should support deferred maintenance mode");
  assert.ok(storeSrc.includes("async function messageExists"), "message-store should expose message existence checks for replay reconciliation");
  assert.ok(storeSrc.includes("enqueueMessageWrite"), "message-store should serialize durable SQLite writes");
  assert.ok(storeSrc.includes("enqueueMaintenance"), "message-store should serialize post-save maintenance");
  assert.ok(workerSrc.includes("drainPendingBridgeWrites"), "background worker should own queued bridge write replay");
  assert.ok(workerSrc.includes("channel_bridge_outbox"), "background worker should serialize bridge replay with a lock");
});
