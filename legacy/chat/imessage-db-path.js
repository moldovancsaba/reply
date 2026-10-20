/**
 * Single source of truth for which SQLite file backs iMessage batch sync + live polling.
 */
const path = require("path");
const os = require("os");
const { dataPath } = require("./app-paths.js");

/**
 * @returns {string} Absolute path to the iMessage database.
 * - Honors REPLY_IMESSAGE_DB_PATH when set (non-empty).
 * - On macOS: defaults to ~/Library/Messages/chat.db.
 * - Elsewhere: defaults to the app-owned data home stub path.
 */
function resolveIMessageDbPath() {
    const override = process.env.REPLY_IMESSAGE_DB_PATH;
    if (override != null && String(override).trim() !== "") {
        return path.resolve(String(override).trim());
    }
    if (process.platform === "darwin") {
        return path.join(os.homedir(), "Library", "Messages", "chat.db");
    }
    return dataPath("stubs", "chat.db");
}

module.exports = { resolveIMessageDbPath };
