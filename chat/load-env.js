/**
 * Load `chat/.env` then optional `chat/.env.local` (gitignored) for machine-only overrides
 * such as `REPLY_DEBUG=1` without editing the main `.env` file.
 */
const fs = require("fs");
const path = require("path");

const CHAT_DIR = __dirname;

function loadReplyEnv() {
  require("dotenv").config({ path: path.join(CHAT_DIR, ".env"), override: true });
  const localPath = path.join(CHAT_DIR, ".env.local");
  if (fs.existsSync(localPath)) {
    require("dotenv").config({ path: localPath, override: true });
  }
}

module.exports = { loadReplyEnv, CHAT_DIR };
