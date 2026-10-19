import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import Database from "better-sqlite3";
import { createIdentity } from "../src/identity/service.js";
import { createBackupSchedule } from "../src/ops/auto.js";
import { backupInfo, backupName, backupsDir, listBackups, parseStamp, runBackup, selectPrunable, stamp } from "../src/ops/backup.js";
import { OpsError, pidfilePath, requireStopped, serviceRunning, withOpsLock, writePidfile } from "../src/ops/guard.js";
import { rebuild } from "../src/ops/rebuild.js";
import { restoreBackup } from "../src/ops/restore.js";
import { exportUserState, importUserState } from "../src/ops/userstate.js";
import { createRegistry } from "../src/connectors/registry.js";
import { createRunner } from "../src/connectors/runner.js";
import { createStatus } from "../src/status/index.js";
import { openDb } from "../src/storage/db.js";
import { createRepo } from "../src/storage/repo.js";
import { buildFixtures } from "./fixtures/build.js";
import { makeRng } from "./fixtures/rng.js";

const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);
const DAY = 86_400_000;
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "rc-ops-"));
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const msg = (n, handle, extra = {}) => ({ channel: "imessage", account: "", providerMessageKey: `m${n}`, threadKey: "t", handle_norm: handle, isFromMe: n % 2 === 0, tsMs: NOW - n * 1000, text: `text ${n}`, attachments: [], ...extra });

function env() {
    const home = tmp();
    const { db } = openDb(home);
    const repo = createRepo(db, { now: () => NOW });
    let t = NOW;
    const identity = createIdentity({ db, repo, now: () => ++t });
    repo.setAfterBatch(() => identity.applyPendingMerges());
    return { home, db, repo, identity };
}
const owner = (db, h) => db.prepare("SELECT contact_id c FROM contact_handles WHERE handle_norm = ?").get(h)?.c;
// the grouping of handles into contacts, independent of contact ids
const partition = (db) => {
    const by = new Map();
    for (const r of db.prepare("SELECT contact_id c, handle_norm h FROM contact_handles").all()) { if (!by.has(r.c)) by.set(r.c, []); by.get(r.c).push(r.h); }
    return JSON.stringify([...by.values()].map((v) => v.sort()).sort());
};
const PEOPLE = ["+12125550101", "+12125550102", "+12125550103", "+12125550104", "+12125550105", "a@example.com", "b@example.com"];
function seed(e) {
    e.repo.upsertMessages(PEOPLE.flatMap((h, i) => [msg(i * 3 + 1, h, { providerMessageKey: `k${i}a` }), msg(i * 3 + 2, h, { providerMessageKey: `k${i}b` })]));
}
const files = (home) => readdirSync(home).sort();

test("stamps round-trip and backup names parse back", () => {
    assert.equal(stamp(NOW), "20261019T080000Z");
    assert.equal(parseStamp("20261019T080000Z"), NOW);
    assert.equal(parseStamp("nonsense"), null);
    assert.equal(backupName(NOW), "core-20261019T080000Z.db");
    assert.equal(backupName(NOW, "pre-rebuild"), "core-20261019T080000Z-pre-rebuild.db");
});

