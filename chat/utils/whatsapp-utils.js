/**
 * {reply} - WhatsApp Utilities
 * Helpers for OpenClaw integration and WhatsApp guards.
 */

const { execFile } = require("child_process");
const { enforceOpenClawWhatsAppGuard } = require("../openclaw-guard");
const { getOpenClawGatewayExecEnv } = require("../openclaw-gateway-env.js");

let openClawGuardLastCheckAtMs = 0;
let openClawGuardLastResult = null;

function applyOpenClawWhatsAppGuard(force = false) {
    const now = Date.now();
    if (!force && now - openClawGuardLastCheckAtMs < 30_000) {
        return openClawGuardLastResult;
    }
    openClawGuardLastCheckAtMs = now;
    try {
        const result = enforceOpenClawWhatsAppGuard();
        openClawGuardLastResult = result;
        if (!result?.ok) {
            console.warn("OpenClaw WhatsApp guard not enforced:", result?.reason || "unknown reason");
        } else if (result.changed) {
            console.log("OpenClaw WhatsApp guard enforced.");
        }
    } catch (error) {
        openClawGuardLastResult = {
            ok: false,
            changed: false,
            reason: String(error?.message || error || "unknown error"),
        };
        console.warn("OpenClaw WhatsApp guard failed:", openClawGuardLastResult.reason);
    }
    return openClawGuardLastResult;
}

function resolveOpenClawBinary() {
    const configured = String(process.env.OPENCLAW_BIN || "").trim();
    if (configured) return configured;

    // Default to 'openclaw' if in PATH
    const fs = require("fs");
    const commonPaths = [
        "/usr/local/bin/openclaw",
        "/opt/homebrew/bin/openclaw",
        "/usr/bin/openclaw"
    ];

    for (const p of commonPaths) {
        if (fs.existsSync(p)) return p;
    }

    return "openclaw";
}

function buildOpenClawWhatsAppHint(rawErrorText, execErrorText, shortErrorText) {
    const s = `${rawErrorText || ""}\n${execErrorText || ""}\n${shortErrorText || ""}`.toLowerCase();
    if (s.includes("enoent")) {
        return "Install OpenClaw CLI or set OPENCLAW_BIN to the openclaw executable path.";
    }
    if (s.includes("no active whatsapp web listener")) {
        const acct = openClawWhatsAppAccount();
        return (
            "1) Start the gateway: openclaw gateway (leave it running)\n" +
            `2) Link WhatsApp: openclaw channels login --channel whatsapp --account ${acct}\n` +
            "3) Retry send from {reply}."
        );
    }
    if (s.includes("gateway is running") || s.includes("start the gateway")) {
        return "Start OpenClaw gateway, then retry (example: `openclaw gateway`).";
    }
    if (
        s.includes("not linked") ||
        s.includes("scan the qr") ||
        s.includes("login --channel whatsapp") ||
        s.includes("no whatsapp web session found")
    ) {
        return "Link WhatsApp in OpenClaw first (example: `openclaw channels login --channel whatsapp`), then retry.";
    }
    return "Ensure OpenClaw CLI is installed, gateway is running, and WhatsApp Web is linked.";
}

function resolveWhatsAppSendTransport(rawTransport) {
    const value =
        rawTransport !== undefined && rawTransport !== null
            ? rawTransport
            : process.env.REPLY_WHATSAPP_SEND_TRANSPORT;
    const normalized = String(value || "desktop").trim().toLowerCase();
    if (normalized === "openclaw" || normalized === "openclaw_cli" || normalized === "web") {
        return "openclaw_cli";
    }
    return "desktop";
}

function openClawWhatsAppAccount() {
    const a = String(process.env.REPLY_WHATSAPP_OPENCLAW_ACCOUNT || "default").trim();
    return a || "default";
}

/**
 * Send via WhatsApp Desktop (macOS UI automation). Uses pbcopy for message body
 * so multi-line / special characters do not break AppleScript string literals.
 * Set WHATSAPP_APP_NAME for WhatsApp Business (default "WhatsApp").
 */
function sendWhatsAppViaDesktopAutomation({ recipient, text }) {
    const { spawnSync } = require("child_process");
    const appName = String(process.env.WHATSAPP_APP_NAME || "WhatsApp").trim() || "WhatsApp";
    const r = spawnSync("pbcopy", { input: String(text || ""), encoding: "utf8" });
    if (r.status !== 0) {
        return Promise.reject(new Error("pbcopy failed (could not place message on clipboard)"));
    }
    const recipientEsc = String(recipient || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const appEsc = appName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const script = `
on run argv
  set recipientId to item 1 of argv
  tell application "${appEsc}"
    activate
  end tell
  delay 0.55
  tell application "System Events"
    keystroke "k" using command down
    delay 0.35
    keystroke recipientId
    delay 0.45
    key code 36
    delay 0.55
    keystroke "v" using command down
    delay 0.25
    key code 36
  end tell
end run
`;
    return new Promise((resolve, reject) => {
        execFile("/usr/bin/osascript", ["-e", script, "--", recipientEsc], { timeout: 45000 }, (error, stdout, stderr) => {
            if (error) {
                const err = new Error(
                    error.message ||
                        String(stderr || "").trim() ||
                        "WhatsApp Desktop automation failed (Accessibility permissions?)"
                );
                err.hint =
                    "Grant Accessibility for Terminal/Cursor and WhatsApp; ensure WhatsApp Desktop is logged in. " +
                    "Optional: WHATSAPP_APP_NAME=\"WhatsApp Business\".";
                return reject(err);
            }
            resolve({ transport: "desktop_automation", stdout: stdout || "" });
        });
    });
}

function sendWhatsAppViaOpenClawCli({ recipient, text, dryRun = false }) {
    const bin = resolveOpenClawBinary();
    const account = openClawWhatsAppAccount();
    const args = [
        "message",
        "send",
        "--channel", "whatsapp",
        "--account", account,
        "--target", recipient,
        "--message", text,
        "--json"
    ];
    if (dryRun) args.push("--dry-run");

    return new Promise((resolve, reject) => {
        execFile(bin, args, { timeout: 15000, env: getOpenClawGatewayExecEnv() }, (error, stdout, stderr) => {
            if (error) {
                const hint = buildOpenClawWhatsAppHint(stdout, stderr, error.message);
                const err = new Error(`OpenClaw send failed: ${error.message}`);
                err.hint = hint;
                err.stdout = stdout;
                err.stderr = stderr;
                return reject(err);
            }
            let parsed = null;
            try {
                // Read from the first { to the end, to ignore plugin/cli warning logs safely
                const jsonMatch = stdout.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[0]);
                } else {
                    parsed = JSON.parse(stdout);
                }
            } catch {
                // Fallback to null; messaging.js will use raw stdout if parsed is null
            }
            resolve({ raw: stdout, parsed });
        });
    });
}

module.exports = {
    applyOpenClawWhatsAppGuard,
    resolveOpenClawBinary,
    buildOpenClawWhatsAppHint,
    resolveWhatsAppSendTransport,
    openClawWhatsAppAccount,
    sendWhatsAppViaOpenClawCli,
    sendWhatsAppViaDesktopAutomation
};
