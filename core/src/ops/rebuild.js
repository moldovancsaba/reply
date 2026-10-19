import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { createIdentity } from "../identity/service.js";
import { openDb } from "../storage/db.js";
import { createRepo } from "../storage/repo.js";
import { runBackup, stamp } from "./backup.js";
import { OpsError, EXIT, openReadonlyClean, requireStopped, withOpsLock } from "./guard.js";
import { exportUserState, importUserState } from "./userstate.js";

const FRESH = "core.rebuild.db";

// Starts a new database that contains only what cannot be re-imported: the user's manual merges. Everything else
// (messages, contacts) comes back when the connectors run. The old file is kept, and a `pre-rebuild` backup and the
// user-state JSON are written first, so the previous state is one `restore` away.
export async function rebuild({ home, dryRun = false, now = Date.now(), hooks = {} }) {
    return withOpsLock(home, async () => {
        requireStopped(home);
        const core = path.join(home, "core.db");
        if (!existsSync(core)) throw new OpsError("not_found", `no database at ${core}`, EXIT.usage);
        const source = openReadonlyClean(core);
        let state;
        try { state = exportUserState(source.db, now); } finally { source.close(); }
        const active = state.manualMerges.filter((m) => !m.revertedAt);
        const plan = { manualMerges: active.length, revertedMerges: state.manualMerges.length - active.length, keeps: `${core} as core.db.replaced-${stamp(now)}` };
        if (dryRun) return { dryRun: true, ...plan };

        await hooks.step?.("backup");
        const backup = await runBackup({ home, label: "pre-rebuild", now });
        const fresh = path.join(home, FRESH);
        for (const ext of ["", "-wal", "-shm"]) rmSync(fresh + ext, { force: true }); // leftovers of an interrupted rebuild
        let result;
        try {
            await hooks.step?.("create");
            const { db } = openDb(home, { fileName: FRESH });
            try {
                const repo = createRepo(db);
                const identity = createIdentity({ db, repo });
                repo.setAfterBatch(() => identity.applyPendingMerges());
                await hooks.step?.("import");
                result = importUserState(db, identity, state);
                result.pendingNow = identity.pendingCount();
            } finally {
                db.close();
            }
            await hooks.step?.("swap");
            const base = core;
            const target = `${base}.replaced-${stamp(now)}`;
            renameSync(base, target);
            for (const ext of ["-wal", "-shm"]) if (existsSync(base + ext)) renameSync(base + ext, target + ext);
            await hooks.step?.("rename");
            renameSync(fresh, base);
            for (const ext of ["-wal", "-shm"]) if (existsSync(fresh + ext)) renameSync(fresh + ext, base + ext);
        } catch (err) {
            for (const ext of ["", "-wal", "-shm"]) rmSync(fresh + ext, { force: true });
            throw err;
        }
        return { dryRun: false, ...plan, ...result, backup: backup.path, userState: backup.userState };
    });
}
