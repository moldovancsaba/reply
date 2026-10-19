import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Pure helpers of the launcher (scripts/reply-core), kept apart so they can be tested without starting anything.

export const EXIT = { ok: 0, nodeTooOld: 10, buildFailed: 11, healthTimeout: 12, notRunning: 13 };
export const LABEL = "com.moldovancsaba.reply-core";
export const MIN_NODE = [20, 17, 0];
export const DEFAULT_PORT = 45511;
export const PLIST_MARKER = "Created by `reply-core install-agent`";

export function nodeOk(version = process.versions.node, min = MIN_NODE) {
    const parts = String(version).replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10));
    if (parts.length < 2 || parts.some((n) => !Number.isInteger(n))) return false;
    for (let i = 0; i < 3; i++) {
        const have = parts[i] ?? 0;
        if (have !== min[i]) return have > min[i];
    }
    return true;
}

export function launcherPaths({ home = os.homedir(), env = process.env } = {}) {
    const logDir = path.join(home, "Library", "Logs", "reply-core");
    return {
        dataHome: env.REPLY_CORE_HOME ? path.resolve(env.REPLY_CORE_HOME) : path.join(home, "Library", "Application Support", "reply-core"),
        logDir,
        logFile: path.join(logDir, "service.log"),
        startupLog: path.join(logDir, "startup.log"),
        launchdLog: path.join(logDir, "launchd.log"),
        agentsDir: path.join(home, "Library", "LaunchAgents"),
        plist: path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
    };
}

export function parsePidfile(text) {
    try {
        const d = JSON.parse(text);
        if (!Number.isInteger(d.pid) || d.pid < 1) return null;
        return { pid: d.pid, startedAt: typeof d.startedAt === "string" ? d.startedAt : null, port: Number.isInteger(d.port) ? d.port : null };
    } catch {
        return null;
    }
}

export const isAlive = (pid) => {
    try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; }
};

// The pidfile, only if the process it names is still there (a stale file counts as no file).
export function readPidfile(dataHome) {
    try {
        const p = parsePidfile(readFileSync(path.join(dataHome, "reply-core.pid"), "utf8"));
        return p && isAlive(p.pid) ? p : null;
    } catch {
        return null;
    }
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A launchd agent for the exact node binary and service entry. No secrets: only paths, the port and the log file.
export function plistFor({ node, entry, workingDirectory, launchdLog, env = {} }) {
    const envEntries = Object.entries(env).map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${PLIST_MARKER}; remove it with \`reply-core uninstall-agent\`. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(entry)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(workingDirectory)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(launchdLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(launchdLog)}</string>
</dict>
</plist>
`;
}

export const isOurPlist = (text) => text.includes(`<string>${LABEL}</string>`) && text.includes(PLIST_MARKER);

export function firstPath(status) {
    return status && status.overall === "ok" ? "/inbox" : "/sources";
}

const pad = (s, n) => String(s).padEnd(n);
export function statusLines(status, { url, pid }) {
    const lines = [`Reply Core is running at ${url}${pid ? ` (pid ${pid})` : ""}`];
    lines.push(`${pad("Overall", 22)}${status.overall}`);
    lines.push(`${pad("Storage", 22)}${status.storage.state}${status.storage.message ? `: ${status.storage.message}` : ""}`);
    lines.push(`${pad("Helper", 22)}${status.helper.state}`);
    for (const c of status.connectors) {
        const detail = c.state === "blocked" || c.state === "error" ? c.message : `${c.messagesTotal} messages`;
        lines.push(`${pad(c.label, 22)}${pad(c.state, 14)}${detail}`);
    }
    const b = status.backups;
    lines.push(`${pad("Backups", 22)}${b.count} kept${b.lastBackupAt ? `, last ${b.lastBackupAt}` : ""}${b.lastBackupError ? `, last error: ${b.lastBackupError}` : ""}`);
    return lines;
}

export const FDA_STEPS = (node) => [
    "Full Disk Access is needed to read Messages and Mail. Give it to this exact program:",
    "  1. Open System Settings > Privacy & Security > Full Disk Access.",
    "  2. Click +, press Command+Shift+G and paste this path, then choose it:",
    `       ${node}`,
    "  3. Switch it on, then run: reply-core status",
    "The permission belongs to that exact node binary. After a Node upgrade run `reply-core install-agent` again and grant it again.",
    "Alternative without an agent: run `reply-core start` from a Terminal that already has Full Disk Access.",
];
