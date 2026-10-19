import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "./migrate.js";

export class StorageError extends Error {
    constructor(code, message, cause) {
        super(message, { cause });
        this.code = code;
    }
}

// Opens (creating if needed) core.db in `home`, applies pragmas and migrations, runs quick_check.
// Throws StorageError with code storage_unavailable | storage_corrupt | storage_migration_failed.
export function openDb(home, { migrationsDir } = {}) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const file = path.join(home, "core.db");
    let db;
    try {
        db = new Database(file);
    } catch (err) {
        throw new StorageError("storage_unavailable", `cannot open ${file}: ${err.message}`, err);
    }
    try {
        chmodSync(file, 0o600);
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        db.pragma("busy_timeout = 5000");
        db.pragma("synchronous = NORMAL");
        const check = db.pragma("quick_check", { simple: true });
        if (check !== "ok") throw new StorageError("storage_corrupt", `quick_check failed: ${check}`);
    } catch (err) {
        db.close();
        if (err instanceof StorageError) throw err;
        const corrupt = err.code === "SQLITE_NOTADB" || err.code === "SQLITE_CORRUPT";
        throw new StorageError(corrupt ? "storage_corrupt" : "storage_unavailable", err.message, err);
    }
    try {
        migrate(db, { dir: migrationsDir, dbFile: file });
    } catch (err) {
        db.close();
        throw new StorageError("storage_migration_failed", err.message, err);
    }
    return { db, file };
}
