#!/usr/bin/env node
import path from "node:path";
import { accountsCli } from "../src/cli/accounts.js";
import { opsCli } from "../src/cli/ops.js";
import { defaultHome } from "../src/config.js";
import { createKeychain } from "../src/imap/keychain.js";

const [cmd, ...rest] = process.argv.slice(2);
const home = process.env.REPLY_CORE_HOME ? path.resolve(process.env.REPLY_CORE_HOME) : defaultHome();
if (cmd === "accounts") {
    process.exit(await accountsCli(rest, { home, keychain: createKeychain() }));
}
if (["backup", "backups", "restore", "rebuild"].includes(cmd)) {
    process.exit(await opsCli([cmd, ...rest], { home }));
}
console.error("usage: reply-core accounts ... | backup | backups list | restore <file> | rebuild   (start the service with `npm start`)");
process.exit(2);
