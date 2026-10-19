import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import path from "node:path";

export class OpsError extends Error {
    constructor(code, message, exit = 1) {
        super(message);
        this.code = code;
        this.exit = exit;
    }
}

// CLI exit codes: 0 ok, 2 usage, 3 service running or busy, 4 verification failed, 5 I/O error.
export const EXIT = { ok: 0, usage: 2, locked: 3, verify: 4, io: 5 };

export const pidfilePath = (home) => path.join(home, "reply-core.pid");

export function writePidfile(home, port, now = Date.now()) {
    writeFileSync(pidfilePath(home), JSON.stringify({ pid: process.pid, startedAt: new Date(now).toISOString(), port }), { mode: 0o600 });
}
export const removePidfile = (home) => rmSync(pidfilePath(home), { force: true });

const alive = (pid) => {
    try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; }
};

// The service holds a pidfile while it runs. A stale file (the process is gone) does not count.
export function serviceRunning(home) {
    try {
        const { pid } = JSON.parse(readFileSync(pidfilePath(home), "utf8"));
        return Number.isInteger(pid) && alive(pid) ? { running: true, pid } : { running: false };
    } catch {
        return { running: false };
    }
}

export function requireStopped(home) {
    const s = serviceRunning(home);
    if (s.running) throw new OpsError("service_running", `Reply Core is running (pid ${s.pid}). Stop it first: kill ${s.pid}`, EXIT.locked);
}

// One restore or rebuild at a time. `ops.lock` holds the pid of the owner; a lock whose owner is gone is replaced.
export async function withOpsLock(home, fn) {
    const lock = path.join(home, "ops.lock");
    for (let attempt = 0; ; attempt++) {
        try {
            closeSync(openSync(lock, "wx", 0o600));
            writeFileSync(lock, String(process.pid));
            break;
        } catch (err) {
            if (err.code !== "EEXIST") throw new OpsError("io_error", `cannot create ${lock}: ${err.code}`, EXIT.io);
            let owner = 0;
            try { owner = Number(readFileSync(lock, "utf8")); } catch { /* being replaced */ }
            if (attempt === 0 && (!owner || !alive(owner))) { rmSync(lock, { force: true }); continue; }
            throw new OpsError("busy", `another restore or rebuild is running (pid ${owner || "unknown"})`, EXIT.locked);
        }
    }
    try {
        return await fn();
    } finally {
        rmSync(lock, { force: true });
    }
}

// Opens a database read-only and, on close, removes the -wal/-shm files SQLite created only for this read.
export function openReadonlyClean(file) {
    const existed = ["-wal", "-shm"].map((ext) => existsSync(file + ext));
    const db = new Database(file, { readonly: true, fileMustExist: true });
    const close = () => {
        try { db.close(); } finally {
            ["-wal", "-shm"].forEach((ext, i) => { if (!existed[i]) rmSync(file + ext, { force: true }); });
        }
    };
    return { db, close };
}
