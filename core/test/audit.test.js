import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const audit = path.resolve(import.meta.dirname, "..", "scripts", "audit.js");
const run = (root) => spawnSync(process.execPath, [audit], { env: { ...process.env, AUDIT_ROOT: root }, encoding: "utf8" });

function repo(files) {
    const root = mkdtempSync(path.join(os.tmpdir(), "rc-audit-"));
    for (const [f, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
        writeFileSync(path.join(root, f), text);
    }
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "-A"], { cwd: root });
    return root;
}
const base = {
    "core/package.json": '{"version":"1.2.3"}', "core/ui/package.json": '{"version":"1.2.3"}',
    "core/src/storage/migrations/0001_init.sql": "select 1;", "docs/CORE_DATA_MODEL.md": "migration 0001",
    "CHANGELOG.md": "## [1.2.3] - 2026-01-01\n", "README.md": "# x\n",
};

test("the audit passes this repository", () => {
    const r = spawnSync(process.execPath, [audit], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /audit: ok/);
});

test("the audit names each kind of problem", () => {
    const root = repo({
        ...base,
        "data/contacts.db": "x", "training_data.jsonl": "x", "chat/.env": "x",
        "docs/a.md": "see [gone](missing.md) and [abs](/Users/someone/x.md)\n```\n[example](nowhere.md)\n```\n",
        "core/src/x.js": "// TODO later\n// Reply Core never sends anything\nconst k = 'AIza" + "A".repeat(35) + "';\n",
        "core/package.json2": "{}",
    });
    const r = run(root);
    assert.equal(r.status, 1);
    for (const needle of ["missing-file: LICENSE", "personal-or-secret-file-tracked: data/contacts.db", "personal-or-secret-file-tracked: training_data.jsonl", "personal-or-secret-file-tracked: chat/.env", "broken-link: docs/a.md -> missing.md", "absolute-path-link: docs/a.md", "obsolete-wording: core/src/x.js:1", "obsolete-wording: core/src/x.js:2", "secret-in-file: core/src/x.js"]) assert.ok(r.stderr.includes(needle), `${needle}\n${r.stderr}`);
    assert.ok(!r.stderr.includes("nowhere.md"), "links inside code fences are examples");
});

test("version, changelog and migrations must agree", () => {
    let r = run(repo({ ...base, "CHANGELOG.md": "## [1.2.0] - 2026-01-01\n" }));
    assert.match(r.stderr, /version: CHANGELOG's newest release is 1\.2\.0, package\.json says 1\.2\.3/);
    r = run(repo({ ...base, "core/ui/package.json": '{"version":"9.9.9"}' }));
    assert.match(r.stderr, /version: core 1\.2\.3 and ui 9\.9\.9 differ/);
    r = run(repo({ ...base, "core/src/storage/migrations/0002_more.sql": "select 2;" }));
    assert.match(r.stderr, /docs-out-of-date: docs\/CORE_DATA_MODEL\.md does not mention migration 0002/);
});
