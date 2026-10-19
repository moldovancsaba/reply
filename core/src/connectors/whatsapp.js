import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { normalizeHandle } from "../identity/normalize.js";
import { ConnectorError } from "./errors.js";

// WhatsApp Desktop's ChatStorage.sqlite is an undocumented, app-private format: this connector is best-effort. It checks
// the layout before reading and stops (blocked: schema_unsupported) rather than guess. Read-only; never sends.
export const REQUIRED_SCHEMA = {
    ZWAMESSAGE: ["Z_PK", "ZTEXT", "ZMESSAGEDATE", "ZISFROMME", "ZFROMJID", "ZTOJID", "ZCHATSESSION", "ZMEDIAITEM", "ZMESSAGETYPE"],
    ZWACHATSESSION: ["Z_PK", "ZCONTACTJID", "ZPARTNERNAME"],
    Z_METADATA: ["Z_UUID"],
};

const HINTS = {
    permission_denied: "Grant Full Disk Access to the app that starts Reply Core, then recheck.",
    source_missing: "WhatsApp Desktop has no data on this Mac. Install it and link your phone.",
    source_locked: "The WhatsApp database is busy. It will be retried.",
    prompt: "macOS may be asking whether Reply Core can access WhatsApp data. Look for a permission dialog, allow it, then recheck.",
    schema_unsupported: "WhatsApp changed its data format. Reply Core stopped reading it to avoid wrong data. Check for a Reply Core update.",
};

const CORE_DATA_EPOCH_S = 978307200;
const SYSTEM_TYPE = 10;
const TEMP_PREFIX = "rc-wa-";
const CACHE_MS = 60_000;

export function candidatePaths(home = os.homedir()) {
    return [
        "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite",
        "Library/Containers/net.whatsapp.WhatsApp/Data/Library/Application Support/WhatsApp/ChatStorage.sqlite",
        "Library/Containers/com.whatsapp/Data/Library/Application Support/WhatsApp/ChatStorage.sqlite",
        "Library/Containers/desktop.WhatsApp/Data/Library/Application Support/WhatsApp/ChatStorage.sqlite",
    ].map((r) => path.join(home, r));
}

// First candidate that is readable, else the first one that exists, else the primary path (so the error names it).
export function resolveDbPath(config = {}, home) {
    if (config.whatsappDb) return config.whatsappDb;
    const all = candidatePaths(home);
    return all.find((p) => existsSync(p)) ?? all[0];
}

function fsCode(err) {
    if (err.code === "EACCES" || err.code === "EPERM") return "permission_denied";
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return "source_missing";
    return null;
}

export function schemaProblem(db) {
    for (const [table, cols] of Object.entries(REQUIRED_SCHEMA)) {
        const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
        const missing = cols.filter((c) => !have.has(c));
        if (missing.length) return `${table} is missing ${missing.join(", ")}`;
    }
    return null;
}

// Removes temp copies left by a crash (older than an hour).
export function cleanStaleCopies(dir = os.tmpdir(), now = Date.now()) {
    let removed = 0;
    for (const name of readdirSync(dir)) {
        if (!name.startsWith(TEMP_PREFIX)) continue;
        const full = path.join(dir, name);
        try {
            if (now - statSync(full).mtimeMs > 3_600_000) { rmSync(full, { recursive: true, force: true }); removed++; }
        } catch { /* already gone */ }
    }
    return removed;
}

