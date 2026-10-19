import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

const DEFAULT_DIR = new URL("./migrations/", import.meta.url).pathname;
const KEEP_BACKUPS = 3;

export class MigrationError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function loadMigrations(dir = DEFAULT_DIR) {
    return readdirSync(dir)
        .filter((f) => /^\d{4}_.+\.sql$/.test(f))
        .sort()
        .map((f) => {
            const sql = readFileSync(path.join(dir, f), "utf8");
            return { version: Number(f.slice(0, 4)), name: f.slice(5, -4), sql, checksum: sha256(sql) };
        });
}

function hasTable(db, name) {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function currentVersion(db) {
    if (!hasTable(db, "schema_migrations")) return 0;
    return db.prepare("SELECT COALESCE(MAX(version),0) v FROM schema_migrations").get().v;
}

// Forward-only runner. Applied migrations are verified by checksum; a changed one aborts the start.
// `dbFile` (optional) enables the pre-migration copy `<db>.bak-<version>` (last 3 kept).
export function migrate(db, { dir = DEFAULT_DIR, dbFile } = {}) {
    db.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_ms INTEGER NOT NULL)",
    );
    const migrations = loadMigrations(dir);
    const applied = new Map(db.prepare("SELECT version, checksum FROM schema_migrations").all().map((r) => [r.version, r.checksum]));
    for (const m of migrations) {
        if (applied.has(m.version) && applied.get(m.version) !== m.checksum) {
            throw new MigrationError("migration_checksum_mismatch", `applied migration ${m.version} (${m.name}) was modified`);
        }
    }
    const pending = migrations.filter((m) => !applied.has(m.version));
    if (!pending.length) return { applied: [], version: currentVersion(db) };

    const before = currentVersion(db);
    if (dbFile && before > 0) backupBeforeMigration(db, dbFile, before);

    const done = [];
    for (const m of pending) {
        db.transaction(() => {
            db.exec(m.sql);
            db.prepare("INSERT INTO schema_migrations(version, name, checksum, applied_ms) VALUES (?,?,?,?)").run(m.version, m.name, m.checksum, Date.now());
        })();
        done.push(m.version);
    }
    return { applied: done, version: currentVersion(db) };
}

function backupBeforeMigration(db, dbFile, version) {
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(dbFile, `${dbFile}.bak-${version}`);
    const dir = path.dirname(dbFile);
    const prefix = `${path.basename(dbFile)}.bak-`;
    const backups = readdirSync(dir)
        .filter((f) => f.startsWith(prefix))
        .map((f) => ({ f, t: statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
    for (const old of backups.slice(KEEP_BACKUPS)) unlinkSync(path.join(dir, old.f));
}

export const backupExists = (dbFile, version) => existsSync(`${dbFile}.bak-${version}`);
