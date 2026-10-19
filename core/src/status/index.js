import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";
import { CODES } from "../connectors/errors.js";
import { HelperError, helperVersion, verifyChecksum } from "../helper/index.js";
import { describe, LABELS, STATE_MESSAGES, CATALOG } from "./recovery.js";

const STORAGE_TTL = 60_000;
const HELPER_TTL = 30_000;
const REPORT_TTL = 2_000;
const RANK = { blocked: 4, error: 3, syncing: 2, never_synced: 1, ok: 0 };

export function deriveState(s, running) {
    if (running) return "syncing";
    if (!s) return "never_synced";
    if (s.state === "running") return "syncing";
    if (s.state === "blocked") return "blocked";
    if (s.state === "error") return "error";
    return s.last_success_ms ? "ok" : "never_synced";
}

// Builds the single honest report of storage, helper and every source. Cheap by design: sync state comes from the
// database, the helper is probed at most every 30 s, and a built report is reused for 2 s so UI polling cannot hammer anything.
export function createStatus({ db, config, registry, runner, scheduler, repo, helper, now = () => Date.now() }) {
    const cache = { storage: null, helper: null, report: null };
    const fresh = (e, ttl) => e && now() - e.at < ttl;
    const iso = (ms) => new Date(Math.min(ms, now())).toISOString(); // past times: a clock jump must not show a future "last success"
    const isoAt = (ms) => new Date(ms).toISOString();
    const dbFile = path.join(config.home, "core.db");

    function checkStorage() {
        if (fresh(cache.storage, STORAGE_TTL)) return cache.storage.value;
        let value;
        try {
            // quick_check runs once at start (openDb); here only a cheap probe, because a full check would block the event loop on a big database
            const version = db.prepare("SELECT COALESCE(MAX(version),0) v FROM schema_migrations").get().v;
            let bytes = statSync(dbFile).size;
            try { bytes += statSync(`${dbFile}-wal`).size; } catch { /* no wal file yet */ }
            value = { state: "ok", version, dbBytes: bytes };
        } catch (err) {
            const code = err.code === "SQLITE_CORRUPT" || err.code === "SQLITE_NOTADB" ? "storage_corrupt" : "storage_unavailable";
            value = { state: "error", version: 0, dbBytes: 0, code, message: CATALOG.storage[code].message, recovery: CATALOG.storage[code].recovery };
        }
        cache.storage = { at: now(), value };
        return value;
    }

    async function checkHelper() {
        if (fresh(cache.helper, HELPER_TTL)) return cache.helper.value;
        let value;
        try {
            verifyChecksum(helper);
            const v = await helperVersion({ helper, verify: false, timeoutMs: 5000 });
            value = { state: "ok", version: `${v.version} schema=${v.schema}` };
        } catch (err) {
            const mismatch = err instanceof HelperError && /checksum/.test(err.message);
            value = { state: mismatch ? "checksum_mismatch" : "missing" };
        }
        cache.helper = { at: now(), value };
        return value;
    }

    function connectorStatus(c) {
        const rows = db.prepare("SELECT * FROM sync_state WHERE connector = ?").all(c.id);
        const accounts = rows.length ? rows : [null];
        const per = accounts.map((s) => {
            const account = s?.account ?? "";
            const prog = runner.progress(c.id, account);
            const state = deriveState(s, runner.isRunning(c.id, account));
            const code = state === "blocked" || state === "error" ? (CODES.has(s?.last_error_code) ? s.last_error_code : "internal") : undefined;
            const info = code ? describe(code, c.id) : null;
            return {
                account, state, ...(code ? { code } : {}), message: info ? info.message : STATE_MESSAGES[state],
                ...(info && state === "blocked" ? { recovery: info.recovery } : {}),
                ...(state === "error" ? { retryAt: scheduler.nextRunAt(c.id) ? isoAt(scheduler.nextRunAt(c.id)) : undefined } : {}),
                messagesTotal: s?.messages_total ?? 0, ...(prog ? { messagesThisRun: prog.inserted + prog.updated } : {}),
                ...(s?.last_success_ms ? { lastSuccessAt: iso(s.last_success_ms) } : {}), ...(s?.last_error_ms ? { lastErrorAt: iso(s.last_error_ms) } : {}),
            };
        });
        const worst = per.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a));
        const next = scheduler.nextRunAt(c.id);
        const { account, ...top } = worst;
        void account;
        return {
            id: c.id, label: LABELS[c.id] ?? c.id, ...top,
            messagesTotal: per.reduce((n, p) => n + p.messagesTotal, 0),
            ...(next ? { nextRunAt: isoAt(next) } : {}),
            ...(per.length > 1 ? { accounts: per } : {}),
        };
    }

    async function build() {
        if (fresh(cache.report, REPORT_TTL)) return cache.report.value;
        const [storage, helperState] = [checkStorage(), await checkHelper()];
        const connectors = registry.list().map(connectorStatus);
        const overall = storage.state === "error" || helperState.state !== "ok" || connectors.some((c) => c.state === "blocked") ? "blocked"
            : connectors.some((c) => c.state === "error") ? "degraded" : "ok";
        const value = { overall, storage, helper: helperState, connectors, metrics: runner.metrics(), generatedAt: new Date(now()).toISOString() };
        cache.report = { at: now(), value };
        return value;
    }

    // Stable tag over everything except the timestamp, so an unchanged state answers 304.
    const etagOf = (report) => `W/"${createHash("sha1").update(JSON.stringify({ ...report, generatedAt: 0 })).digest("hex").slice(0, 20)}"`;

    // Operator-initiated: forget cached probes, re-check every blocked source and, where it now works, clear it and sync.
    async function recheck() {
        cache.storage = cache.helper = cache.report = null;
        for (const c of registry.list()) {
            for (const s of db.prepare("SELECT account FROM sync_state WHERE connector = ? AND state = 'blocked'").all(c.id)) {
                const pre = await c.preflight();
                if (!pre.ok) continue;
                repo.setSyncState(c.id, s.account, { state: "idle", last_error_code: null });
                const run = runner.start(c, s.account);
                run?.done.catch(() => {});
            }
        }
        cache.report = null;
        return build();
    }

    return { build, recheck, etagOf, deriveState };
}