test("retention: exactly the newest backup of 7 days plus the newest of 4 earlier weeks; labelled backups stay", () => {
    const list = Array.from({ length: 100 }, (_, i) => ({ file: `f${i}`, path: `/p/f${i}`, ts: NOW - i * DAY, label: null }));
    list.unshift({ file: "pre", path: "/p/pre", ts: NOW - 50 * DAY, label: "pre-rebuild" });
    list.sort((a, b) => b.ts - a.ts);
    const drop = selectPrunable(list);
    const kept = list.filter((b) => !drop.includes(b));
    const plain = kept.filter((b) => !b.label);
    assert.equal(plain.length, 11, "7 daily + 4 weekly");
    assert.ok(kept.some((b) => b.label), "a labelled backup is never pruned");
    assert.deepEqual(plain.slice(0, 7).map((b) => b.ts), Array.from({ length: 7 }, (_, i) => NOW - i * DAY), "the last seven days");
    const weekly = plain.slice(7);
    assert.ok(weekly.every((b) => new Date(b.ts).getUTCDay() === 0 || b.ts >= NOW - 14 * DAY), "weekly picks are the last backup of an older week (Sundays for daily backups)");
    assert.equal(new Set(weekly.map((b) => Math.floor((b.ts - 4 * DAY) / (7 * DAY)))).size, 4, "four different weeks");
    assert.deepEqual(selectPrunable(list.slice(0, 3)), [], "fewer than a week of backups: nothing is pruned");
    // several backups on one day: only the newest of the day survives
    const many = [0, 1, 2, 3].map((h) => ({ file: `h${h}`, path: `/p/h${h}`, ts: NOW - h * 3_600_000, label: null }));
    assert.deepEqual(selectPrunable(many).map((b) => b.file).sort(), ["h1", "h2", "h3"]);
    // sparse, gappy history keeps the 7 newest days that exist
    const gappy = [0, 3, 9, 20, 40, 41, 80].map((d) => ({ file: `g${d}`, path: `/p/g${d}`, ts: NOW - d * DAY, label: null }));
    assert.deepEqual(selectPrunable(gappy), [], "seven or fewer days with backups are all kept");
    // year boundary: ISO weeks do not collapse or split wrongly
    const ny = Array.from({ length: 60 }, (_, i) => ({ file: `y${i}`, path: `/p/y${i}`, ts: Date.UTC(2027, 0, 20) - i * DAY, label: null }));
    assert.equal(ny.length - selectPrunable(ny).length, 11);
});

test("listBackups ignores other files and orders newest first", () => {
    const home = tmp();
    mkdirSync(backupsDir(home), { recursive: true });
    for (const n of ["core-20261001T000000Z.db", "core-20261003T000000Z-pre-rebuild.db", "core-20261002T000000Z.db", "notes.txt", "core-bad.db", "user-state-20261001T000000Z.json"]) writeFileSync(path.join(backupsDir(home), n), "x");
    assert.deepEqual(listBackups(home).map((b) => [b.file, b.label]), [["core-20261003T000000Z-pre-rebuild.db", "pre-rebuild"], ["core-20261002T000000Z.db", null], ["core-20261001T000000Z.db", null]]);
    assert.deepEqual(listBackups(tmp()), []);
});

test("a backup is a consistent, verified, private snapshot, even while rows are being written", async () => {
    const e = env();
    seed(e);
    const before = e.db.prepare("SELECT COUNT(*) n FROM messages").get().n;
    let writing = true;
    let n = 1000;
    const writer = (async () => { while (writing) { e.repo.upsertMessages([msg(n++, PEOPLE[n % 7], { providerMessageKey: `w${n}` })]); await new Promise((r) => setImmediate(r)); } })();
    const r = await runBackup({ home: e.home, db: e.db, now: NOW });
    writing = false;
    await writer;
    assert.equal(statSync(backupsDir(e.home)).mode & 0o777, 0o700);
    assert.equal(statSync(r.path).mode & 0o777, 0o600);
    assert.equal(statSync(r.userState).mode & 0o777, 0o600);
    const copy = new Database(r.path, { readonly: true });
    assert.equal(copy.pragma("quick_check", { simple: true }), "ok");
    const inCopy = copy.prepare("SELECT COUNT(*) n FROM messages").get().n;
    const summed = copy.prepare("SELECT COALESCE(SUM(count_total),0) n FROM contact_summary").get().n;
    copy.close();
    assert.ok(inCopy >= before);
    assert.equal(summed, inCopy, "the snapshot is internally consistent: summaries match the messages in it");
    assert.deepEqual(readdirSync(backupsDir(e.home)).filter((f) => f.endsWith(".part")), []);
    const info = backupInfo(e.home);
    assert.deepEqual([info.count, info.lastBackupAt, info.lastBackupError], [1, new Date(NOW).toISOString(), undefined]);
    assert.equal(JSON.parse(readFileSync(r.userState, "utf8")).schema, 1);
});

test("a failed backup leaves no partial file and records the error; the next success clears it", async () => {
    const e = env();
    seed(e);
    await assert.rejects(runBackup({ home: e.home, db: e.db, now: NOW, hooks: { step: (s) => { if (s === "verified") throw new Error("disk full"); } } }), (err) => err.code === "io_error" && /disk full/.test(err.message));
    assert.deepEqual(listBackups(e.home), []);
    assert.deepEqual(readdirSync(backupsDir(e.home)), []);
    assert.match(backupInfo(e.home).lastBackupError, /disk full/);
    await runBackup({ home: e.home, db: e.db, now: NOW + 1000 });
    assert.equal(backupInfo(e.home).lastBackupError, undefined);
});

