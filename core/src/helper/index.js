import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const SUPPORTED_SCHEMA = 1;
const MAX_STDOUT = 64 * 1024 * 1024;
const MAX_STDERR = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

const EXIT_CODES = { 10: "permission_denied", 11: "source_missing", 12: "source_locked", 13: "schema_unsupported" };
const RETRYABLE = new Set(["source_locked", "timeout"]);

// code is a ConnectorErrorCode (see docs/CORE_CONNECTORS.md): permission_denied, source_missing, source_locked,
// schema_unsupported, helper_unavailable, timeout, internal.
export class HelperError extends Error {
    constructor(code, message, { exitCode } = {}) {
        super(message);
        this.name = "HelperError";
        this.code = code;
        this.exitCode = exitCode;
        this.retryable = RETRYABLE.has(code);
    }
}

export function defaultHelperPath() {
    return process.env.REPLY_CORE_HELPER || new URL("../../helper/bin/reply-core-helper", import.meta.url).pathname;
}

export const sha256File = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

// Refuses to run a binary whose hash differs from the one recorded by helper/build.sh next to it.
export function verifyChecksum(helper = defaultHelperPath()) {
    let actual;
    let expected;
    try {
        actual = sha256File(helper);
        expected = readFileSync(`${helper}.sha256`, "utf8").trim();
    } catch {
        throw new HelperError("helper_unavailable", `helper not built (run helper/build.sh): ${path.basename(helper)}`);
    }
    if (actual !== expected) throw new HelperError("helper_unavailable", "helper checksum mismatch; rebuild with helper/build.sh");
}

function run(helper, args, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, input }) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new HelperError("internal", "aborted"));
        // own process group so a kill also reaches anything the helper started (a stuck grandchild would keep stdout open)
        const child = spawn(helper, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], detached: true });
        if (input !== undefined) { child.stdin.on("error", () => {}); child.stdin.end(input); } // secrets go on stdin, never in arguments
        let out = "";
        let err = "";
        let settled = false;
        let killedFor = null;
        const kill = (why) => {
            killedFor ??= why;
            try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        };
        const timer = setTimeout(() => kill("timeout"), timeoutMs);
        const onAbort = () => kill("aborted");
        signal?.addEventListener("abort", onAbort, { once: true });
        child.stdout.on("data", (d) => { out += d; if (out.length > MAX_STDOUT) kill("too_large"); });
        child.stderr.on("data", (d) => { if (err.length < MAX_STDERR) err += d; });
        const done = (fn) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", onAbort); fn(); };
        child.on("error", (e) => done(() => reject(new HelperError("helper_unavailable", `cannot start helper: ${e.code ?? e.message}`))));
        child.on("close", (code) => done(() => {
            if (killedFor === "timeout") return reject(new HelperError("timeout", `helper exceeded ${timeoutMs} ms`));
            if (killedFor === "aborted") return reject(new HelperError("internal", "aborted"));
            if (killedFor === "too_large") return reject(new HelperError("internal", "helper output too large"));
            resolve({ exitCode: code, stdout: out, stderr: err });
        }));
    });
}

function parseRecords(stdout) {
    const records = [];
    for (const line of stdout.split("\n")) {
        if (!line) continue;
        let rec;
        try {
            rec = JSON.parse(line);
        } catch {
            throw new HelperError("internal", "helper produced a line that is not JSON");
        }
        if (rec.schemaVersion !== undefined && rec.schemaVersion !== SUPPORTED_SCHEMA) {
            throw new HelperError("schema_unsupported", `helper schemaVersion ${rec.schemaVersion} is not supported (expected ${SUPPORTED_SCHEMA})`);
        }
        records.push(rec);
    }
    return records;
}

// Runs a helper command and returns its records. Non-zero exits become HelperError with a connector error code.
export async function runHelper(args, { helper = defaultHelperPath(), signal, timeoutMs, verify = true, input } = {}) {
    if (verify) verifyChecksum(helper);
    const { exitCode, stdout, stderr } = await run(helper, args, { signal, timeoutMs, input });
    if (exitCode !== 0) {
        const code = EXIT_CODES[exitCode] ?? "internal";
        const tail = stderr.trim().split("\n").at(-1)?.slice(0, 300) ?? "";
        throw new HelperError(code, `helper exited ${exitCode}${tail ? `: ${tail}` : ""}`, { exitCode });
    }
    const records = parseRecords(stdout);
    return {
        records,
        messages: records.filter((r) => r.type === "message"),
        contacts: records.filter((r) => r.type === "contact"),
        warnings: records.filter((r) => r.type === "warning"),
        secret: records.find((r) => r.type === "secret")?.secret ?? null,
        cursor: records.findLast((r) => r.type === "cursor") ?? null,
    };
}

// `doctor` prints one JSON object and exits non-zero when a source is not ok; both are useful, so return the report either way.
export async function helperDoctor(args = [], opts = {}) {
    const helper = opts.helper ?? defaultHelperPath();
    if (opts.verify !== false) verifyChecksum(helper);
    const { stdout, exitCode } = await run(helper, ["doctor", ...args], opts);
    let report;
    try {
        report = JSON.parse(stdout.trim().split("\n").at(-1));
    } catch {
        throw new HelperError("internal", "doctor produced no report", { exitCode });
    }
    return { report, exitCode };
}

export async function helperVersion(opts = {}) {
    const helper = opts.helper ?? defaultHelperPath();
    if (opts.verify !== false) verifyChecksum(helper);
    const { stdout, exitCode } = await run(helper, ["--version"], opts);
    const m = /^(\d+)\.(\d+)\.(\d+) schema=(\d+)$/.exec(stdout.trim());
    if (exitCode !== 0 || !m) throw new HelperError("internal", "helper --version output not recognised");
    if (Number(m[4]) !== SUPPORTED_SCHEMA) throw new HelperError("schema_unsupported", `helper schema ${m[4]} is not supported (expected ${SUPPORTED_SCHEMA})`);
    return { version: `${m[1]}.${m[2]}.${m[3]}`, schema: Number(m[4]) };
}
