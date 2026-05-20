#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

require("../load-env.js").loadReplyEnv();

const {
  buildDraftOutcomeEvent,
  exportDraftTrace,
  getTrinityRuntimeStatusSync,
  proposeTrainingPolicy,
  recordDraftOutcome,
  resolveTrinityPythonBin,
  resolveTrinityRuntimeRoot,
} = require("../brain-runtime.js");

const TRINITY_COMMAND_TIMEOUT_MS = clampTimeoutMs(
  process.env.REPLY_TRINITY_VERIFY_STEP_TIMEOUT_MS,
  45000,
);
const TRINITY_ASYNC_TIMEOUT_MS = clampTimeoutMs(
  process.env.REPLY_TRINITY_VERIFY_ASYNC_TIMEOUT_MS,
  30000,
);

async function main() {
  const status = getTrinityRuntimeStatusSync();
  const pythonBin = resolveTrinityPythonBin();
  const trinityRoot = resolveTrinityRuntimeRoot();
  const now = new Date();
  const requestedAt = now.toISOString();
  const occurredAt = new Date(now.getTime() + 5000).toISOString();
  const companyId = "00000000-0000-5000-8000-000000000001";
  const contactHandle = "integration-check@example.com";
  const threadRef = `reply:email:${contactHandle}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-trinity-smoke-"));
  const snapshotPath = path.join(tempDir, "thread-snapshot.json");

  const threadSnapshot = {
    company_id: companyId,
    thread_ref: threadRef,
    channel: "email",
    contact_handle: contactHandle,
    latest_inbound_text: "Can we lock tomorrow at 10?",
    requested_at: requestedAt,
    messages: [
      {
        message_id: "integration-message-1",
        role: "CONTACT",
        text: "Can we lock tomorrow at 10?",
        occurred_at: requestedAt,
        channel: "email",
        source: "email",
        handle: contactHandle,
      },
    ],
    context_snippets: [],
    golden_examples: [],
    metadata: {
      source_product: "reply",
      runtime_mode: "trinity",
      thread_message_count: "1",
    },
    contract_version: "trinity.reply.v1alpha1",
  };

  fs.writeFileSync(snapshotPath, `${JSON.stringify(threadSnapshot, null, 2)}\n`, "utf-8");

  const stepTimings = [];
  const suggestResult = await runTimedStep(stepTimings, "trinity_suggest", async () =>
    runTrinityCommand({
      pythonBin,
      trinityRoot,
      args: ["suggest", "--adapter", "reply", "--input-file", snapshotPath],
    }),
  );

  const rankedDraftSet = parseJsonResult(suggestResult.stdout, "suggest");
  const topDraft = Array.isArray(rankedDraftSet?.drafts) ? rankedDraftSet.drafts[0] : null;
  if (!rankedDraftSet?.cycle_id || !rankedDraftSet?.trace_ref || !topDraft?.candidate_id || !topDraft?.draft_text) {
    throw new Error("Trinity suggest returned an incomplete ranked draft set.");
  }

  const outcome = buildDraftOutcomeEvent({
    company_id: topDraft.company_id || companyId,
    cycle_id: rankedDraftSet.cycle_id,
    thread_ref: rankedDraftSet.thread_ref || threadRef,
    channel: rankedDraftSet.channel || "email",
    disposition: "SENT_AS_IS",
    occurred_at: occurredAt,
    candidate_id: topDraft.candidate_id,
    original_draft_text: topDraft.draft_text,
    final_text: topDraft.draft_text,
    edit_distance: 0,
    latency_ms: 5000,
    send_result: "ok",
    notes: "verify_trinity_train_integration",
    contract_version: rankedDraftSet.contract_version || "trinity.reply.v1alpha1",
  });

  const outcomeResult = await runTimedStep(stepTimings, "record_outcome", () =>
    withStepTimeout(
      recordDraftOutcome(outcome),
      TRINITY_ASYNC_TIMEOUT_MS,
      "record_outcome",
    ),
  );
  const traceExport = await runTimedStep(stepTimings, "export_trace", () =>
    withStepTimeout(
      exportDraftTrace(rankedDraftSet.cycle_id),
      TRINITY_ASYNC_TIMEOUT_MS,
      "export_trace",
    ),
  );
  const trainProposal = await runTimedStep(stepTimings, "propose_training_policy", () =>
    withStepTimeout(
      proposeTrainingPolicy({
        learnerKind: "tone",
        cycleId: rankedDraftSet.cycle_id,
        transport: "cli",
      }),
      TRINITY_ASYNC_TIMEOUT_MS,
      "propose_training_policy",
    ),
  );

  const summary = {
    status: "ok",
    timeouts: {
      command_ms: TRINITY_COMMAND_TIMEOUT_MS,
      async_ms: TRINITY_ASYNC_TIMEOUT_MS,
    },
    steps: stepTimings,
    runtime_status: {
      adapter: status?.adapter || "reply",
      provider: status?.provider || null,
      provider_status: status?.provider_status || null,
      config_path: status?.config_path || null,
    },
    cycle_id: rankedDraftSet.cycle_id,
    trace_ref: rankedDraftSet.trace_ref,
    accepted_artifact_version: rankedDraftSet.accepted_artifact_version || null,
    top_candidate_id: topDraft.candidate_id,
    record_outcome: outcomeResult,
    export_trace: traceExport,
    train_proposal: {
      adapter: trainProposal?.adapter || null,
      learner_kind: trainProposal?.learner_kind || null,
      transport: trainProposal?.transport || null,
      bundle_files: trainProposal?.bundle_files || [],
      proposal_version: trainProposal?.train_result?.proposal?.version || null,
      incumbent_version: trainProposal?.train_result?.eval_report?.incumbent_version || null,
      replay_ready: trainProposal?.train_result?.eval_report?.replay_ready === true,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

function runTrinityCommand({ pythonBin, trinityRoot, args }) {
  const env = {
    ...process.env,
    PYTHONPATH: process.env.PYTHONPATH
      ? `${path.join(trinityRoot, "core")}${path.delimiter}${process.env.PYTHONPATH}`
      : path.join(trinityRoot, "core"),
  };
  const result = spawnSync(
    pythonBin,
    ["-m", "trinity_core.cli", ...args],
    {
      cwd: trinityRoot,
      env,
      encoding: "utf-8",
      timeout: TRINITY_COMMAND_TIMEOUT_MS,
    },
  );
  if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM") {
    throw new Error(
      `Trinity command timed out after ${TRINITY_COMMAND_TIMEOUT_MS}ms: ${args.join(" ")}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `Trinity command failed: ${args.join(" ")}`).trim());
  }
  return result;
}

function parseJsonResult(stdout, commandName) {
  try {
    return JSON.parse(String(stdout || "{}"));
  } catch (error) {
    throw new Error(`Failed to parse Trinity ${commandName} response: ${error.message}`);
  }
}

async function runTimedStep(stepTimings, name, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    stepTimings.push({
      name,
      status: "ok",
      duration_ms: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    stepTimings.push({
      name,
      status: "error",
      duration_ms: Date.now() - startedAt,
      message: error.message || String(error),
    });
    throw error;
  }
}

async function withStepTimeout(promise, timeoutMs, stepName) {
  return await Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Step '${stepName}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

function clampTimeoutMs(raw, fallback) {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1000, Math.min(parsed, 300000));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