test("labelled backups are exempt from pruning and from the daily slot", async () => {
    const e = env();
    seed(e);
    for (let d = 45; d >= 0; d--) await runBackup({ home: e.home, db: e.db, now: NOW - d * DAY });
    await runBackup({ home: e.home, db: e.db, now: NOW - 60 * DAY, label: "pre-rebuild" });
    const list = listBackups(e.home);
    assert.equal(list.filter((b) => b.label).length, 1);
    assert.equal(list.filter((b) => !b.label).length, 11, "46 daily backups were pruned to 7 + 4");
    assert.equal(readdirSync(backupsDir(e.home)).filter((f) => f.startsWith("user-state-")).length, 12, "user-state files follow their backups");
});

test("user state: merges are exported by handle sets, undone merges are marked, the anchor is recorded", () => {
    const e = env();
    seed(e);
    const m1 = e.identity.merge(owner(e.db, PEOPLE[1]), owner(e.db, PEOPLE[0]));
    const m2 = e.identity.merge(owner(e.db, PEOPLE[2]), owner(e.db, PEOPLE[0]));
    e.identity.unmerge(m2.mergeLogId);
    const state = exportUserState(e.db, NOW);
    assert.deepEqual(state.manualMerges.map((m) => [m.keptHandles, m.movedHandles, Boolean(m.revertedAt)]), [[[PEOPLE[0]], [PEOPLE[1]], false], [[PEOPLE[0]], [PEOPLE[2]], true]]);
    assert.ok(state.manualMerges.every((m) => /^m_/.test(m.id) && !Number.isNaN(Date.parse(m.ts))));
    assert.equal(e.db.prepare("SELECT anchor_handle a FROM merge_log WHERE id = ?").get(m1.mergeLogId).a, PEOPLE[0]);
    assert.ok(!JSON.stringify(state).includes("text "), "no message content in the user state");
});

test("user state replay reproduces the grouping, in order, including chains and handles that arrive later", () => {
    const a = env();
    seed(a);
    const m1 = a.identity.merge(owner(a.db, PEOPLE[1]), owner(a.db, PEOPLE[0]));
    a.identity.merge(owner(a.db, PEOPLE[2]), owner(a.db, PEOPLE[1]));  // chain: 2 into the contact that already holds 1
    a.identity.merge(owner(a.db, "b@example.com"), owner(a.db, "a@example.com"));
    const undone = a.identity.merge(owner(a.db, PEOPLE[4]), owner(a.db, PEOPLE[3]));
    a.identity.unmerge(undone.mergeLogId);
    void m1;
    const want = partition(a.db);
    const state = exportUserState(a.db, NOW);

    // everything is known: replay applies the merges
    const b = env();
    seed(b);
    const r = importUserState(b.db, b.identity, state);
    assert.deepEqual([r.applied >= 3, r.skippedReverted, r.pending], [true, 1, 0]);
    assert.equal(partition(b.db), want);

    // nothing is known yet (a rebuilt, empty database): every merge waits, then applies as the messages are re-imported
    const c = env();
    const r2 = importUserState(c.db, c.identity, state);
    assert.deepEqual([r2.pending, c.identity.pendingCount()], [3, 3]);
    c.repo.upsertMessages(PEOPLE.slice(0, 2).map((h, i) => msg(i + 1, h, { providerMessageKey: `x${i}` })));
    assert.equal(c.identity.pendingCount(), 2, "the merge whose handles are all back is applied; the others need more of theirs");
    c.repo.upsertMessages(PEOPLE.slice(2).map((h, i) => msg(i + 10, h, { providerMessageKey: `y${i}` })));
    assert.equal(c.identity.pendingCount(), 0);
    assert.equal(partition(c.db), want);
    c.repo.upsertMessages([msg(99, "late@example.com", { providerMessageKey: "late" })]);
    assert.equal(partition(c.db).includes("late@example.com"), true, "later batches keep working");
});

