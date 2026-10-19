import { randomUUID } from "node:crypto";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { classify } from "./errors.js";

const KEEP_RUNS = 50;

export const backoffMs = (attempt, random = Math.random) => Math.min(60_000, 1000 * 2 ** (attempt - 1)) * (0.5 + random() / 2);

function withTimeout(promise, ms, controller) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(Object.assign(new Error(`fetch exceeded ${ms} ms`), { code: "timeout" }));
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Owns everything operational about a sync: locking, preflight, paging, atomic cursor commits, retries, run records.
// Connectors only fetch and normalize.
export function createRunner({ db, repo, logger, onContacts, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random, fetchTimeoutMs = 30_000, maxAttempts = 5, pageLimit = 500 }) {
    const running = new Map();
    const metrics = { runs: 0, failuresByCode: {}, lastDurationMs: null };
    const key = (id, account) => `${id}\u0000${account}`;
    const insertRun = db.prepare("INSERT INTO sync_runs (id, connector, account, started_ms, outcome) VALUES (?,?,?,?, 'running')");
    const finishRun = db.prepare(`UPDATE sync_runs SET ended_ms=@ended_ms, outcome=@outcome, error_code=@error_code, attempts=@attempts, pages=@pages,
        inserted=@inserted, updated=@updated, skipped=@skipped, quarantined=@quarantined WHERE id=@id`);
    const prune = db.prepare("DELETE FROM sync_runs WHERE connector = ? AND id NOT IN (SELECT id FROM sync_runs WHERE connector = ? ORDER BY started_ms DESC, rowid DESC LIMIT ?)");

    const isRunning = (id, account = "") => running.has(key(id, account));

    // Cursor and batch commit together: a failure rolls both back, so the next run refetches the same page.
    function commit(connector, account, page) {
        return db.transaction(() => {
            const res = repo.upsertMessages(page.messages ?? []);
            if (page.contacts?.length && onContacts) onContacts(page.contacts);
            const cur = repo.getSyncState(connector.id, account);
            repo.setSyncState(connector.id, account, {
                cursor_json: JSON.stringify(page.nextCursor ?? {}),
                // connectors that count something other than messages (people) report an absolute `total`
                messages_total: page.total ?? (cur?.messages_total ?? 0) + res.inserted,
            });
            return res;
        })();
    }

    async function execute(connector, account, runId, signal) {
        const state = { attempts: 0, pages: 0, inserted: 0, updated: 0, skipped: 0, quarantined: 0 };
        const setState = (patch) => repo.setSyncState(connector.id, account, patch);
        const t0 = now();
        let outcome = "ok";
        let errorCode = null;
        setState({ state: "running" });
        try {
            const pre = await connector.preflight();
            if (!pre.ok) {
                const e = Object.assign(new Error(pre.hint ?? pre.code), { code: pre.code });
                throw e;
            }
            let attempt = 0;
            for (;;) {
                if (signal?.aborted) {
                    outcome = "aborted";
                    break;
                }
                const cursorBefore = repo.getSyncState(connector.id, account)?.cursor_json ?? "{}";
                try {
                    const controller = new AbortController();
                    signal?.addEventListener("abort", () => controller.abort(), { once: true });
                    const page = await withTimeout(Promise.resolve(connector.fetch(account, JSON.parse(cursorBefore), { limit: pageLimit, signal: controller.signal })), fetchTimeoutMs, controller);
                    if (page.more && JSON.stringify(page.nextCursor ?? {}) === cursorBefore) {
                        throw Object.assign(new Error("connector returned an unchanged cursor with more=true"), { code: "internal" });
                    }
                    const res = commit(connector, account, page);
                    state.pages++;
                    for (const k of ["inserted", "updated", "skipped", "quarantined"]) state[k] += res[k];
                    attempt = 0;
                    if (!page.more) break;
                    await yieldToLoop();
                } catch (e) {
                    if (signal?.aborted) {
                        outcome = "aborted";
                        break;
                    }
                    const c = classify(e);
                    if (c.kind === "retryable" && ++attempt < maxAttempts) {
                        state.attempts++;
                        const delay = backoffMs(attempt, random);
                        logger?.warn({ connector: connector.id, code: c.code, attempt, delayMs: Math.round(delay) }, "sync.retry");
                        await sleep(delay);
                        continue;
                    }
                    throw e;
                }
            }
            if (outcome === "aborted") setState({ state: "idle" });
            else setState({ state: "idle", last_success_ms: now(), last_error_code: null });
        } catch (e) {
            const c = classify(e);
            errorCode = c.code;
            outcome = c.kind === "blocked" ? "blocked" : "error";
            setState({ state: c.kind === "blocked" ? "blocked" : "error", last_error_code: c.code, last_error_ms: now() });
            metrics.failuresByCode[c.code] = (metrics.failuresByCode[c.code] ?? 0) + 1;
            logger?.error({ connector: connector.id, account, code: c.code, kind: c.kind }, "sync.failed");
        }
        const ms = now() - t0;
        metrics.runs++;
        metrics.lastDurationMs = ms;
        finishRun.run({ id: runId, ended_ms: now(), outcome, error_code: errorCode, ...state });
        prune.run(connector.id, connector.id, KEEP_RUNS);
        logger?.info({ connector: connector.id, account, outcome, pages: state.pages, inserted: state.inserted, updated: state.updated, skipped: state.skipped, quarantined: state.quarantined, ms }, "sync.run");
        return { runId, outcome, errorCode, ...state };
    }

    // Returns immediately with the run id; `done` resolves with the result. Null when a run is already active.
    function start(connector, account = "", { signal } = {}) {
        const k = key(connector.id, account);
        if (running.has(k)) return null;
        const runId = `r_${randomUUID().slice(0, 12)}`;
        insertRun.run(runId, connector.id, account, now());
        const done = execute(connector, account, runId, signal).finally(() => running.delete(k));
        running.set(k, done);
        return { runId, done };
    }

    async function waitIdle() {
        await Promise.allSettled([...running.values()]);
    }

    return { start, isRunning, waitIdle, metrics: () => ({ ...metrics, failuresByCode: { ...metrics.failuresByCode } }) };
}
