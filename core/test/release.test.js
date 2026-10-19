import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LINT_ARGS, runSteps, table, WARNING } from "../scripts/verify-release.js";

const coreDir = path.resolve(import.meta.dirname, "..");
const sh = (code) => [process.execPath, "-e", code];
const quiet = { log: () => {} };

test("the gate passes a clean step and fails on a non-zero exit", () => {
    const r = runSteps([{ name: "ok", cmd: sh("0") }, { name: "bad", cmd: sh("process.exit(3)") }], quiet);
    assert.deepEqual(r.map((x) => x.status), ["PASS", "FAIL"]);
    assert.equal(r[1].note, "exit 3");
});

test("a warning in the output fails the step even when the exit code is 0 (zero-warning rule)", () => {
    for (const noise of ["(node:1) DeprecationWarning: x", "(node:1) ExperimentalWarning: y", "src/a.js: warning: z", "Warning: something"]) {
        assert.match(noise, WARNING);
        const r = runSteps([{ name: "w", cmd: sh(`console.error(${JSON.stringify(noise)})`) }], quiet);
        assert.equal(r[0].status, "FAIL", noise);
        assert.equal(r[0].note, "warning in output");
    }
});

test("a failing step does not hide the next one, and skipped steps are shown", () => {
    const r = runSteps([{ name: "a", cmd: sh("process.exit(1)") }, { name: "b", cmd: sh("0") }, { name: "c", cmd: sh("0"), skip: "no Swift" }], quiet);
    assert.deepEqual(r.map((x) => x.status), ["FAIL", "PASS", "SKIP"]);
    const t = table(r);
    assert.match(t, /RELEASE GATE: FAIL \(1 failing\)/);
    assert.match(t, /c\s+SKIP/);
    assert.match(table([{ name: "a", status: "PASS", ms: 1500, note: "" }]), /RELEASE GATE: PASS/);
});

test("an injected lint warning fails the real lint command", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "rc-lint-"));
    writeFileSync(path.join(dir, "eslint.config.mjs"), 'export default [{ rules: { "no-console": "warn" } }];\n');
    writeFileSync(path.join(dir, "a.js"), "console.log(1);\n");
    const [, ...rest] = LINT_ARGS; // npx eslint . --max-warnings 0, run with the repo's own eslint
    const eslint = path.join(coreDir, "node_modules", "eslint", "bin", "eslint.js");
    const r = runSteps([{ name: "lint", cmd: [process.execPath, eslint, ...rest.slice(1)], cwd: dir }], quiet);
    assert.equal(r[0].status, "FAIL");
    // and the same project without the warning passes
    writeFileSync(path.join(dir, "a.js"), "export const x = 1;\n");
    assert.equal(runSteps([{ name: "lint", cmd: [process.execPath, eslint, ...rest.slice(1)], cwd: dir }], quiet)[0].status, "PASS");
});

test("an injected failing test fails the real test command", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "rc-failtest-"));
    writeFileSync(path.join(dir, "x.test.js"), 'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("boom", () => assert.equal(1, 2));\n');
    const r = runSteps([{ name: "tests", cmd: [process.execPath, "--throw-deprecation", "--test", "x.test.js"], cwd: dir }], quiet);
    assert.equal(r[0].status, "FAIL");
    writeFileSync(path.join(dir, "x.test.js"), 'import test from "node:test";\ntest("fine", () => {});\n');
    assert.equal(runSteps([{ name: "tests", cmd: [process.execPath, "--throw-deprecation", "--test", "x.test.js"], cwd: dir }], quiet)[0].status, "PASS");
});