test("restore: replaces core.db with a verified backup and keeps the replaced file", async () => {
    const e = env();
    seed(e);
    e.identity.merge(owner(e.db, PEOPLE[1]), owner(e.db, PEOPLE[0]));
    const snap = await runBackup({ home: e.home, db: e.db, now: NOW });
    const goodPartition = partition(e.db);
    e.repo.upsertMessages([msg(500, "new@example.com", { providerMessageKey: "new" })]);
    e.db.close();
    const before = sha(path.join(e.home, "core.db"));
    const r = await restoreBackup({ home: e.home, file: snap.path, now: NOW + 5000 });
    assert.equal(r.dryRun, false);
    const kept = readdirSync(e.home).filter((f) => f.startsWith("core.db.replaced-"));
    assert.equal(kept.length, 1);
    const { db } = openDb(e.home);
    assert.equal(partition(db), goodPartition);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE provider_message_key = 'new'").get().n, 0, "the change after the backup is gone");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages").get().n, 14);
    db.close();
    const old = new Database(path.join(e.home, kept[0]), { readonly: true });
    assert.equal(old.prepare("SELECT COUNT(*) n FROM messages WHERE provider_message_key = 'new'").get().n, 1, "the replaced database is intact");
    old.close();
    assert.ok(before);
    assert.deepEqual(readdirSync(e.home).filter((f) => f.endsWith(".new")), []);
});

test("restore dry run changes nothing; only files in the backups folder unless allowed", async () => {
    const e = env();
    seed(e);
    const snap = await runBackup({ home: e.home, db: e.db, now: NOW });
    e.db.close();
    const hash = sha(path.join(e.home, "core.db"));
    const names = files(e.home);
    const r = await restoreBackup({ home: e.home, file: snap.path, dryRun: true });
    assert.deepEqual([r.dryRun, r.messages, r.contacts], [true, 14, 7]);
    assert.equal(sha(path.join(e.home, "core.db")), hash);
    assert.deepEqual(files(e.home), names);
    const outside = path.join(tmp(), "elsewhere.db");
    copyFileSync(snap.path, outside);
    await assert.rejects(restoreBackup({ home: e.home, file: outside }), (err) => err.code === "outside_backups" && err.exit === 2);
    assert.equal((await restoreBackup({ home: e.home, file: outside, allowExternal: true, dryRun: true })).dryRun, true);
    await assert.rejects(restoreBackup({ home: e.home, file: path.join(backupsDir(e.home), "core-20200101T000000Z.db") }), (err) => err.code === "not_found");
});

test("restore refuses corrupt files, non-databases, newer schemas and other builds; the original stays", async () => {
    const e = env();
    seed(e);
    const snap = await runBackup({ home: e.home, db: e.db, now: NOW });
    e.db.close();
    const hash = sha(path.join(e.home, "core.db"));
    const put = (name, mutate) => { const f = path.join(backupsDir(e.home), name); copyFileSync(snap.path, f); mutate(f); return f; };
    const corrupt = put("core-20261019T080100Z.db", (f) => { const fd = readFileSync(f); fd.fill(0xff, 4096, 8192); writeFileSync(f, fd); });
    const notdb = put("core-20261019T080200Z.db", (f) => writeFileSync(f, "this is not a database"));
    const newer = put("core-20261019T080300Z.db", (f) => { const d = new Database(f); d.prepare("INSERT INTO schema_migrations VALUES (999, 'future', 'x', 1)").run(); d.close(); });
    const other = put("core-20261019T080400Z.db", (f) => { const d = new Database(f); d.prepare("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1").run(); d.close(); });
    for (const [f, code, exit] of [[corrupt, "verification_failed", 4], [notdb, "verification_failed", 4], [newer, "newer_schema", 4], [other, "migration_mismatch", 4]]) {
        await assert.rejects(restoreBackup({ home: e.home, file: f }), (err) => err.code === code && err.exit === exit, f);
        assert.equal(sha(path.join(e.home, "core.db")), hash, "the live database was not touched");
    }
});