// Maps one ZWAMESSAGE row (joined with its chat session) to a NormalizedMessage, or says why it is skipped.
export function toNormalized(r, region) {
    const jid = String(r.ZSESSIONJID ?? "");
    if (r.ZMESSAGETYPE === SYSTEM_TYPE) return { skip: "system" };
    if (jid.endsWith("@broadcast")) return { skip: "system" };
    const text = String(r.ZTEXT ?? "").trim() || (r.ZMEDIAITEM != null ? "[Media attachment]" : "");
    if (!text) return { skip: "empty" };
    const isGroup = jid.endsWith("@g.us");
    const handle = normalizeHandle(jid, "whatsapp", region);
    if (!handle) return { skip: "bad_handle" };
    const sender = isGroup && !r.ZISFROMME ? normalizeHandle(String(r.ZFROMJID ?? ""), "whatsapp", region)?.handle_norm : undefined;
    return {
        message: {
            channel: "whatsapp", account: "", providerMessageKey: String(r.Z_PK), threadKey: jid, handle_norm: handle.handle_norm,
            isFromMe: Boolean(r.ZISFROMME), tsMs: Math.round((Number(r.ZMESSAGEDATE) + CORE_DATA_EPOCH_S) * 1000), text, attachments: [],
            meta: isGroup ? { isGroup: true, ...(sender ? { sender } : {}) } : {},
        },
    };
}

// Opening another app's container can make macOS show a permission dialog, and open() then waits for the answer. A
// blocked open() on a thread pool would stall the service (and even its exit), so the probe is a short-lived child
// (`dd` opens the file for reading and nothing more) that is killed at the deadline; macOS attributes the request to
// the same app that started Reply Core. One probe per file at a time, so repeated rechecks cannot pile up processes.
const pending = new Map();
const ERRNO = [[/operation not permitted/i, "EPERM"], [/permission denied/i, "EACCES"], [/no such file|not a directory/i, "ENOENT"]];
export function probeFile(src, timeoutMs = 8000) {
    if (!pending.has(src)) {
        const p = new Promise((resolve, reject) => {
            execFile("/bin/dd", [`if=${src}`, "of=/dev/null", "bs=1", "count=0"], { timeout: timeoutMs, killSignal: "SIGKILL" }, (err, _out, stderr) => {
                if (!err) return resolve();
                if (err.killed) return reject(Object.assign(new Error("waiting for macOS"), { code: "EPERM_WAIT" }));
                const hit = ERRNO.find(([re]) => re.test(stderr));
                reject(Object.assign(new Error(String(stderr).trim().slice(-200)), { code: hit?.[1] ?? "EIO" }));
            });
        }).finally(() => pending.delete(src));
        p.catch(() => {});
        pending.set(src, p);
    }
    return pending.get(src);
}

