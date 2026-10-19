// Single local gate: lint (no warnings) + tests. Fails on any non-zero exit or any Node warning in the output.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const testFiles = readdirSync("test").filter((f) => f.endsWith(".test.js")).map((f) => `test/${f}`);

const hasSwift = spawnSync("swift", ["--version"]).status === 0;
const steps = [
    ["lint", ["npx", "eslint", ".", "--max-warnings", "0"]],
    ...(hasSwift
        ? [["helper-build", ["bash", "helper/build.sh"]], ["helper-test", ["swift", "test", "--package-path", "helper"]]]
        : []),
    ["test", [process.execPath, "--throw-deprecation", "--test", ...testFiles]],
];

let failed = false;
for (const [name, [cmd, ...args]] of steps) {
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    process.stdout.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
    const warned = /\b(Deprecation|Experimental)?Warning\b|\bwarning:/.test(`${r.stdout}${r.stderr}`);
    if (r.status !== 0 || warned) {
        console.error(`verify: ${name} FAILED${warned ? " (warning in output)" : ""}`);
        failed = true;
        break;
    }
    console.log(`verify: ${name} ok`);
}
process.exit(failed ? 1 : 0);
