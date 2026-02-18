const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const AUDIT_LOG_PATH = path.join(DATA_DIR, "security_audit.jsonl");

function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function getSecurityPolicy(env = process.env) {
  const operatorToken = String(env.REPLY_OPERATOR_TOKEN || "").trim();
  return {
    requireHumanApproval: parseBool(env.REPLY_SECURITY_REQUIRE_HUMAN_APPROVAL, true),
    allowDryRunWithoutApproval: parseBool(env.REPLY_SECURITY_ALLOW_DRYRUN_WITHOUT_APPROVAL, true),
    localWritesOnly: parseBool(env.REPLY_SECURITY_LOCAL_WRITES_ONLY, true),
    requireOperatorToken: parseBool(env.REPLY_SECURITY_REQUIRE_OPERATOR_TOKEN, Boolean(operatorToken)),
    operatorToken,
  };
}

function resolveClientIp(req) {
  const fwd = req?.headers?.["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0].trim();
  }
  const remote = req?.socket?.remoteAddress;
  return typeof remote === "string" ? remote.trim() : "";
}

function isLoopbackIp(ip) {
  const raw = String(ip || "").trim().toLowerCase();
  if (!raw) return false;
  if (raw === "::1") return true;
  if (raw === "127.0.0.1") return true;
  if (raw.startsWith("127.")) return true;
  if (raw.startsWith("::ffff:127.")) return true;
  return false;
}

function isLocalRequest(req) {
  return isLoopbackIp(resolveClientIp(req));
}

function hasValidOperatorToken(req, policy) {
  if (!policy?.requireOperatorToken) return true;
  const expected = String(policy?.operatorToken || "");
  if (!expected) return false;
  const actual = String(req?.headers?.["x-reply-operator-token"] || "");
  if (!actual) return false;
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function isHumanApproved(req, payload) {
  const headerValue = String(req?.headers?.["x-reply-human-approval"] || "").trim().toLowerCase();
  if (headerValue === "confirmed" || headerValue === "true" || headerValue === "1") return true;

  const approval = payload?.approval;
  if (approval && typeof approval === "object") {
    if (approval.confirmed === true) return true;
    const status = String(approval.status || "").trim().toLowerCase();
    if (status === "approved" || status === "confirmed") return true;
  }
  return payload?.humanApproved === true;
}

function appendSecurityAudit(event) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    fs.appendFileSync(AUDIT_LOG_PATH, line, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    console.error("[security] failed to append audit log:", err?.message || err);
  }
}

module.exports = {
  AUDIT_LOG_PATH,
  getSecurityPolicy,
  resolveClientIp,
  isLoopbackIp,
  isLocalRequest,
  hasValidOperatorToken,
  isHumanApproved,
  appendSecurityAudit,
};
