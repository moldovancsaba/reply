import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, statfsSync, statSync, unlinkSync } from "node:fs";
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

// Checks that belong to one migration, keyed by its version. `before` runs ahead of the backup and the transaction (it may refuse),
// `snapshot` runs inside the transaction before the SQL, `after` inside it after the SQL: throwing rolls the migration back.
const MB = 1024 * 1024;
const one = (db, sql) => db.prepare(sql).get();

// The rebuild writes a copy of messages next to the original, and the runner keeps a backup copy of the whole file: refuse early
// (before anything is touched) when there is not room for both.
export function checkFreeSpace(dbFile, { statfs = statfsSync } = {}) {
    if (!dbFile) return;
    const need = 2 * statSync(dbFile).size + 50 * MB;
    const fs = statfs(path.dirname(dbFile));
    const free = fs.bavail * fs.bsize;
    if (free < need) throw new MigrationError("not_enough_disk", `Reply Core needs about ${Math.ceil(need / MB)} MB free to upgrade its database but only ${Math.floor(free / MB)} MB are free. Free some space, or run "reply-core restore" to go back to the previous version.`);
}
export const HOOKS = {
    14: {
        // the rebuild writes a copy of messages next to the original, and the runner keeps a backup copy of the whole file
        before(db, { dbFile }) {
            checkFreeSpace(dbFile);
        },
        snapshot(db) {
            return {
                // ts_ms is summed modulo a prime: a plain SUM overflows int64 at ~5M present-day rows
                messages: one(db, "SELECT COUNT(*) n, COALESCE(SUM(length(text)), 0) t, COALESCE(SUM(ts_ms % 1000000007), 0) s, COALESCE(MAX(rowid), 0) r, COALESCE(SUM(rowid), 0) rs FROM messages"),
                byChannel: db.prepare("SELECT channel, COUNT(*) n FROM messages GROUP BY channel ORDER BY channel").all(),
                handoffs: one(db, "SELECT COUNT(*) n, COALESCE(SUM(text_length), 0) t FROM handoffs"),
                sends: one(db, "SELECT COUNT(*) n, COALESCE(SUM(text_length), 0) t FROM sends"),
            };
        },
        after(db, before) {
            const after = HOOKS[14].snapshot(db);
            if (JSON.stringify(after) !== JSON.stringify(before)) throw new MigrationError("migration_verify_failed", "rows changed while rebuilding the channel tables: " + JSON.stringify({ before, after }));
            db.prepare("INSERT INTO messages_fts(messages_fts, rank) VALUES ('integrity-check', 1)").run(); // throws when the index and the table disagree
            const fk = db.pragma("foreign_key_check");
            if (fk.length) throw new MigrationError("migration_verify_failed", `foreign key problems after rebuilding: ${fk.length}`);
            const q = db.pragma("quick_check", { simple: true });
            if (q !== "ok") throw new MigrationError("migration_verify_failed", `quick_check failed after rebuilding: ${q}`);
        },
    },
};

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
export function migrate(db, { dir = DEFAULT_DIR, dbFile, hooks = HOOKS } = {}) {
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
    if (before > 0) for (const m of pending) hooks[m.version]?.before?.(db, { dbFile }); // may refuse (for example not enough disk) before anything is touched
    if (dbFile && before > 0) backupBeforeMigration(db, dbFile, before);

    const done = [];
    for (const m of pending) {
        db.transaction(() => {
            const snap = before > 0 ? hooks[m.version]?.snapshot?.(db) : undefined;
            db.exec(m.sql);
            if (before > 0) hooks[m.version]?.after?.(db, snap);
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