test("restoring an older backup applies the newer migrations", async () => {
    const home = tmp();
    const dir = path.join(tmp(), "migrations");
    mkdirSync(dir);
    for (const f of readdirSync(new URL("../src/storage/migrations/", import.meta.url).pathname).filter((x) => /^000[1-3]_/.test(x))) copyFileSync(path.join(new URL("../src/storage/migrations/", import.meta.url).pathname, f), path.join(dir, f));
    const { db } = openDb(home, { migrationsDir: dir, fileName: "old.db" });
    db.close();
    mkdirSync(backupsDir(home), { recursive: true });
    const file = path.join(backupsDir(home), "core-20260101T000000Z.db");
    copyFileSync(path.join(home, "old.db"), file);
    await restoreBackup({ home, file, now: NOW });
    const { db: after } = openDb(home);
    assert.ok(after.prepare("SELECT MAX(version) v FROM schema_migrations").get().v >= 7);
    assert.ok(after.prepare("SELECT 1 FROM sqlite_master WHERE name = 'pending_merges'").get());
    after.close();
});

test("restore is crash-safe: at every step the old or the new database is in place, never a mixture", async () => {
    for (const step of ["copy", "swap", "rename", "migrate"]) {
        const e = env();
        seed(e);
        const snap = await runBackup({ home: e.home, db: e.db, now: NOW });
        e.repo.upsertMessages([msg(700, "later@example.com", { providerMessageKey: "later" })]);
        e.db.pragma("wal_checkpoint(TRUNCATE)");
        e.db.close();
        const original = sha(path.join(e.home, "core.db"));
        await assert.rejects(restoreBackup({ home: e.home, file: snap.path, now: NOW + 1000, hooks: { step: (s) => { if (s === step) throw new Error(`crash at ${s}`); } } }), /crash at/);
        const core = path.join(e.home, "core.db");
        if (existsSync(core)) {
            const check = new Database(core, { readonly: true });
            assert.equal(check.pragma("quick_check", { simple: true }), "ok", step);
            const hasLater = check.prepare("SELECT COUNT(*) n FROM messages WHERE provider_message_key = 'later'").get().n;
            check.close();
            assert.ok(hasLater === 1 || sha(core) === sha(snap.path) || step === "migrate", `${step}: old or new, not a mixture`);
            if (step === "copy" || step === "swap") assert.equal(sha(core), original, `${step}: the original is untouched`);
        } else {
            assert.ok(readdirSync(e.home).some((f) => f.startsWith("core.db.replaced-")), `${step}: nothing is lost, the old file is kept`);
        }
        assert.ok(!existsSync(path.join(e.home, "core.db.new")), `${step}: no leftover`);
    }
});

test("rebuild keeps only the manual merges, saves a pre-rebuild backup and the user state, keeps the old file, and merges re-apply as data returns", async () => {
    const e = env();
    seed(e);
    e.identity.merge(owner(e.db, PEOPLE[1]), owner(e.db, PEOPLE[0]));
    e.identity.merge(owner(e.db, "b@example.com"), owner(e.db, "a@example.com"));
    const undone = e.identity.merge(owner(e.db, PEOPLE[3]), owner(e.db, PEOPLE[2]));
    e.identity.unmerge(undone.mergeLogId);
    const want = partition(e.db);
    e.db.close();
    const r = await rebuild({ home: e.home, now: NOW + 2000 });
    assert.deepEqual([r.dryRun, r.manualMerges, r.revertedMerges, r.pending, r.skippedReverted], [false, 2, 1, 2, 1]);
    assert.ok(existsSync(r.backup) && existsSync(r.userState));
    assert.ok(readdirSync(e.home).some((f) => f.startsWith("core.db.replaced-")), "the old database is kept");
    assert.ok(readdirSync(backupsDir(e.home)).some((f) => f.endsWith("-pre-rebuild.db")));
    assert.ok(!existsSync(path.join(e.home, "core.rebuild.db")));
    const { db, file } = openDb(e.home);
    const repo = createRepo(db, { now: () => NOW });
    const identity = createIdentity({ db, repo });
    repo.setAfterBatch(() => identity.applyPendingMerges());
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages").get().n, 0, "messages are not carried over: the sources provide them");
    assert.equal(identity.pendingCount(), 2);
    // one source is blocked for now: only part of the data comes back
    repo.upsertMessages(PEOPLE.slice(0, 2).map((h, i) => msg(i + 1, h, { providerMessageKey: `r${i}` })));
    assert.equal(identity.pendingCount(), 1, "the merge whose people are back is applied, the other waits");
    repo.upsertMessages([...PEOPLE.slice(2).map((h, i) => msg(i + 10, h, { providerMessageKey: `s${i}` }))]);
    assert.equal(identity.pendingCount(), 0);
    assert.equal(partition(db), want);
    assert.ok(file);
    db.close();
});