export function createWhatsAppConnector({ config = {}, logger, tmpDir = os.tmpdir(), forceCopy = false, probe = probeFile } = {}) {
    const region = config.defaultRegion ?? "HU";
    let cache = null; // a temp copy reused across the pages of one run
    let timer = null;

    const dropCache = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (cache) rmSync(cache.dir, { recursive: true, force: true });
        cache = null;
    };

    function copyOf(src) {
        const stamp = (p) => { try { const s = statSync(p); return `${s.mtimeMs}:${s.size}`; } catch { return "-"; } };
        const key = `${stamp(src)}|${stamp(`${src}-wal`)}`;
        if (cache && cache.key === key) return cache.file;
        dropCache();
        const dir = mkdtempSync(path.join(tmpDir, TEMP_PREFIX));
        try {
            const file = path.join(dir, "ChatStorage.sqlite");
            copyFileSync(src, file);
            for (const ext of ["-wal", "-shm"]) if (existsSync(src + ext)) copyFileSync(src + ext, file + ext);
            cache = { dir, file, key };
            timer = setTimeout(dropCache, CACHE_MS);
            timer.unref();
            return file;
        } catch (err) {
            rmSync(dir, { recursive: true, force: true });
            throw err;
        }
    }

    // Opens read-only; when SQLite cannot open the live (WAL) database in place, reads a temporary copy instead.
    async function openSource(src) {
        cleanStaleCopies(tmpDir);
        const classify = (err) => {
            if (err.code === "EPERM_WAIT") return new ConnectorError("permission_denied", "WhatsApp database: waiting for a macOS permission answer", { hint: HINTS.prompt });
            const code = fsCode(err);
            if (code) return new ConnectorError(code, `WhatsApp database: ${err.code}`, { hint: HINTS[code] });
            return new ConnectorError("internal", `WhatsApp database: ${err.message}`);
        };
        // errno tells "not there" from "macOS refused" (SQLite's own errors do not)
        try {
            await probe(src);
        } catch (err) {
            throw classify(err);
        }
        if (!forceCopy) {
            try {
                return { db: new Database(src, { readonly: true, fileMustExist: true }), copied: false };
            } catch (err) {
                const direct = fsCode(err);
                if (direct) throw classify(err);
                if (!/SQLITE_(CANTOPEN|READONLY|BUSY|LOCKED)/.test(err.code ?? "")) throw classify(err);
            }
        }
        try {
            return { db: new Database(copyOf(src), { readonly: true, fileMustExist: true }), copied: true };
        } catch (err) {
            if (err instanceof ConnectorError) throw err;
            throw classify(err);
        }
    }

    async function withSource(fn) {
        const src = resolveDbPath(config);
        const { db, copied } = await openSource(src);
        try {
            const problem = schemaProblem(db);
            if (problem) throw new ConnectorError("schema_unsupported", `WhatsApp schema: ${problem}`, { hint: HINTS.schema_unsupported });
            return fn(db, copied);
        } catch (err) {
            if (err instanceof ConnectorError) throw err;
            if (/SQLITE_(BUSY|LOCKED)/.test(err.code ?? "")) throw new ConnectorError("source_locked", "WhatsApp database is busy", { hint: HINTS.source_locked });
            throw new ConnectorError("internal", `WhatsApp read failed: ${err.message}`);
        } finally {
            db.close();
        }
    }

    return {
        id: "whatsapp",
        channel: "whatsapp",
        intervalMs: 120_000,
        accounts: async () => [""],
        async preflight() {
            try {
                await withSource(() => {});
                return { ok: true };
            } catch (err) {
                if (err instanceof ConnectorError && err.code !== "internal") return { ok: false, code: err.code, hint: err.hint ?? err.message };
                throw err;
            }
        },
        async fetch(_account, cursor, { limit }) {
            const t0 = performance.now();
            const out = await withSource((db, copied) => {
                const uuid = db.prepare("SELECT Z_UUID u FROM Z_METADATA LIMIT 1").get()?.u ?? "";
                let pk = Number(cursor.pk) || 0;
                if (cursor.db && cursor.db !== uuid) {
                    // the app's database was replaced (reinstall): primary keys restart, so start over. Purge first for a clean state.
                    logger?.warn({ connector: "whatsapp" }, "connector.whatsapp database identity changed: re-importing from the start");
                    pk = 0;
                }
                const rows = db.prepare(`SELECT m.Z_PK, m.ZTEXT, m.ZMESSAGEDATE, m.ZISFROMME, m.ZFROMJID, m.ZMEDIAITEM, m.ZMESSAGETYPE, s.ZCONTACTJID AS ZSESSIONJID
                    FROM ZWAMESSAGE m LEFT JOIN ZWACHATSESSION s ON s.Z_PK = m.ZCHATSESSION WHERE m.Z_PK > ? ORDER BY m.Z_PK ASC LIMIT ?`).all(pk, limit);
                return { rows, uuid, pk, copied };
            });
            const messages = [];
            const skipped = { system: 0, empty: 0, bad_handle: 0 };
            for (const r of out.rows) {
                const m = toNormalized(r, region);
                if (m.skip) skipped[m.skip]++;
                else messages.push(m.message);
            }
            const more = out.rows.length === limit;
            if (!more) dropCache();
            const last = out.rows.at(-1)?.Z_PK ?? out.pk;
            logger?.info({ connector: "whatsapp", messages: messages.length, skippedSystem: skipped.system, skippedEmpty: skipped.empty, skippedBadHandle: skipped.bad_handle, usedCopy: out.copied, ms: Math.round(performance.now() - t0) }, "connector.whatsapp page");
            return { messages, nextCursor: { pk: last, db: out.uuid }, more };
        },
        close: dropCache,
    };
}
