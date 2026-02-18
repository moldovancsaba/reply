#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const DEFAULT_ENDPOINT = process.env.REPLY_CHANNEL_BRIDGE_ENDPOINT || "http://127.0.0.1:3000/api/channel-bridge/inbound";

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node channel-bridge-sidecar.js --event '<json>' [--endpoint <url>] [--token <token>] [--dry-run] [--batch]",
      "  node channel-bridge-sidecar.js --file <path> [--endpoint <url>] [--token <token>] [--dry-run] [--batch]",
      "  cat events.ndjson | node channel-bridge-sidecar.js [--endpoint <url>] [--token <token>] [--dry-run] [--batch]",
      "",
      "Notes:",
      "  - Input can be one JSON object, a JSON array, or NDJSON (one JSON object per line).",
      "  - Events are posted to /api/channel-bridge/inbound.",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const out = {
    endpoint: DEFAULT_ENDPOINT,
    token: process.env.REPLY_OPERATOR_TOKEN || "",
    file: "",
    event: "",
    dryRun: false,
    batch: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--batch") {
      out.batch = true;
      continue;
    }
    if (arg === "--endpoint" && i + 1 < argv.length) {
      out.endpoint = String(argv[++i] || "").trim();
      continue;
    }
    if (arg === "--token" && i + 1 < argv.length) {
      out.token = String(argv[++i] || "");
      continue;
    }
    if (arg === "--file" && i + 1 < argv.length) {
      out.file = String(argv[++i] || "").trim();
      continue;
    }
    if (arg === "--event" && i + 1 < argv.length) {
      out.event = String(argv[++i] || "").trim();
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return out;
}

function parseEventsFromText(raw, label) {
  const input = String(raw || "").trim();
  if (!input) return [];

  if (input.startsWith("[")) {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array when using array mode.`);
    return parsed;
  }

  if (input.startsWith("{")) {
    try {
      return [JSON.parse(input)];
    } catch {
      // Might be NDJSON with multiple object lines; fall through.
    }
  }

  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  return lines.map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`${label} contains invalid JSON on line ${idx + 1}: ${err.message}`);
    }
  });
}

function readStdinText() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function loadEvents(options) {
  if (options.event) {
    return parseEventsFromText(options.event, "--event");
  }

  if (options.file) {
    const filePath = path.isAbsolute(options.file)
      ? options.file
      : path.join(process.cwd(), options.file);
    const raw = fs.readFileSync(filePath, "utf8");
    return parseEventsFromText(raw, "--file");
  }

  if (!process.stdin.isTTY) {
    const stdinRaw = await readStdinText();
    return parseEventsFromText(stdinRaw, "stdin");
  }

  return [];
}

async function postEvent(endpoint, token, event) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-Reply-Operator-Token"] = token;

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(event),
  });

  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!res.ok) {
    const reason = data?.error || data?.message || raw || `HTTP ${res.status}`;
    throw new Error(`Bridge request failed (${res.status}): ${reason}`);
  }

  return data;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!options.token) {
    throw new Error("Missing operator token. Provide --token or set REPLY_OPERATOR_TOKEN.");
  }

  const events = await loadEvents(options);
  if (!events.length) {
    printUsage();
    throw new Error("No events supplied.");
  }

  let ok = 0;
  if (options.batch) {
    const payload = events.map((event) => {
      const out = event && typeof event === "object" ? { ...event } : {};
      if (options.dryRun && out.dryRun === undefined) out.dryRun = true;
      return out;
    });
    const result = await postEvent(options.endpoint, options.token, payload);
    const total = Number(result?.total ?? payload.length);
    const accepted = Number(result?.accepted ?? 0);
    const skipped = Number(result?.skipped ?? 0);
    const errors = Number(result?.errors ?? 0);
    const status = result?.status || "ok";
    console.log(`[batch] status=${status} total=${total} accepted=${accepted} skipped=${skipped} errors=${errors}`);
    return;
  }

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i] && typeof events[i] === "object" ? { ...events[i] } : {};
    if (options.dryRun && event.dryRun === undefined) event.dryRun = true;
    const result = await postEvent(options.endpoint, options.token, event);
    ok += 1;
    const status = result?.status || "ok";
    const channel = result?.event?.channel || event.channel || "unknown";
    const messageId = result?.event?.messageId || event.messageId || "n/a";
    console.log(`[${ok}/${events.length}] ${status} channel=${channel} messageId=${messageId}`);
  }
}

main().catch((err) => {
  console.error(`channel-bridge-sidecar error: ${err?.message || err}`);
  process.exit(1);
});