test("rebuild dry run changes nothing", async () => {
    const e = env();
    seed(e);
    e.identity.merge(owner(e.db, PEOPLE[1]), owner(e.db, PEOPLE[0]));
    e.db.pragma("wal_checkpoint(TRUNCATE)");
    e.db.close();
    const hash = sha(path.join(e.home, "core.db"));
    const names = files(e.home);
    const r = await rebuild({ home: e.home, dryRun: true });
    assert.deepEqual([r.dryRun, r.manualMerges], [true, 1]);
    assert.equal(sha(path.join(e.home, "core.db")), hash);
    assert.deepEqual(files(e.home), names, "not even a backup or a state file is written");
});

test("rebuild is crash-safe at every step: the original database is always usable, nothing is left behind", async () => {
    for (const step of ["backup", "create", "import", "swap", "rename"]) {
        const e = env();
        seed(e);
        e.identity.merge(owner(e.db, PEOPLE[1]), owner(e.db, PEOPLE[0]));
        e.db.pragma("wal_checkpoint(TRUNCATE)");
        e.db.close();
        const original = sha(path.join(e.home, "core.db"));
        await assert.rejects(rebuild({ home: e.home, now: NOW + 1, hooks: { step: (s) => { if (s === step) throw new Error(`crash at ${s}`); } } }), /crash at/);
        assert.ok(!existsSync(path.join(e.home, "core.rebuild.db")), `${step}: the half-built database is removed`);
        const core = path.join(e.home, "core.db");
        if (step === "rename") {
            assert.ok(!existsSync(core), "between the two renames the old file is already safe under its new name");
            assert.ok(readdirSync(e.home).some((f) => f.startsWith("core.db.replaced-")));
        } else {
            assert.equal(sha(core), original, `${step}: the original is untouched`);
        }
    }
});

test("guards: a running service blocks restore and rebuild; a stale pidfile does not; one operation at a time", async () => {
    const e = env();
    seed(e);
    const snap = await runBackup({ home: e.home, db: e.db, now: NOW });
    e.db.close();
    writePidfile(e.home, 45511);
    assert.deepEqual(serviceRunning(e.home), { running: true, pid: process.pid });
    await assert.rejects(restoreBackup({ home: e.home, file: snap.path }), (err) => err.code === "service_running" && err.exit === 3 && /kill \d+/.test(err.message));
    await assert.rejects(rebuild({ home: e.home }), (err) => err.code === "service_running");
    writeFileSync(pidfilePath(e.home), JSON.stringify({ pid: 999999, startedAt: "x", port: 1 }));
    assert.deepEqual(serviceRunning(e.home), { running: false });
    assert.doesNotThrow(() => requireStopped(e.home));
    writeFileSync(pidfilePath(e.home), "not json");
    assert.deepEqual(serviceRunning(e.home), { running: false });

    let release;
    const gate = new Promise((r) => { release = r; });
    const first = rebuild({ home: e.home, now: NOW, hooks: { step: async (s) => { if (s === "create") await gate; } } });
    await new Promise((r) => setTimeout(r, 100));
    await assert.rejects(rebuild({ home: e.home, now: NOW }), (err) => err.code === "busy" && err.exit === 3);
    await assert.rejects(restoreBackup({ home: e.home, file: snap.path }), (err) => err.code === "busy");
    release();
    await first;
    assert.ok(!existsSync(path.join(e.home, "ops.lock")), "the lock is released");
    writeFileSync(path.join(e.home, "ops.lock"), "999999");
    assert.equal(await withOpsLock(e.home, async () => "ran"), "ran", "a lock whose owner is gone is replaced");
    await assert.rejects(withOpsLock(e.home, async () => { throw new OpsError("x", "boom"); }), /boom/);
    assert.ok(!existsSync(path.join(e.home, "ops.lock")), "and released after a failure");
});

