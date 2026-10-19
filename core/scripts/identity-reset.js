// usage: node scripts/identity-reset.js --to-auto
// Undoes every manual merge: handles return to the address-book person they came from or to fresh auto contacts.
// Messages and the merge log are untouched. Stop the service before running this.
import path from "node:path";
import Database from "better-sqlite3";
import { defaultHome } from "../src/config.js";
import { createIdentity } from "../src/identity/service.js";
import { createRepo } from "../src/storage/repo.js";

if (!process.argv.includes("--to-auto")) {
    console.error("usage: identity-reset.js --to-auto");
    process.exit(2);
}
const home = process.env.REPLY_CORE_HOME ? path.resolve(process.env.REPLY_CORE_HOME) : defaultHome();
const db = new Database(path.join(home, "core.db"), { fileMustExist: true });
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");
const r = createIdentity({ db, repo: createRepo(db) }).resetToAuto();
console.log(`relinked ${r.relinked} handle(s)`);
db.close();
