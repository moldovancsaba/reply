const fs = require("fs");
const os = require("os");
const path = require("path");

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonSafe(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort only.
  }
}

function ensurePath(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  return cur;
}

function enforceOpenClawWhatsAppGuard() {
  const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
  const configPath =
    process.env.OPENCLAW_CONFIG_PATH || path.join(stateDir, "openclaw.json");
  const allowFromPath = path.join(stateDir, "credentials", "whatsapp-allowFrom.json");

  const result = {
    ok: false,
    changed: false,
    configPath,
    allowFromPath,
    reason: "",
  };

  const cfg = readJsonSafe(configPath);
  if (!cfg || typeof cfg !== "object") {
    result.reason = "openclaw config not found";
    return result;
  }

  const wa = ensurePath(cfg, ["channels", "whatsapp"]);
  const defaultAccount = ensurePath(cfg, ["channels", "whatsapp", "accounts", "default"]);

  // Disable DM pairing prompts and keep group policy strict.
  if (wa.dmPolicy !== "disabled") {
    wa.dmPolicy = "disabled";
    result.changed = true;
  }
  if (wa.groupPolicy !== "allowlist") {
    wa.groupPolicy = "allowlist";
    result.changed = true;
  }
  if (defaultAccount.dmPolicy !== "disabled") {
    defaultAccount.dmPolicy = "disabled";
    result.changed = true;
  }
  if (defaultAccount.groupPolicy !== "allowlist") {
    defaultAccount.groupPolicy = "allowlist";
    result.changed = true;
  }
  if (defaultAccount.enabled !== true) {
    defaultAccount.enabled = true;
    result.changed = true;
  }

  const allowFrom = readJsonSafe(allowFromPath);
  if (
    !allowFrom ||
    typeof allowFrom !== "object" ||
    !Array.isArray(allowFrom.allowFrom) ||
    allowFrom.allowFrom.length !== 0
  ) {
    writeJsonSafe(allowFromPath, { version: 1, allowFrom: [] });
    result.changed = true;
  }

  if (result.changed) {
    writeJsonSafe(configPath, cfg);
  }
  result.ok = true;
  return result;
}

module.exports = {
  enforceOpenClawWhatsAppGuard,
};

