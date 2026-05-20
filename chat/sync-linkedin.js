/**
 * {reply} - LinkedIn Sync Manager
 * Orchestrates LinkedIn ingest modes.
 * Current product default is `browser_bridge`; sidecar scraping is explicit-only.
 */

const { spawn } = require('child_process');
const path = require('path');
const statusManager = require('./status-manager.js');
const { readSettings } = require('./settings-store.js');

let sidecarProcess = null;

function updateStatus(status) {
    statusManager.update('linkedin', status);
}

function resolveLinkedInIngestMode() {
    const explicit = String(
        process.env.REPLY_LINKEDIN_INGEST_MODE ||
        readSettings()?.linkedin?.ingestMode ||
        ""
    ).trim().toLowerCase();
    if (explicit === "sidecar" || explicit === "disabled") return explicit;
    return "browser_bridge";
}

/**
 * Starts LinkedIn ingest work when the configured mode supports it.
 * In normal product mode this updates status for browser-bridge operation and
 * only launches the Playwright sidecar when ingest mode is explicitly `sidecar`.
 */
async function syncLinkedIn() {
    const ingestMode = resolveLinkedInIngestMode();
    if (ingestMode === "disabled") {
        updateStatus({ state: "idle", message: "LinkedIn ingest disabled.", ingestMode });
        return;
    }

    if (ingestMode !== "sidecar") {
        updateStatus({
            state: "idle",
            message: "LinkedIn browser bridge is the supported ingest mode; sidecar is disabled.",
            ingestMode,
        });
        return;
    }

    if (sidecarProcess && !sidecarProcess.killed) {
        console.log("LinkedIn Sidecar is already running.");
        updateStatus({ state: "running", message: "Sidecar active", ingestMode });
        return;
    }

    console.log("Launching LinkedIn Sidecar scraper...");
    updateStatus({ state: "running", message: "Launching sidecar...", ingestMode });

    const scraperPath = path.join(__dirname, 'linkedin-sidecar.js');

    // Spawn as a detached background process
    sidecarProcess = spawn('node', [scraperPath], {
        detached: true,
        stdio: 'inherit', // Keeping 'inherit' for now to see logs in server console, can change to 'ignore' for pure background
        cwd: __dirname
    });

    sidecarProcess.unref(); // Allow the parent (server) to exit regardless of child

    sidecarProcess.on('error', (err) => {
        console.error("LinkedIn Sidecar failed to start:", err);
        updateStatus({ state: "error", message: "Failed to start", ingestMode });
        sidecarProcess = null;
    });

    sidecarProcess.on('exit', (code) => {
        console.log(`LinkedIn Sidecar exited with code ${code}`);
        if (code !== 0) {
            updateStatus({ state: "error", message: `Exited with code ${code}`, ingestMode });
        } else {
            updateStatus({ state: "idle", message: "Sync complete", ingestMode });
        }
        sidecarProcess = null;
    });

    updateStatus({ state: "running", message: "Sidecar running in background", ingestMode });
}

module.exports = { syncLinkedIn, resolveLinkedInIngestMode };

if (require.main === module) {
    syncLinkedIn().catch(console.error);
}
