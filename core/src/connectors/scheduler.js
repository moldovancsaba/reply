// Runs each enabled connector on its interval. Blocked connectors are skipped until an operator-triggered run clears them.
export function createScheduler({ registry, runner, repo, logger, intervals = {}, initialDelayMs = 1000, timers = { setTimeout, clearTimeout } }) {
    const handles = new Map();
    const nextAt = new Map();
    const controller = new AbortController();
    let stopped = false;

    const intervalFor = (c) => intervals[c.id] ?? c.intervalMs;

    // A crash mid-run leaves state `running`; nothing is running after a restart.
    function resetRunning() {
        for (const c of registry.list()) {
            for (const account of [""]) {
                const s = repo.getSyncState(c.id, account);
                if (s?.state === "running") repo.setSyncState(c.id, account, { state: "idle" });
            }
        }
    }

    async function tick(c) {
        try {
            for (const account of await c.accounts()) {
                if (stopped) return;
                const s = repo.getSyncState(c.id, account);
                if (s?.state === "blocked") {
                    logger?.debug({ connector: c.id, account }, "sync.skip blocked");
                    continue;
                }
                const run = runner.start(c, account, { signal: controller.signal });
                if (run) await run.done;
            }
        } catch (err) {
            logger?.error({ connector: c.id, err }, "sync.tick failed");
        }
        if (!stopped) {
            handles.set(c.id, timers.setTimeout(() => tick(c), intervalFor(c)));
            nextAt.set(c.id, Date.now() + intervalFor(c));
        }
    }

    return {
        start() {
            resetRunning();
            for (const c of registry.list()) {
                handles.set(c.id, timers.setTimeout(() => tick(c), initialDelayMs));
                nextAt.set(c.id, Date.now() + initialDelayMs);
            }
        },
        async stop() {
            stopped = true;
            controller.abort();
            for (const h of handles.values()) timers.clearTimeout(h);
            await runner.waitIdle();
        },
        intervalFor,
        nextRunAt: (id) => nextAt.get(id) ?? null,
    };
}
