// usage: node scripts/reset-cursor.js <connector> [--purge]
// Resets a connector's cursor so the next run re-ingests from the start (idempotent). --purge also deletes the
// messages that connector imported (by channel) first. Stop the service before running this.
import path from "node:path";
import Database from "better-sqlite3";
import { defaultHome } from "../src/config.js";

const CHANNEL = { imessage: "imessage", "apple-mail": "email", imap: "email", whatsapp: "whatsapp", stub: "imessage" };
const [connector, ...flags] = process.argv.slice(2);
if (!connector || connector.startsWith("--")) {
    console.error("usage: reset-cursor.js <connector> [--purge]");
    process.exit(2);
}
const home = process.env.REPLY_CORE_HOME ? path.resolve(process.env.REPLY_CORE_HOME) : defaultHome();
const db = new Database(path.join(home, "core.db"), { fileMustExist: true });
db.pragma("busy_timeout = 5000");
const purge = flags.includes("--purge");
db.transaction(() => {
    if (purge) {
        if (!CHANNEL[connector]) throw new Error(`--purge is not supported for ${connector}`);
        // email is shared by apple-mail and imap: purge by account prefix of the message id instead of the whole channel
        const rows = connector === "apple-mail" || connector === "imap"
            ? db.prepare("DELETE FROM messages WHERE channel = 'email'").run()
            : db.prepare("DELETE FROM messages WHERE channel = ?").run(CHANNEL[connector]);
        console.log(`purged ${rows.changes} messages`);
    }
    const r = db.prepare("UPDATE sync_state SET cursor_json = '{}', state = 'idle', last_error_code = NULL, messages_total = CASE WHEN ? THEN 0 ELSE messages_total END WHERE connector = ?").run(purge ? 1 : 0, connector);
    console.log(`reset ${r.changes} cursor(s) for ${connector}`);
})();
db.close();
