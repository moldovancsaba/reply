/**
 * {reply} - Service Manager
 *
 * Orchestrates background processes (worker, OpenClaw, Hatori) with restart backoff
 * and `repair_required` when limits are hit. Worker duplicate detection: if the worker
 * exits with code 0 almost immediately (see `isWorkerEarlyExitDuplicateCandidate`), we
 * treat it as a stale PID / duplicate worker case and retry a few times (reply#31 tests).
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const WORKER_EARLY_EXIT_MS = 5000;
const WORKER_DUPLICATE_RETRY_MAX = 2;
const WORKER_DUPLICATE_RETRY_DELAY_MS = 4000;

/** Exported for unit tests — worker exited immediately with success (duplicate / stale lock). */
function isWorkerEarlyExitDuplicateCandidate(name, code, signal, uptimeMs) {
    return (
        name === "worker" &&
        code === 0 &&
        signal !== "SIGTERM" &&
        uptimeMs < WORKER_EARLY_EXIT_MS
    );
}

// Per-service restart policies
const RESTART_POLICIES = {
    worker: {
        maxRetries: 5,
        backoffMs: 30000,
        actionHint: 'Check logs/worker.log for errors. You can also restart from the Advanced menu in the menubar.'
    },
    openclaw: {
        maxRetries: 3,
        backoffMs: 20000,
        actionHint: 'Ensure OpenClaw is installed. Run `openclaw --version` in Terminal to verify.'
    },
    hatori: {
        maxRetries: 3,
        backoffMs: 30000,
        actionHint: 'Ensure the Hatori Python app is in the `../hatori/` folder. Run `pip install -r requirements.txt` in that directory.'
    }
};

class ServiceManager {
    constructor() {
        this.services = new Map();
        this.logsDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
    }

