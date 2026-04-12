/**
 * Before the hub spawns `background-worker.js`, reconcile `data/worker.pid` with reality.
 *
 * Removes invalid or dead PIDs, drops stale locks when the PID is not this checkout’s
 * worker, and SIGTERM/SIGKILLs an orphaned worker when it is ours (see reply#31 /
 * `docs/LOCAL_MACHINE_DEPLOYMENT.md`). Called from `server.js`, `routes/system.js`, etc.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const WAIT_MS = 8000;
const POLL_SEC = 0.25;

/**
 * @param {string} chatDir - Absolute path to the `chat/` directory (same as __dirname from server.js).
 */
function ensureWorkerCanStartFromHub(chatDir) {
    const PID_FILE = path.join(chatDir, "data", "worker.pid");
    const workerScript = path.join(chatDir, "background-worker.js");

    try {
        fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    } catch (_) {
        /* ignore */
    }

    if (!fs.existsSync(PID_FILE)) return;

    let pid;
    try {
        pid = parseInt(String(fs.readFileSync(PID_FILE, "utf8")).trim(), 10);
    } catch {
        try {
            fs.unlinkSync(PID_FILE);
        } catch (_) {
            /* ignore */
        }
        return;
    }

    if (!Number.isFinite(pid) || pid <= 0) {
        try {
            fs.unlinkSync(PID_FILE);
        } catch (_) {
            /* ignore */
        }
        return;
    }

    let alive = true;
    try {
        process.kill(pid, 0);
    } catch {
        alive = false;
    }
    if (!alive) {
        try {
            fs.unlinkSync(PID_FILE);
        } catch (_) {
            /* ignore */
        }
        return;
    }

    let cmd = "";
    try {
        cmd = execFileSync("ps", ["-ww", "-p", String(pid), "-o", "command="], {
            encoding: "utf8",
            timeout: 4000
        }).trim();
    } catch {
        return;
    }

    const looksLikeOurWorker =
        cmd.includes("background-worker.js") && cmd.includes(workerScript);
    if (!looksLikeOurWorker) {
        console.warn("[Hub] Removing stale worker.pid (PID is not this checkout's background-worker).");
        try {
            fs.unlinkSync(PID_FILE);
        } catch (_) {
            /* ignore */
        }
        return;
    }

    console.warn(`[Hub] Stopping orphaned background-worker (pid ${pid}) before hub-managed worker starts.`);
    try {
        process.kill(pid, "SIGTERM");
    } catch (_) {
        /* ignore */
    }

    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
        let still = false;
        try {
            process.kill(pid, 0);
            still = true;
        } catch {
            still = false;
        }
        if (!still) break;
        if (!fs.existsSync(PID_FILE)) break;
        try {
            execFileSync("/bin/sh", ["-c", `sleep ${POLL_SEC}`], { stdio: "ignore", timeout: Math.ceil(POLL_SEC * 1000) + 500 });
        } catch {
            break;
        }
    }

    try {
        if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    } catch (_) {
        /* ignore */
    }

    try {
        process.kill(pid, 0);
        console.warn("[Hub] Prior worker still running after SIGTERM; sending SIGKILL.");
        try {
            process.kill(pid, "SIGKILL");
        } catch (_) {
            /* ignore */
        }
    } catch {
        /* process already gone */
    }
}

module.exports = { ensureWorkerCanStartFromHub };
