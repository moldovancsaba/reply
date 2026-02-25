/**
 * {reply} - LinkedIn Sync Manager
 * Orchestrates the LinkedIn sidecar scraper background process.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const statusManager = require('./status-manager.js');

let sidecarProcess = null;

function updateStatus(status) {
    statusManager.update('linkedin', status);
}

/**
 * Starts the LinkedIn sidecar sync process if it's not already running.
 */
async function syncLinkedIn() {
    if (sidecarProcess && !sidecarProcess.killed) {
        console.log("LinkedIn Sidecar is already running.");
        updateStatus({ state: "running", message: "Sidecar active" });
        return;
    }

    console.log("Launching LinkedIn Sidecar scraper...");
    updateStatus({ state: "running", message: "Launching sidecar..." });

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
        updateStatus({ state: "error", message: "Failed to start" });
        sidecarProcess = null;
    });

    sidecarProcess.on('exit', (code) => {
        console.log(`LinkedIn Sidecar exited with code ${code}`);
        if (code !== 0) {
            updateStatus({ state: "error", message: `Exited with code ${code}` });
        } else {
            updateStatus({ state: "idle", message: "Sync complete" });
        }
        sidecarProcess = null;
    });

    updateStatus({ state: "running", message: "Sidecar running in background" });
}

module.exports = { syncLinkedIn };

if (require.main === module) {
    syncLinkedIn().catch(console.error);
}
