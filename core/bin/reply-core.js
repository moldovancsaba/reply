#!/usr/bin/env node
import path from "node:path";
import { accountsCli } from "../src/cli/accounts.js";
import { defaultHome } from "../src/config.js";
import { createKeychain } from "../src/imap/keychain.js";

const [cmd, ...rest] = process.argv.slice(2);
const home = process.env.REPLY_CORE_HOME ? path.resolve(process.env.REPLY_CORE_HOME) : defaultHome();
if (cmd === "accounts") {
    process.exit(await accountsCli(rest, { home, keychain: createKeychain() }));
}
console.error("usage: reply-core accounts add-imap|list|remove ...   (start the service with `npm start`)");
process.exit(2);
