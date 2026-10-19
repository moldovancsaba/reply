// Fills a fresh Reply Core data folder with two people who are really one: node e2e/seed.mjs <home>
import { openDb } from "../../src/storage/db.js";
import { createRepo } from "../../src/storage/repo.js";

const NOW = Date.now();
const { db } = openDb(process.argv[2]);
const repo = createRepo(db);
const m = (n, handle, channel, extra = {}) => ({ channel, account: "", providerMessageKey: `${channel}${n}`, threadKey: handle, handle_norm: handle, isFromMe: n % 2 === 0, tsMs: NOW - n * 3_600_000, text: `Hello ${n} from ${handle}`, attachments: [], ...extra });
repo.upsertMessages([
  ...[1, 2, 3].map((n) => m(n, "+36301234567", "imessage")),
  ...[4, 5].map((n) => m(n, "anna@example.com", "email", { subject: `Subject ${n}` })),
]);
db.close();
