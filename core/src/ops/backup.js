import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { OpsError, EXIT, openReadonlyClean } from "./guard.js";
import { exportUserState } from "./userstate.js";

export const KEEP = { daily: 7, weekly: 4 };
export const backupsDir = (home) => path.join(home, "backups");

export const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
export function parseStamp(s) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

const NAME = /^core-(\d{8}T\d{6}Z)(?:-([a-z0-9-]+))?\.db$/;
export const backupName = (ms, label) => `core-${stamp(ms)}${label ? `-${label}` : ""}.db`;

export function listBackups(home) {
    const dir = backupsDir(home);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).map((f) => {
        const m = NAME.exec(f);
        if (!m) return null;
        const p = path.join(dir, f);
        return { file: f, path: p, ts: parseStamp(m[1]), label: m[2] ?? null, bytes: statSync(p).size };
    }).filter(Boolean).sort((a, b) => b.ts - a.ts);
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
function isoWeek(ms) {
    const d = new Date(ms);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const y = t.getUTCFullYear();
    return `${y}-W${Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7)}`;
}

// Keeps the newest backup of each of the 7 most recent days, then the newest of each of the 4 most recent weeks among
// the older ones. Labelled backups (pre-rebuild, ...) are never pruned. `list` is newest first. Returns the files to delete.
export function selectPrunable(list, keep = KEEP) {
    const plain = list.filter((b) => !b.label);
    const keepSet = new Set();
    const days = [];
    for (const b of plain) {
        const d = day(b.ts);
        if (!days.includes(d)) { if (days.length >= keep.daily) break; days.push(d); keepSet.add(b.path); }
    }
    const oldestDay = days.at(-1);
    const weeks = [];
    for (const b of plain) {
        if (day(b.ts) >= oldestDay) continue;
        const w = isoWeek(b.ts);
        if (!weeks.includes(w)) { if (weeks.length >= keep.weekly) break; weeks.push(w); keepSet.add(b.path); }
    }
    return plain.filter((b) => !keepSet.has(b.path));
}

export function backupInfo(home) {
    const list = listBackups(home);
    let state = {};
    try { state = JSON.parse(readFileSync(path.join(home, "backup-state.json"), "utf8")); } catch { /* none yet */ }
    return { count: list.length, totalBytes: list.reduce((n, b) => n + b.bytes, 0), ...(list[0] ? { lastBackupAt: new Date(list[0].ts).toISOString() } : {}), ...(state.lastBackupError ? { lastBackupError: state.lastBackupError } : {}) };
}

const writeState = (home, patch) => {
    let cur = {};
    try { cur = JSON.parse(readFileSync(path.join(home, "backup-state.json"), "utf8")); } catch { /* fresh */ }
    writeFileSync(path.join(home, "backup-state.json"), JSON.stringify({ ...cur, ...patch }), { mode: 0o600 });
};

export function verifyDatabaseFile(file) {
    let handle;
    try {
        handle = openReadonlyClean(file);
        const db = handle.db;
        const check = db.pragma("quick_check", { simple: true });
        if (check !== "ok") throw new Error(`quick_check: ${check}`);
        const has = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'schema_migrations'").get();
        const version = has ? db.prepare("SELECT COALESCE(MAX(version),0) v FROM schema_migrations").get().v : 0;
        const counts = has ? { messages: db.prepare("SELECT COUNT(*) n FROM messages").get().n, contacts: db.prepare("SELECT COUNT(*) n FROM contacts").get().n } : { messages: 0, contacts: 0 };
        return { version, ...counts };
    } catch (err) {
        throw new OpsError("verification_failed", `${path.basename(file)} is not a usable Reply Core database (${err.message})`, EXIT.verify);
    } finally {
        handle?.close();
    }
}

// Consistent snapshot through SQLite's online backup API (safe while the service writes). Also writes the user-state
// JSON next to it, verifies the copy, and prunes. A labelled backup is never pruned.
export async function runBackup({ home, db, label = null, now = Date.now(), hooks = {} }) {
    const dir = backupsDir(home);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const dest = path.join(dir, backupName(now, label));
    const tmp = `${dest}.part`;
    let source = db;
    let own = null;
    try {
        if (!source) { own = openReadonlyClean(path.join(home, "core.db")); source = own.db; }
        await hooks.step?.("copy");
        await source.backup(tmp);
        // a backup is one self-contained file: no write-ahead log to lose or leave behind
        const copy = new Database(tmp);
        copy.pragma("journal_mode = DELETE");
        copy.close();
        chmodSync(tmp, 0o600);
        const info = verifyDatabaseFile(tmp);
        await hooks.step?.("verified");
        renameSync(tmp, dest);
        const statePath = path.join(dir, `user-state-${stamp(now)}${label ? `-${label}` : ""}.json`);
        writeFileSync(statePath, `${JSON.stringify(exportUserState(source, now), null, 2)}\n`, { mode: 0o600 });
        if (!label) for (const old of selectPrunable(listBackups(home))) { rmSync(old.path, { force: true }); rmSync(old.path.replace(/core-/, "user-state-").replace(/\.db$/, ".json"), { force: true }); }
        writeState(home, { lastBackupAt: new Date(now).toISOString(), lastBackupError: null });
        return { path: dest, bytes: statSync(dest).size, ...info, userState: statePath };
    } catch (err) {
        for (const ext of ["", "-wal", "-shm", "-journal"]) rmSync(tmp + ext, { force: true });
        const e = err instanceof OpsError ? err : new OpsError("io_error", `backup failed: ${err.message}`, EXIT.io);
        try { writeState(home, { lastBackupError: e.message }); } catch { /* cannot even write state */ }
        throw e;
    } finally {
        own?.close();
    }
}
