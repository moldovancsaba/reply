/**
 * Hatori lifecycle helpers (reply#66): prefer macOS LaunchAgent (`com.hatori`) over
 * embedding uvicorn in the Reply hub when the job is registered for this user session.
 */

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const HATORI_LABEL = process.env.REPLY_HATORI_LAUNCHD_LABEL || "com.hatori";

function hatoriProjectPathFromChatDir(chatDir) {
  return path.join(chatDir, "..", "..", "hatori");
}

/**
 * @returns {Promise<boolean>} true if kickstart exited 0
 */
function kickstartHatoriJob() {
  if (process.platform !== "darwin") return Promise.resolve(false);
  const uid = process.getuid();
  const target = `gui/${uid}/${HATORI_LABEL}`;
  return new Promise((resolve) => {
    execFile("launchctl", ["kickstart", "-k", target], { timeout: 20000 }, (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * @param {string|number} port
 * @param {{ maxAttempts?: number, delayMs?: number, requestTimeoutMs?: number }} [opts]
 */
async function waitForHatoriHealth(port, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 12;
  const delayMs = opts.delayMs ?? 2000;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 8000;
  const url = `http://127.0.0.1:${port}/v1/health`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
      if (r.ok) return true;
    } catch {
      /* try again */
    }
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

async function probeHatoriHealth(port, requestTimeoutMs) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Hub startup: external flag, health probe, optional launchctl kickstart, else uvicorn spawn.
 * @param {{ serviceManager: object, hatoriPort: string, hatoriProjectPath: string, spawnUvicorn: () => void, debugLog?: (...a: unknown[]) => void }} p
 */
async function resolveHatoriForHubStart(p) {
  const { serviceManager, hatoriPort, hatoriProjectPath, spawnUvicorn, debugLog } = p;
  const log = typeof debugLog === "function" ? debugLog : () => {};

  if (process.env.REPLY_HATORI_EXTERNAL === "1") {
    log(`[ServiceManager] Hatori is managed externally. Skipping sidecar spawn.`);
    serviceManager.setStatus("hatori", "external");
    return;
  }

  const port = String(hatoriPort || process.env.REPLY_HATORI_PORT || "23572");
  const probeMs = Math.max(2000, Math.min(parseInt(process.env.REPLY_HATORI_STARTUP_PROBE_MS || "4000", 10) || 4000, 30000));

  if (await probeHatoriHealth(port, probeMs)) {
    log(`[ServiceManager] Hatori already running on port ${port} (external). Skipping spawn.`);
    serviceManager.setStatus("hatori", "external");
    return;
  }

  if (process.platform === "darwin" && process.env.REPLY_HATORI_SKIP_LAUNCHCTL !== "1") {
    log(`[ServiceManager] Hatori not up — trying launchctl kickstart ${HATORI_LABEL}…`);
    const kicked = await kickstartHatoriJob();
    if (kicked && (await waitForHatoriHealth(port, { requestTimeoutMs: probeMs }))) {
      log(`[ServiceManager] Hatori reachable after launchctl kickstart.`);
      serviceManager.setStatus("hatori", "external");
      return;
    }
    if (!kicked) {
      log(`[ServiceManager] launchctl kickstart unavailable or failed (install ${HATORI_LABEL} LaunchAgent or use ../hatori).`);
    }
  }

  if (process.env.REPLY_HATORI_NO_UVICORN === "1") {
    console.warn(
      `[ServiceManager] Hatori not reachable and REPLY_HATORI_NO_UVICORN=1 — not spawning uvicorn. ` +
        `Start Hatori via its LaunchAgent (make hatori-bootstrap) or cd ../hatori && make run.`
    );
    serviceManager.setStatus("hatori", "offline");
    return;
  }

  if (!fs.existsSync(hatoriProjectPath)) {
    serviceManager.setStatus("hatori", "offline");
    return;
  }

  spawnUvicorn();
}

module.exports = {
  HATORI_LABEL,
  hatoriProjectPathFromChatDir,
  kickstartHatoriJob,
  waitForHatoriHealth,
  probeHatoriHealth,
  resolveHatoriForHubStart,
};
