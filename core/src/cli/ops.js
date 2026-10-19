import { runBackup, listBackups } from "../ops/backup.js";
import { EXIT, OpsError } from "../ops/guard.js";
import { rebuild } from "../ops/rebuild.js";
import { restoreBackup } from "../ops/restore.js";

const USAGE = `usage:
  reply-core backup [--label <name>]           snapshot core.db (safe while Reply Core runs)
  reply-core backups list                      list snapshots
  reply-core restore <file> [--dry-run] [--allow-external]   replace core.db with a verified snapshot (stop Reply Core first)
  reply-core rebuild [--dry-run]               start a new database that keeps only your manual merges (stop Reply Core first)
exit codes: 0 ok, 2 usage, 3 Reply Core is running or another operation is, 4 verification failed, 5 I/O error`;

const mb = (n) => `${(n / 1_048_576).toFixed(1)} MB`;

export async function opsCli(argv, { home, stdout = process.stdout, stderr = process.stderr, now = Date.now(), hooks } = {}) {
    const say = (s) => stdout.write(`${s}\n`);
    try {
        const [cmd, ...rest] = argv;
        const flag = (name) => rest.includes(name);
        const known = (allowed) => { const bad = rest.find((a) => a.startsWith("--") && !allowed.includes(a)); if (bad) throw new OpsError("usage", `unknown option ${bad}`, EXIT.usage); };
        if (cmd === "backup") {
            known(["--label"]);
            const i = rest.indexOf("--label");
            const label = i >= 0 ? rest[i + 1] : null;
            if (i >= 0 && !/^[a-z0-9-]+$/.test(label ?? "")) throw new OpsError("usage", "--label must be lowercase letters, digits and dashes", EXIT.usage);
            const r = await runBackup({ home, label, now, hooks });
            say(`backup ${r.path} (${mb(r.bytes)}, schema ${r.version}, ${r.messages} messages, ${r.contacts} contacts)`);
            say(`user state ${r.userState}`);
            return EXIT.ok;
        }
        if (cmd === "backups" && rest[0] === "list") {
            for (const b of listBackups(home)) say(`${new Date(b.ts).toISOString()}\t${mb(b.bytes)}\t${b.label ?? ""}\t${b.file}`);
            return EXIT.ok;
        }
        if (cmd === "restore") {
            known(["--dry-run", "--allow-external"]);
            const file = rest.find((a) => !a.startsWith("--"));
            if (!file) throw new OpsError("usage", "restore needs a backup file", EXIT.usage);
            const r = await restoreBackup({ home, file, dryRun: flag("--dry-run"), allowExternal: flag("--allow-external"), now, hooks });
            say(`${r.dryRun ? "Will replace" : "Replaced"} core.db (${r.contacts} contacts, ${r.messages} messages, schema ${r.backupSchema}) with ${r.file}.`);
            say(`The previous database is kept: ${r.keeps}.`);
            if (r.dryRun) say("dry run: nothing was changed");
            return EXIT.ok;
        }
        if (cmd === "rebuild") {
            known(["--dry-run"]);
            const r = await rebuild({ home, dryRun: flag("--dry-run"), now, hooks });
            say(`${r.dryRun ? "Will keep" : "Kept"} ${r.manualMerges} manual merge(s)${r.revertedMerges ? ` (${r.revertedMerges} undone merge(s) are not carried over)` : ""}; everything else is imported again from your sources.`);
            say(`The old database is kept: ${r.keeps}.`);
            if (r.dryRun) say("dry run: nothing was changed"); else say(`pre-rebuild backup: ${r.backup}\nStart Reply Core to re-import. Merges whose people have not been imported yet are waiting: ${r.pendingNow ?? 0} pending now.`);
            return EXIT.ok;
        }
        stderr.write(`${USAGE}\n`);
        return EXIT.usage;
    } catch (err) {
        if (err instanceof OpsError) { stderr.write(`reply-core: ${err.message}\n`); return err.exit; }
        stderr.write(`reply-core: ${err.message}\n`);
        return EXIT.io;
    }
}