    /**
     * Start a background service
     * @param {string} name - Managed name
     * @param {string} command - Command or script path (defaults to node if it looks like a .js file)
     * @param {string[]} args - Arguments
     * @param {string} [cwd] - Optional working directory
     */
    start(name, command, args = [], cwd = null) {
        if (this.services.has(name)) {
            const existing = this.services.get(name);
            if (existing.process && !existing.process.killed) {
                console.log(`[ServiceManager] Service "${name}" is already running.`);
                return existing;
            }
            // Preserve restart tracking when restarting
        }

        let spawnCmd = command;
        let spawnArgs = [...args];

        if (command.endsWith('.js')) {
            spawnCmd = 'node';
            spawnArgs = [command, ...args];
        }

        console.log(`[ServiceManager] Starting service: ${name} (${spawnCmd} ${spawnArgs.join(' ')})...`);

        const logPath = path.join(this.logsDir, `${name}.log`);
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });

        const child = spawn(spawnCmd, spawnArgs, {
            cwd: cwd || path.dirname(command.endsWith('.js') ? command : __dirname),
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        child.stdout.pipe(logStream);
        child.stderr.pipe(logStream);

        // Retrieve or init service info
        const existing = this.services.get(name) || {};
        const serviceInfo = {
            name,
            command: spawnCmd,
            args: spawnArgs,
            scriptPath: command,
            originalArgs: args,
            spawnCwd: cwd,
            process: child,
            startTime: Date.now(),
            logPath,
            restartAttempts: existing.restartAttempts || 0,
            workerDuplicateRetries: existing.workerDuplicateRetries || 0,
            lastError: existing.lastError || null,
            repairRequired: false,
            customStatus: null
        };

        child.on('exit', (code, signal) => {
            console.log(`[ServiceManager] Service "${name}" exited (code=${code}, signal=${signal}).`);
            serviceInfo.exitCode = code;
            serviceInfo.exitSignal = signal;
            serviceInfo.process = null;

            const uptimeMs = Date.now() - (serviceInfo.startTime || 0);
            const workerDuplicateSuspect = isWorkerEarlyExitDuplicateCandidate(name, code, signal, uptimeMs);

            if (!workerDuplicateSuspect) {
                serviceInfo.workerDuplicateRetries = 0;
            }

            // Non-zero exit or killed without SIGTERM = unexpected crash
            const isCrash = code !== 0 && signal !== "SIGTERM";
            if (isCrash) {
                serviceInfo.lastError = `Exited with code ${code}`;
                this._attemptAutoRestart(name, serviceInfo);
            } else if (workerDuplicateSuspect) {
                const n = (serviceInfo.workerDuplicateRetries || 0) + 1;
                serviceInfo.workerDuplicateRetries = n;
                if (n <= WORKER_DUPLICATE_RETRY_MAX) {
                    serviceInfo.lastError =
                        "Worker exited immediately (code 0). Often duplicate background-worker or stale PID lock; see docs/LOCAL_MACHINE_DEPLOYMENT.md and runbook/unload-legacy-worker-launchagent.sh";
                    console.warn(
                        `[ServiceManager] Worker duplicate/early-exit suspected (attempt ${n}/${WORKER_DUPLICATE_RETRY_MAX}). ` +
                            `Retrying in ${WORKER_DUPLICATE_RETRY_DELAY_MS / 1000}s...`
                    );
                    serviceInfo.customStatus = `restarting (duplicate-exit retry ${n}/${WORKER_DUPLICATE_RETRY_MAX})`;
                    setTimeout(() => {
                        if (!serviceInfo.process) {
                            this.start(name, serviceInfo.scriptPath, serviceInfo.originalArgs, serviceInfo.spawnCwd);
                        }
                    }, WORKER_DUPLICATE_RETRY_DELAY_MS);
                } else {
                    console.error(
                        `[ServiceManager] Worker still exiting early after ${WORKER_DUPLICATE_RETRY_MAX} retries. Marking repair_required.`
                    );
                    serviceInfo.repairRequired = true;
                    serviceInfo.customStatus = "repair_required";
                }
            }
        });

        child.on('error', (err) => {
            console.error(`[ServiceManager] Service "${name}" spawn error:`, err.message);
            serviceInfo.lastError = err.message;
            serviceInfo.process = null;
            this._attemptAutoRestart(name, serviceInfo);
        });

        child.unref();
        this.services.set(name, serviceInfo);
        return serviceInfo;
    }

    /**
     * Attempt auto-restart with backoff, up to maxRetries.
     * After exhausting retries, marks the service as repair_required.
     */
    _attemptAutoRestart(name, serviceInfo) {
        const policy = RESTART_POLICIES[name];
        if (!policy) return; // No policy = no auto-restart

        if (serviceInfo.restartAttempts >= policy.maxRetries) {
            console.error(
                `[ServiceManager] Service "${name}" exceeded max retries (${policy.maxRetries}). ` +
                `Marking as repair_required. Hint: ${policy.actionHint}`
            );
            serviceInfo.repairRequired = true;
            serviceInfo.customStatus = 'repair_required';
            return;
        }

        serviceInfo.restartAttempts += 1;
        const backoff = policy.backoffMs * serviceInfo.restartAttempts;
        console.warn(
            `[ServiceManager] Auto-restarting "${name}" ` +
            `(attempt ${serviceInfo.restartAttempts}/${policy.maxRetries}) in ${backoff / 1000}s...`
        );

        serviceInfo.customStatus = `restarting (attempt ${serviceInfo.restartAttempts}/${policy.maxRetries})`;

        setTimeout(() => {
            // Only restart if still in crashed state
            if (!serviceInfo.process) {
                console.log(`[ServiceManager] Auto-restart triggered for "${name}".`);
                this.start(name, serviceInfo.scriptPath, serviceInfo.originalArgs, serviceInfo.spawnCwd);
            }
        }, backoff);
    }

    /**
     * Stop a background service
     * @param {string} name
     */
    async stop(name) {
        const service = this.services.get(name);
        if (!service || !service.process) return;

        console.log(`[ServiceManager] Stopping service: ${name}...`);
        service.process.kill('SIGTERM');

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (service.process) {
                    service.process.kill('SIGKILL');
                }
                resolve();
            }, 5000);

            const check = setInterval(() => {
                if (!service.process) {
                    clearTimeout(timeout);
                    clearInterval(check);
                    resolve();
                }
            }, 100);
        });
    }

    /**
     * Restart a background service (also resets repair state)
     * @param {string} name
     */
    async restart(name) {
        const service = this.services.get(name);
        if (!service) return;

        if (!service.scriptPath) {
            console.warn(
                `[ServiceManager] restart("${name}"): skipped — no managed process in this hub session (never spawned).`
            );
            return;
        }

        // Reset repair counters so manual restart gives a fresh chance
        service.restartAttempts = 0;
        service.repairRequired = false;
        service.lastError = null;

        const { scriptPath, originalArgs, spawnCwd } = service;
        await this.stop(name);
        this.start(name, scriptPath, originalArgs, spawnCwd);
    }

    /**
     * Set a custom status string for a service
     * @param {string} name
     * @param {string} status
     */
    setStatus(name, status) {
        let service = this.services.get(name);
        if (!service) {
            service = { name, process: null, startTime: Date.now(), logPath: null, restartAttempts: 0, repairRequired: false };
            this.services.set(name, service);
        }
        service.customStatus = status;
    }

    /**
     * Get status of all or a specific service
     * @param {string} [name]
     */
    getStatus(name) {
        if (name) {
            const s = this.services.get(name);
            if (!s) return { status: 'not_found' };
            return this._formatStatus(s);
        }

        const status = {};
        for (const [n, s] of this.services.entries()) {
            status[n] = this._formatStatus(s);
        }
        return status;
    }

    /**
     * Returns a list of services currently in repair_required state with hints.
     */
    getRepairAlerts() {
        const alerts = [];
        for (const [name, service] of this.services.entries()) {
            if (service.repairRequired) {
                const policy = RESTART_POLICIES[name] || {};
                alerts.push({
                    service: name,
                    severity: 'critical',
                    message: service.lastError || 'Service failed to start',
                    hint: policy.actionHint || 'Check logs and restart manually.',
                    logPath: service.logPath,
                    attempts: service.restartAttempts
                });
            }
        }
        return alerts;
    }

    _formatStatus(service) {
        const isAlive = !!(service.process && !service.process.killed);
        let status = isAlive ? 'online' : (service.exitCode != null ? 'crashed' : 'offline');

        if (service.repairRequired) {
            status = 'repair_required';
        } else if (service.customStatus) {
            if (isAlive || ['loading in queue', 'restarting', 'external'].some(s => String(service.customStatus).startsWith(s))) {
                status = service.customStatus;
            }
        }

        return {
            name: service.name,
            status,
            pid: service.process ? service.process.pid : null,
            uptime: isAlive ? Math.floor((Date.now() - service.startTime) / 1000) : 0,
            startedAt: service.startTime ? new Date(service.startTime).toISOString() : null,
            exitCode: service.exitCode,
            restartAttempts: service.restartAttempts || 0,
            repairRequired: !!service.repairRequired,
            lastError: service.lastError || null,
            logPath: service.logPath
        };
    }

    /**
     * Clean up all services on exit (SIGTERM only; does not wait)
     */
    shutdownAll() {
        console.log('[ServiceManager] Shutting down all services...');
        for (const [, service] of this.services.entries()) {
            if (service.process) {
                service.process.kill('SIGTERM');
            }
        }
    }

    /**
     * Stop every managed child and wait for processes to exit (hub graceful shutdown).
     */
    async shutdownAllAsync() {
        const names = [...this.services.keys()];
        await Promise.all(names.map((n) => this.stop(n)));
    }
}

// Singleton used by `server.js` / routes; predicate attached for unit tests (reply#31).
const serviceManagerSingleton = new ServiceManager();
serviceManagerSingleton.isWorkerEarlyExitDuplicateCandidate = isWorkerEarlyExitDuplicateCandidate;
module.exports = serviceManagerSingleton;
