#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const {
  getSecurityPolicy,
  AUDIT_LOG_PATH,
} = require("./security-policy.js");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const SERVER_FILE = path.join(__dirname, "server.js");

function modeOctal(stats) {
  return stats.mode & 0o777;
}

function pushFinding(list, severity, checkId, title, detail, remediation) {
  list.push({ severity, checkId, title, detail, remediation });
}

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function checkPermissions(findings) {
  const dirStats = safeStat(DATA_DIR);
  if (!dirStats) {
    pushFinding(
      findings,
      "warn",
      "fs.data_dir.missing",
      "Data directory missing",
      `${DATA_DIR} does not exist yet.`,
      "Start the app once or create chat/data with mode 700.",
    );
    return;
  }

  const dirMode = modeOctal(dirStats);
  if ((dirMode & 0o077) !== 0) {
    pushFinding(
      findings,
      "critical",
      "fs.data_dir.permissions",
      "Data directory is too permissive",
      `chat/data mode is ${dirMode.toString(8)}.`,
      "Run `node chat/security-audit.js --fix` to set mode 700.",
    );
  } else {
    pushFinding(findings, "info", "fs.data_dir.permissions.ok", "Data directory permissions look strict", `chat/data mode is ${dirMode.toString(8)}.`);
  }

  const sensitiveFiles = [
    path.join(DATA_DIR, "contacts.json"),
    path.join(DATA_DIR, "settings.json"),
    path.join(DATA_DIR, "chat.db"),
    AUDIT_LOG_PATH,
  ];

  for (const filePath of sensitiveFiles) {
    const stats = safeStat(filePath);
    if (!stats || !stats.isFile()) continue;
    const fileMode = modeOctal(stats);
    if ((fileMode & 0o077) !== 0) {
      pushFinding(
        findings,
        "warn",
        "fs.file.permissions",
        "Sensitive file is readable/writable by group/world",
        `${path.relative(ROOT, filePath)} mode is ${fileMode.toString(8)}.`,
        "Run `node chat/security-audit.js --fix` to set mode 600.",
      );
    }
  }
}

function checkPolicy(findings) {
  const policy = getSecurityPolicy(process.env);

  if (!policy.localWritesOnly) {
    pushFinding(
      findings,
      "critical",
      "policy.local_writes_off",
      "Local-write protection is disabled",
      "REPLY_SECURITY_LOCAL_WRITES_ONLY is false.",
      "Set REPLY_SECURITY_LOCAL_WRITES_ONLY=true.",
    );
  } else {
    pushFinding(findings, "info", "policy.local_writes_on", "Local-write protection is enabled", "Sensitive writes are restricted to loopback requests.");
  }

  if (!policy.requireHumanApproval) {
    pushFinding(
      findings,
      "critical",
      "policy.human_approval_off",
      "Human approval is disabled",
      "REPLY_SECURITY_REQUIRE_HUMAN_APPROVAL is false.",
      "Set REPLY_SECURITY_REQUIRE_HUMAN_APPROVAL=true.",
    );
  } else {
    pushFinding(findings, "info", "policy.human_approval_on", "Human approval is enabled", "Sensitive actions require explicit human confirmation.");
  }

  if (!policy.requireOperatorToken) {
    pushFinding(
      findings,
      "warn",
      "policy.operator_token_off",
      "Operator token is not enforced",
      "REPLY_SECURITY_REQUIRE_OPERATOR_TOKEN is false.",
      "Set REPLY_OPERATOR_TOKEN and REPLY_SECURITY_REQUIRE_OPERATOR_TOKEN=true.",
    );
  } else if (!policy.operatorToken) {
    pushFinding(
      findings,
      "critical",
      "policy.operator_token_missing",
      "Operator token required but missing",
      "REPLY_SECURITY_REQUIRE_OPERATOR_TOKEN=true but REPLY_OPERATOR_TOKEN is empty.",
      "Set a strong REPLY_OPERATOR_TOKEN.",
    );
  } else {
    pushFinding(findings, "info", "policy.operator_token_on", "Operator token enforcement is enabled", "Protected routes require X-Reply-Operator-Token.");
  }
}

function checkCodeSignals(findings) {
  try {
    const source = fs.readFileSync(SERVER_FILE, "utf8");
    if (source.includes("exec(`")) {
      pushFinding(
        findings,
        "warn",
        "code.exec_shell_usage",
        "Shell exec usage detected",
        "Found shell-based `exec(` usage in chat/server.js.",
        "Prefer execFile/spawn with argv-only execution for untrusted inputs.",
      );
    } else {
      pushFinding(findings, "info", "code.exec_shell_usage.none", "No shell-based exec pattern found in server", "chat/server.js does not contain `exec(` usage.");
    }
  } catch (err) {
    pushFinding(
      findings,
      "warn",
      "code.server_read_failed",
      "Unable to inspect server.js",
      err?.message || String(err),
      "Ensure chat/server.js exists and is readable.",
    );
  }
}

function applyFixes() {
  const actions = [];
  try {
    if (fs.existsSync(DATA_DIR)) {
      fs.chmodSync(DATA_DIR, 0o700);
      actions.push(`chmod 700 ${path.relative(ROOT, DATA_DIR)}`);
    }
  } catch (err) {
    actions.push(`failed chmod data dir: ${err?.message || err}`);
  }

  const files = [
    path.join(DATA_DIR, "contacts.json"),
    path.join(DATA_DIR, "settings.json"),
    path.join(DATA_DIR, "chat.db"),
    AUDIT_LOG_PATH,
  ];
  for (const filePath of files) {
    try {
      if (fs.existsSync(filePath)) {
        fs.chmodSync(filePath, 0o600);
        actions.push(`chmod 600 ${path.relative(ROOT, filePath)}`);
      }
    } catch (err) {
      actions.push(`failed chmod ${path.relative(ROOT, filePath)}: ${err?.message || err}`);
    }
  }

  return actions;
}

function summarize(findings) {
  const summary = { critical: 0, warn: 0, info: 0 };
  for (const f of findings) {
    if (f.severity === "critical") summary.critical += 1;
    else if (f.severity === "warn") summary.warn += 1;
    else summary.info += 1;
  }
  return summary;
}

function printReport(findings, summary, fixActions) {
  console.log("Reply Security Audit");
  console.log(`Summary: critical=${summary.critical} warn=${summary.warn} info=${summary.info}`);
  for (const f of findings) {
    const rem = f.remediation ? ` | remediation: ${f.remediation}` : "";
    console.log(`[${f.severity.toUpperCase()}] ${f.checkId} - ${f.title}: ${f.detail}${rem}`);
  }
  if (fixActions && fixActions.length) {
    console.log("Fix actions:");
    for (const action of fixActions) console.log(`- ${action}`);
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const doFix = args.has("--fix");

  const findings = [];
  checkPermissions(findings);
  checkPolicy(findings);
  checkCodeSignals(findings);

  let fixActions = [];
  if (doFix) {
    fixActions = applyFixes();
    findings.push({
      severity: "info",
      checkId: "fix.applied",
      title: "Fix routine executed",
      detail: `Applied ${fixActions.length} fix action(s).`,
      remediation: "",
    });
  }

  const summary = summarize(findings);
  printReport(findings, summary, fixActions);

  if (summary.critical > 0) {
    process.exitCode = 2;
    return;
  }
  process.exitCode = 0;
}

main();
