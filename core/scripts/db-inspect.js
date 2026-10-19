// Prints schema version, row counts and quick_check for core.db. Read-only.
import path from "node:path";
import Database from "better-sqlite3";
import { defaultHome } from "../src/config.js";

const home = process.env.REPLY_CORE_HOME ? path.resolve(process.env.REPLY_CORE_HOME) : defaultHome();
const file = path.join(home, "core.db");
let db;
try {
    db = new Database(file, { readonly: true, fileMustExist: true });
} catch (err) {
    console.error(`db-inspect: cannot open ${file}: ${err.message}`);
    process.exit(1);
}
const one = (sql) => db.prepare(sql).get();
const out = {
    file,
    schemaVersion: one("SELECT COALESCE(MAX(version),0) v FROM schema_migrations").v,
    quickCheck: db.pragma("quick_check", { simple: true }),
    counts: Object.fromEntries(["messages", "handles", "contacts", "contact_handles", "merge_log", "contact_summary", "sync_state"].map((t) => [t, one(`SELECT COUNT(*) n FROM ${t}`).n])),
    byChannel: db.prepare("SELECT channel, COUNT(*) n FROM messages GROUP BY channel").all(),
};
console.log(JSON.stringify(out, null, 2));
process.exit(out.quickCheck === "ok" ? 0 : 1);
