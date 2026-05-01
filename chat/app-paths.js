const fs = require("fs");
const os = require("os");
const path = require("path");

function defaultAppSupportHome() {
  return path.join(os.homedir(), "Library", "Application Support", "reply");
}

function defaultLogHome() {
  return path.join(os.homedir(), "Library", "Logs", "reply");
}

function getDataHome() {
  const raw = String(process.env.REPLY_DATA_HOME || "").trim();
  return raw || defaultAppSupportHome();
}

function getLogHome() {
  const raw = String(process.env.REPLY_LOG_HOME || "").trim();
  return raw || defaultLogHome();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

function migrateLegacyDataHomeIfNeeded(targetDir) {
  const legacyDirs = [
    path.join(os.homedir(), "Library", "Application Support", "Reply"),
    path.join(__dirname, "data"),
  ];

  for (const legacyDir of legacyDirs) {
    if (path.resolve(targetDir) === path.resolve(legacyDir)) continue;
    if (!fs.existsSync(legacyDir)) continue;

    for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
      const src = path.join(legacyDir, entry.name);
      const dst = path.join(targetDir, entry.name);
      if (fs.existsSync(dst)) continue;
      try {
        fs.cpSync(src, dst, { recursive: true });
      } catch {
        // Best-effort migration only; do not block runtime startup here.
      }
    }
  }
}

function migrateLegacyLogHomeIfNeeded(targetDir) {
  const legacyDir = path.join(os.homedir(), "Library", "Logs", "Reply");
  if (path.resolve(targetDir) === path.resolve(legacyDir)) return;
  if (!fs.existsSync(legacyDir)) return;

  for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
    const src = path.join(legacyDir, entry.name);
    const dst = path.join(targetDir, entry.name);
    if (fs.existsSync(dst)) continue;
    try {
      fs.cpSync(src, dst, { recursive: true });
    } catch {
      // Best-effort migration only; do not block runtime startup here.
    }
  }
}

function ensureDataHome() {
  const dir = ensureDir(getDataHome());
  migrateLegacyDataHomeIfNeeded(dir);
  return dir;
}

function ensureLogHome() {
  const dir = ensureDir(getLogHome());
  migrateLegacyLogHomeIfNeeded(dir);
  return dir;
}

function dataPath(...parts) {
  return path.join(getDataHome(), ...parts);
}

function logPath(...parts) {
  return path.join(getLogHome(), ...parts);
}

module.exports = {
  defaultAppSupportHome,
  defaultLogHome,
  getDataHome,
  getLogHome,
  ensureDataHome,
  ensureLogHome,
  dataPath,
  logPath,
};
