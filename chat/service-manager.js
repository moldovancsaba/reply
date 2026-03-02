/**
 * {reply} - Service Manager
 * Handles orchestration of background processes (Worker, sidecars, etc.)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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

        const serviceInfo = {
            name,
            command: spawnCmd,
            args: spawnArgs,
            scriptPath: command,
            process: child,
            startTime: Date.now(),
            logPath
        };

        child.on('exit', (code, signal) => {
            console.log(`[ServiceManager] Service "${name}" exited with code ${code}, signal ${signal}`);
            serviceInfo.exitCode = code;
            serviceInfo.exitSignal = signal;
            serviceInfo.process = null;
        });

        child.on('error', (err) => {
            console.error(`[ServiceManager] Service "${name}" error:`, err);
        });

        child.unref();
        this.services.set(name, serviceInfo);
        return serviceInfo;
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
     * Restart a background service
     * @param {string} name 
     */
    async restart(name) {
        const service = this.services.get(name);
        if (!service) return;

        const { scriptPath } = service;
        await this.stop(name);
        this.start(name, scriptPath);
    }

    /**
     * Set a custom status string for a service
     * @param {string} name 
     * @param {string} status 
     */
    setStatus(name, status) {
        const service = this.services.get(name);
        if (service) {
            service.customStatus = status;
        }
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

    _formatStatus(service) {
        const isAlive = !!(service.process && !service.process.killed);
        let status = isAlive ? 'online' : (service.exitCode != null ? 'crashed' : 'offline');

        // Prefer custom status if set and it's not "online" when process is dead
        if (service.customStatus) {
            if (isAlive || service.customStatus === 'loading in queue' || service.customStatus === 'repair required') {
                status = service.customStatus;
            }
        }

        return {
            name: service.name,
            status,
            pid: service.process ? service.process.pid : null,
            uptime: isAlive ? Math.floor((Date.now() - service.startTime) / 1000) : 0,
            exitCode: service.exitCode,
            logPath: service.logPath
        };
    }

    /**
     * Clean up all services on exit
     */
    shutdownAll() {
        console.log('[ServiceManager] Shutting down all services...');
        for (const [name, service] of this.services.entries()) {
            if (service.process) {
                service.process.kill('SIGTERM');
            }
        }
    }
}

module.exports = new ServiceManager();