test("the daily backup runs after 03:00 once per day, retries once after a failure, then waits for tomorrow", async () => {
    const e = env();
    seed(e);
    const t = { now: new Date(2026, 9, 19, 2, 59).getTime() };
    const queue = [];
    const timers = { setTimeout: (fn, ms) => { const h = { fn, ms }; queue.push(h); return h; }, clearTimeout: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); } };
    const sched = createBackupSchedule({ home: e.home, db: e.db, now: () => t.now, timers, retryMs: 600_000, checkMs: 3_600_000 });
    await sched.tick();
    assert.equal(listBackups(e.home).length, 0, "before 03:00 nothing happens");
    t.now = new Date(2026, 9, 19, 3, 5).getTime();
    await sched.tick();
    assert.equal(listBackups(e.home).length, 1);
    await sched.tick();
    assert.equal(listBackups(e.home).length, 1, "once per day");
    t.now = new Date(2026, 9, 20, 3, 1).getTime();
    await sched.tick();
    assert.equal(listBackups(e.home).length, 2, "and again the next day");

    // failure: retried once after 10 minutes, then given up for the day with the error recorded
    const f = env();
    seed(f);
    f.db.exec("PRAGMA query_only = 0");
    const broken = { ...f.db, backup: async () => { throw new Error("no space left"); }, prepare: (...a) => f.db.prepare(...a) };
    queue.length = 0;
    t.now = new Date(2026, 9, 19, 4, 0).getTime();
    const s2 = createBackupSchedule({ home: f.home, db: broken, now: () => t.now, timers, retryMs: 600_000, checkMs: 3_600_000 });
    await s2.tick();
    assert.equal(queue.at(-1).ms, 600_000, "the first failure schedules the single retry");
    t.now += 600_000;
    await s2.tick(true);
    assert.equal(queue.at(-1).ms, 3_600_000, "after the retry fails it goes back to hourly checks");
    assert.equal(s2.due(), false, "but not again today");
    assert.match(backupInfo(f.home).lastBackupError, /no space left/);
    t.now = new Date(2026, 9, 20, 3, 30).getTime();
    assert.equal(s2.due(), true, "the next day it tries again");
});

test("the status report shows backups", async () => {
    const e = env();
    seed(e);
    await runBackup({ home: e.home, db: e.db, now: NOW });
    const runner = createRunner({ db: e.db, repo: e.repo });
    const status = createStatus({ db: e.db, config: { home: e.home }, registry: createRegistry({ enabled: [] }), runner, scheduler: { nextRunAt: () => null }, repo: e.repo, helper: "/nonexistent", now: () => NOW });
    const report = await status.build();
    assert.deepEqual([report.backups.count, report.backups.lastBackupAt], [1, new Date(NOW).toISOString()]);
    const doc = JSON.parse(readFileSync(new URL("../schema/api-status.json", import.meta.url), "utf8"));
    const ajv = new Ajv({ strict: false });
    ajv.addFormat("date-time", true);
    ajv.addSchema(doc);
    const v = ajv.getSchema(`${doc.$id}#/definitions/StatusReport`);
    assert.ok(v(report), JSON.stringify(v.errors));
});

