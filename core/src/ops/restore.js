import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { loadMigrations } from "../storage/migrate.js";
import { openDb } from "../storage/db.js";
import { backupsDir, stamp, verifyDatabaseFile } from "./backup.js";
import { EXIT, OpsError, openReadonlyClean, requireStopped, withOpsLock } from "./guard.js";

const aside = (home, ts) => {
    const base = path.join(home, "core.db");
    const target = `${base}.replaced-${stamp(ts)}`;
    renameSync(base, target);
    for (const ext of ["-wal", "-shm"]) if (existsSync(base + ext)) renameSync(base + ext, target + ext);
    return target;
};

// Replaces core.db with a verified backup. The replaced file is kept; at every step either the old or the new
// database is in place, never a mixture.
export async function restoreBackup({ home, file, dryRun = false, allowExternal = false, now = Date.now(), hooks = {} }) {
    return withOpsLock(home, async () => {
        requireStopped(home);
        const abs = path.resolve(file);
        if (!allowExternal && path.dirname(abs) !== path.resolve(backupsDir(home))) throw new OpsError("outside_backups", `restore only reads from ${backupsDir(home)} (use --allow-external to override)`, EXIT.usage);
        if (!existsSync(abs)) throw new OpsError("not_found", `no such backup: ${abs}`, EXIT.usage);
        const info = verifyDatabaseFile(abs);
        const migrations = loadMigrations();
        const latest = Math.max(...migrations.map((m) => m.version));
        if (info.version > latest) throw new OpsError("newer_schema", `this backup has schema ${info.version} but this Reply Core only knows ${latest}: update Reply Core first`, EXIT.verify);
        const probe = openReadonlyClean(abs);
        try {
            const applied = new Map(probe.db.prepare("SELECT version, checksum FROM schema_migrations").all().map((r) => [r.version, r.checksum]));
            for (const m of migrations) if (applied.has(m.version) && applied.get(m.version) !== m.checksum) throw new OpsError("migration_mismatch", `the backup was made by a different build (migration ${m.version} differs)`, EXIT.verify);
        } finally {
            probe.close();
        }
        const plan = { file: abs, backupSchema: info.version, messages: info.messages, contacts: info.contacts, keeps: `${path.join(home, "core.db")} as core.db.replaced-${stamp(now)}` };
        if (dryRun) return { dryRun: true, ...plan };
        const incoming = path.join(home, "core.db.new");
        try {
            await hooks.step?.("copy");
            copyFileSync(abs, incoming);
            const fd = openSync(incoming, "r+"); fsyncSync(fd); closeSync(fd);
            verifyDatabaseFile(incoming);
            await hooks.step?.("swap");
            const kept = existsSync(path.join(home, "core.db")) ? aside(home, now) : null;
            await hooks.step?.("rename");
            renameSync(incoming, path.join(home, "core.db"));
            await hooks.step?.("migrate");
            openDb(home).db.close(); // applies migrations newer than the backup
            return { dryRun: false, ...plan, replacedKept: kept };
        } catch (err) {
            rmSync(incoming, { force: true });
            throw err;
        }
    });
}
