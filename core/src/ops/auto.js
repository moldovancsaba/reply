import { listBackups, runBackup } from "./backup.js";

const HOUR = 3_600_000;

// Daily backup inside the service: the first check at or after 03:00 local time on a day without a backup runs one.
// A failure is retried once after 10 minutes, then recorded (backup-state.json -> status API) and left for the next day.
export function createBackupSchedule({ home, db, logger, now = () => Date.now(), timers = { setTimeout, clearTimeout }, retryMs = 600_000, checkMs = HOUR }) {
    let timer = null;
    let stopped = false;
    let gaveUpOn = null; // local date the retry also failed: wait for tomorrow

    const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
    const due = () => {
        const d = new Date(now());
        if (d.getHours() < 3 || gaveUpOn === localDay(now())) return false;
        const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        return listBackups(home).filter((b) => !b.label && b.ts >= startOfDay).length === 0;
    };

    async function tick(isRetry = false) {
        let failed = false;
        if (due()) {
            try {
                const r = await runBackup({ home, db, now: now() });
                logger?.info({ bytes: r.bytes }, "ops.backup");
            } catch (err) {
                failed = true;
                logger?.warn({ code: err.code, retry: !isRetry }, "ops.backup failed");
                if (isRetry) gaveUpOn = localDay(now());
            }
        }
        if (stopped) return;
        const retryNow = failed && !isRetry;
        timer = timers.setTimeout(() => tick(retryNow), retryNow ? retryMs : checkMs);
    }

    return {
        start: () => { timer = timers.setTimeout(() => tick(false), 5000); },
        stop: () => { stopped = true; if (timer) timers.clearTimeout(timer); },
        tick,
        due,
    };
}
