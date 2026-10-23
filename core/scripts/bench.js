// Scale check: node scripts/bench.js [messages] [people]   (default 500000 messages, 5000 people; temp data folder, nothing real is touched)
// Upgrade check: node scripts/bench.js --migrate-check [messages]   builds a version-13 database and times migration 0014 (channel shape)
// Fills a fresh database through the real storage layer and times what the UI asks for: list, thread, profile, search, contact search.
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProfile } from "../src/profile/service.js";
import { createReadService } from "../src/read/service.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";

if (process.argv[2] === "--migrate-check") {
    const n = Number(process.argv[3] ?? 500_000);
    const src = new URL("../src/storage/migrations/", import.meta.url).pathname;
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), "rc-mig-")), "migrations");
    mkdirSync(dir);
    for (const f of readdirSync(src).filter((x) => /^\d{4}_/.test(x) && Number(x.slice(0, 4)) <= 13)) copyFileSync(path.join(src, f), path.join(dir, f));
    const h = mkdtempSync(path.join(os.tmpdir(), "rc-mig-home-"));
    const { db: old, file } = openDb(h, { migrationsDir: dir });
    old.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${n})
      INSERT INTO messages (id, channel, account, provider_message_key, thread_key, handle_norm, is_from_me, ts_ms, subject, text, attachments_json, ingested_at)
      SELECT 'm' || i, CASE i % 3 WHEN 0 THEN 'email' WHEN 1 THEN 'imessage' ELSE 'whatsapp' END, '', 'p' || i, 't', '+3630' || (i % 5000), i % 2, 1000000 + i, NULL, 'word' || (i % 97) || ' hello world', '[]', 1 FROM n`);
    const before = old.prepare("SELECT COUNT(*) n, SUM(rowid) r FROM messages").get();
    old.pragma("wal_checkpoint(TRUNCATE)");
    const mb = Math.round(statSync(file).size / 1048576);
    old.close();
    const t0 = performance.now();
    const { db } = openDb(h);
    const s = (performance.now() - t0) / 1000;
    const after = db.prepare("SELECT COUNT(*) n, SUM(rowid) r FROM messages").get();
    console.log(`${n.toLocaleString("en-US")} messages (${mb} MB): migration 0014 took ${s.toFixed(1)} s; rows ${before.n === after.n && before.r === after.r ? "identical" : "DIFFER"}; version ${db.prepare("SELECT MAX(version) v FROM schema_migrations").get().v}`);
    db.close();
    rmSync(h, { recursive: true, force: true });
    process.exit(before.n === after.n && before.r === after.r ? 0 : 1);
}
const N = Number(process.argv[2] ?? 500_000);
const PEOPLE = Number(process.argv[3] ?? 5000);
const home = mkdtempSync(path.join(os.tmpdir(), "rc-bench-"));
const { db } = openDb(home);
const repo = createRepo(db);
const read = createReadService({ db });
const profile = createProfile({ db });
const words = ["alpha", "invoice", "meeting", "dinner", "photo", "ticket", "report", "lunch", "birthday", "project", "contract", "delivery"];
const people = Array.from({ length: PEOPLE }, (_, i) => `+3630${String(1000000 + i)}`);
const NOW = Date.now();

let t = performance.now();
for (let b = 0; b < N / 5000; b++) {
    const batch = [];
    for (let i = 0; i < 5000; i++) {
        const n = b * 5000 + i;
        batch.push({ channel: n % 3 === 0 ? "email" : n % 3 === 1 ? "imessage" : "whatsapp", account: "", providerMessageKey: `p${n}`, threadKey: "t", handle_norm: people[(n * 7919) % PEOPLE], isFromMe: n % 2 === 0, tsMs: NOW - n * 1000, text: `${words[n % 12]} ${words[(n * 7) % 12]} note ${n} with a few more words to make it realistic`, attachments: [] });
    }
    repo.upsertMessages(batch);
}
const ingestS = (performance.now() - t) / 1000;
const time = (fn, reps = 5) => { fn(); const s = performance.now(); for (let i = 0; i < reps; i++) fn(); return (performance.now() - s) / reps; };
const cid = db.prepare("SELECT contact_id FROM contact_handles WHERE handle_norm = ?").get(people[0]).contact_id;
const rows = [
    ["contact list, first page", time(() => read.listContacts({ limit: 30 }))],
    ["contact list, name search", time(() => read.listContacts({ limit: 30, query: "30100" }))],
    ["thread, newest page", time(() => read.getThread(cid, { limit: 50 }))],
    ["profile", time(() => profile.get(cid))],
    ["search, two words", time(() => read.search({ q: "invoice meeting", limit: 30 }))],
    ["search, rare word", time(() => read.search({ q: "note 123456", limit: 30 }))],
];
console.log(`${N.toLocaleString("en-US")} messages, ${PEOPLE.toLocaleString("en-US")} people; ingest ${ingestS.toFixed(0)} s (${Math.round(N / ingestS).toLocaleString("en-US")}/s); database ${(statSync(path.join(home, "core.db")).size / 1048576).toFixed(0)} MB`);
for (const [name, ms] of rows) console.log(`${name.padEnd(28)}${ms.toFixed(1).padStart(8)} ms`);
db.close();
rmSync(home, { recursive: true, force: true });