test("CLI: backup, list, restore, rebuild, usage errors and exit codes", async () => {
    const e = env();
    seed(e);
    e.identity.merge(owner(e.db, PEOPLE[1]), owner(e.db, PEOPLE[0]));
    e.db.pragma("wal_checkpoint(TRUNCATE)");
    e.db.close();
    const run = (...args) => { const r = spawnSync(process.execPath, ["bin/reply-core.js", ...args], { env: { ...process.env, REPLY_CORE_HOME: e.home }, encoding: "utf8" }); return { code: r.status, out: r.stdout, err: r.stderr }; };
    const b = run("backup");
    assert.equal(b.code, 0, b.err);
    assert.match(b.out, /backup .*core-\d{8}T\d{6}Z\.db \(\d+\.\d MB, schema \d+, 14 messages, 7 contacts\)/);
    assert.equal(run("backup", "--label", "Bad Label").code, 2);
    assert.equal(run("backup", "--bogus").code, 2);
    const list = run("backups", "list");
    assert.equal(list.code, 0);
    assert.equal(list.out.trim().split("\n").length, 1);
    const file = listBackups(e.home)[0].path;
    const dry = run("restore", file, "--dry-run");
    assert.equal(dry.code, 0, dry.err);
    assert.match(dry.out, /Will replace core\.db \(7 contacts, 14 messages, schema \d+\)/);
    assert.match(dry.out, /dry run: nothing was changed/);
    assert.equal(run("restore").code, 2);
    assert.equal(run("restore", "/etc/passwd").code, 2, "outside the backups folder");
    const rb = run("rebuild", "--dry-run");
    assert.equal(rb.code, 0, rb.err);
    assert.match(rb.out, /Will keep 1 manual merge\(s\)/);
    const real = run("rebuild");
    assert.equal(real.code, 0, real.err);
    assert.match(real.out, /Start Reply Core to re-import/);
    writePidfile(e.home, 1);
    const blocked = run("rebuild");
    assert.equal(blocked.code, 3);
    assert.match(blocked.err, /Reply Core is running \(pid \d+\)\. Stop it first: kill \d+/);
    assert.match(run().err, /usage/);
    assert.equal(run("backup").code, 0, "a backup is allowed while the service runs");
});

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test("service: pidfile while running, online backup works, restore is refused, pidfile removed on exit", async () => {
    const home = tmp();
    const port = await freePort();
    const child = spawn(process.execPath, ["src/index.js"], { env: { ...process.env, REPLY_CORE_HOME: home, REPLY_CORE_PORT: String(port), REPLY_CORE_CONNECTORS: "none", REPLY_CORE_LOG_LEVEL: "error" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    try {
        for (let i = 0; i < 100 && !out.includes("listening"); i++) await new Promise((r) => setTimeout(r, 50));
        const pid = JSON.parse(readFileSync(pidfilePath(home), "utf8"));
        assert.deepEqual([pid.pid, pid.port], [child.pid, port]);
        const run = (...a) => spawnSync(process.execPath, ["bin/reply-core.js", ...a], { env: { ...process.env, REPLY_CORE_HOME: home }, encoding: "utf8" });
        assert.equal(run("backup").status, 0, "online backup while the service writes");
        const file = listBackups(home)[0].path;
        const r = run("restore", file);
        assert.equal(r.status, 3);
        assert.match(r.stderr, new RegExp(`kill ${child.pid}`));
        child.kill("SIGTERM");
        await new Promise((resolve) => child.on("exit", resolve));
        assert.ok(!existsSync(pidfilePath(home)), "the pidfile is removed on a clean exit");
        assert.equal(run("restore", file, "--dry-run").status, 0, "stopped: allowed");
    } finally {
        child.kill("SIGKILL");
    }
});

test("fixtures end to end: a real-sized database survives backup, restore and rebuild", async () => {
    const root = tmp();
    const fx = await buildFixtures({ seed: 42, out: path.join(root, "fx"), counts: { corpus: 5000 } });
    const e = env();
    const lines = readFileSync(fx.corpus, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    for (let i = 0; i < lines.length; i += 1000) e.repo.upsertMessages(lines.slice(i, i + 1000));
    const handles = e.db.prepare("SELECT handle_norm h FROM contact_handles ORDER BY handle_norm LIMIT 40").all().map((r) => r.h);
    const rng = makeRng(3);
    for (let i = 0; i < 12; i++) { const a = rng.pick(handles); const b = rng.pick(handles); const ca = owner(e.db, a); const cb = owner(e.db, b); if (ca !== cb) e.identity.merge(ca, cb); }
    const want = partition(e.db);
    const total = e.db.prepare("SELECT COUNT(*) n FROM messages").get().n;
    const snap = await runBackup({ home: e.home, db: e.db, now: NOW });
    assert.equal(snap.messages, total);
    e.db.close();
    await rebuild({ home: e.home, now: NOW + 10 });
    const { db } = openDb(e.home);
    const repo = createRepo(db, { now: () => NOW });
    const identity = createIdentity({ db, repo });
    repo.setAfterBatch(() => identity.applyPendingMerges());
    for (let i = 0; i < lines.length; i += 1000) repo.upsertMessages(lines.slice(i, i + 1000));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages").get().n, total);
    assert.equal(identity.pendingCount(), 0);
    assert.equal(partition(db), want, "every manual merge is back after the full re-import");
    db.close();
});
