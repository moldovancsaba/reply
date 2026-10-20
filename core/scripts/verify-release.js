// The release gate: everything that must be true before a build is handed to someone, in one command.
//   npm run verify:release
// Runs every step (a failure does not hide the next one), prints a pass/fail table, and exits non-zero on any failure or
// any warning in any step's output (the zero-warning rule). Unlike `npm run verify`, a missing UI install is a failure.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const WARNING = /\b(Deprecation|Experimental)?Warning\b|\bwarning:/;
export const LINT_ARGS = ["npx", "eslint", ".", "--max-warnings", "0"];

export function runSteps(steps, { log = console.log } = {}) {
    const results = [];
    for (const step of steps) {
        if (step.skip) { results.push({ name: step.name, status: "SKIP", note: step.skip, ms: 0 }); continue; }
        const [cmd, ...args] = step.cmd;
        const t0 = Date.now();
        const env = { ...process.env, ...step.env };
        delete env.NODE_TEST_CONTEXT; // a nested `node --test` must not think it is a child of ours
        const r = spawnSync(cmd, args, { encoding: "utf8", cwd: step.cwd, env });
        const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
        if (step.offlineOk && r.status !== 0 && /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|audit endpoint returned an error/i.test(out)) {
            results.push({ name: step.name, status: "SKIP", note: "no network", ms: Date.now() - t0 });
            continue;
        }
        const warned = WARNING.test(out);
        const ok = r.status === 0 && !warned;
        if (!ok) log(out.split("\n").slice(-40).join("\n"));
        results.push({ name: step.name, status: ok ? "PASS" : "FAIL", note: ok ? "" : warned ? "warning in output" : `exit ${r.status ?? r.signal ?? "?"}`, ms: Date.now() - t0 });
    }
    return results;
}

export function table(results) {
    const w = Math.max(...results.map((r) => r.name.length));
    const rows = results.map((r) => `${r.name.padEnd(w)}  ${r.status.padEnd(4)}  ${String(Math.round(r.ms / 1000)).padStart(4)} s  ${r.note}`);
    const failed = results.filter((r) => r.status === "FAIL").length;
    return [...rows, "", failed === 0 ? "RELEASE GATE: PASS" : `RELEASE GATE: FAIL (${failed} failing)`].join("\n");
}

export function releaseSteps(coreDir) {
    const tests = readdirSync(path.join(coreDir, "test")).filter((f) => f.endsWith(".test.js")).map((f) => `test/${f}`);
    const hasSwift = spawnSync("swift", ["--version"]).status === 0;
    const hasUi = existsSync(path.join(coreDir, "ui", "node_modules"));
    return [
        { name: "lint (no warnings)", cmd: LINT_ARGS, cwd: coreDir },
        { name: "helper build", cmd: ["bash", "helper/build.sh"], cwd: coreDir, skip: hasSwift ? null : "Swift toolchain not installed" },
        { name: "helper tests", cmd: ["swift", "test", "--package-path", "helper"], cwd: coreDir, skip: hasSwift ? null : "Swift toolchain not installed" },
        { name: "unit + integration tests", cmd: [process.execPath, "--throw-deprecation", "--test", ...tests], cwd: coreDir },
        { name: "repository and documentation audit", cmd: [process.execPath, "scripts/audit.js"], cwd: coreDir },
        { name: "end-to-end smoke (launcher)", cmd: [process.execPath, "scripts/release-smoke.js"], cwd: coreDir },
        { name: "dependency audit (core)", cmd: ["npm", "audit", "--omit=dev", "--audit-level=high"], cwd: coreDir, offlineOk: true },
        hasUi
            ? { name: "UI: lint, tests, build, a11y", cmd: ["npm", "--prefix", "ui", "run", "verify"], cwd: coreDir }
            : { name: "UI: lint, tests, build, a11y", cmd: [process.execPath, "-e", "console.error('core/ui dependencies are not installed (see core/ui/README.md)'); process.exit(1)"], cwd: coreDir },
    ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const results = runSteps(releaseSteps(path.resolve(import.meta.dirname, "..")));
    console.log(`\n${table(results)}`);
    process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
}
