#!/usr/bin/env node

const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const chatDir = path.join(repoRoot, "chat");
const appDir = path.join(repoRoot, "app", "reply-app");
const argv = new Set(process.argv.slice(2));
const runTrinitySmoke = argv.has("--with-trinity-smoke") || String(process.env.REPLY_VERIFY_FOUNDATION_TRINITY_SMOKE || "").trim() === "1";
const skipSwiftBuild = argv.has("--skip-swift-build") || process.platform !== "darwin";

const FOUNDATION_TEST_FILES = [
  "test/brain-runtime.test.js",
  "test/contact-owner-flags.test.js",
  "test/conversation-foundation-store.test.js",
  "test/relation-hardening.test.js",
  "test/system-health-shape.test.js",
  "test/vector-store-runtime-events.test.js",
];

function main() {
  const steps = [
    {
      name: "lint",
      command: "npm",
      args: ["run", "lint"],
      cwd: chatDir,
    },
    {
      name: "foundation_tests",
      command: process.execPath,
      args: ["--test", "--test-concurrency=1", ...FOUNDATION_TEST_FILES],
      cwd: chatDir,
    },
  ];

  if (runTrinitySmoke) {
    steps.push({
      name: "trinity_train_smoke",
      command: "npm",
      args: ["run", "verify:trinity-train"],
      cwd: chatDir,
    });
  }

  if (!skipSwiftBuild) {
    steps.push({
      name: "native_swift_build",
      command: "swift",
      args: ["build"],
      cwd: appDir,
    });
  }

  const results = [];
  for (const step of steps) {
    results.push(runStep(step));
  }

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    runTrinitySmoke,
    skipSwiftBuild,
    steps: results,
  }, null, 2)}\n`);
}

function runStep({ name, command, args, cwd }) {
  const startedAt = Date.now();
  process.stdout.write(`\n[verify:foundation] ${name}\n`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const durationMs = Date.now() - startedAt;
  if (result.status !== 0) {
    const error = new Error(`${name} failed with exit code ${result.status ?? "unknown"}`);
    error.result = result;
    error.step = {
      name,
      cwd,
      command,
      args,
      duration_ms: durationMs,
      status: "error",
    };
    throw error;
  }

  return {
    name,
    cwd,
    command,
    args,
    duration_ms: durationMs,
    status: "ok",
  };
}

try {
  main();
} catch (error) {
  if (error?.step) {
    process.stderr.write(`${JSON.stringify({
      status: "error",
      failed_step: error.step,
      message: error.message,
    }, null, 2)}\n`);
  } else {
    process.stderr.write(`${error?.message || String(error)}\n`);
  }
  process.exit(1);
}
