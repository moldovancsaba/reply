/**
 * Single source of truth for which SQLite file backs iMessage batch sync + live polling.
 */
const path = require("path");
const os = require("os");

/**
 * @returns {string} Absolute path to the iMessage database.
 * - Honors REPLY_IMESSAGE_DB_PATH when set (non-empty).
 * - On macOS: defaults to ~/Library/Messages/chat.db.
 * - Elsewhere: defaults to chat/data/chat.db (stub / CI).
 */
function resolveIMessageDbPath() {
    const override = process.env.REPLY_IMESSAGE_DB_PATH;
    if (override != null && String(override).trim() !== "") {
        return path.resolve(String(override).trim());
    }
    if (process.platform === "darwin") {
        return path.join(os.homedir(), "Library", "Messages", "chat.db");
    }
    return path.join(__dirname, "data", "chat.db");
}

module.exports = { resolveIMessageDbPath };
