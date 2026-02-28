/**
 * {reply} - WhatsApp Utilities
 * Helpers for OpenClaw integration and WhatsApp guards.
 */

const { execFile } = require("child_process");
const { enforceOpenClawWhatsAppGuard } = require("../openclaw-guard");

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
    return configured || "openclaw";
}

function buildOpenClawWhatsAppHint(rawErrorText, execErrorText, shortErrorText) {
    const s = `${rawErrorText || ""}\n${execErrorText || ""}\n${shortErrorText || ""}`.toLowerCase();
    if (s.includes("enoent")) {
        return "Install OpenClaw CLI or set OPENCLAW_BIN to the openclaw executable path.";
    }
    if (s.includes("no active whatsapp web listener")) {
        return "Start OpenClaw gateway and link WhatsApp first (example: `openclaw channels login --channel whatsapp --account default`).";
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

function sendWhatsAppViaOpenClawCli({ recipient, text, dryRun = false }) {
    const bin = resolveOpenClawBinary();
    const args = [
        "message",
        "send",
        "--channel", "whatsapp",
        "--account", "default",
        "--target", recipient,
        "--message", text,
        "--json"
    ];
    if (dryRun) args.push("--dry-run");

    return new Promise((resolve, reject) => {
        execFile(bin, args, { timeout: 15000 }, (error, stdout, stderr) => {
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
    sendWhatsAppViaOpenClawCli
};
