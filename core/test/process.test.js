import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, statSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const entry = new URL("../src/index.js", import.meta.url).pathname;

function freePort() {
    return new Promise((resolve) => {
        const s = net.createServer().listen(0, "127.0.0.1", () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });
}

function run(env) {
    const child = spawn(process.execPath, [entry], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
    return { child, exited, output: () => ({ out, err }) };
}

async function waitFor(fn, ms = 5000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await fn()) return true;
        await new Promise((r) => setTimeout(r, 50));
    }
    return false;
}

test("invalid port exits 78 with a one-line message naming the setting", async () => {
    const p = run({ REPLY_CORE_PORT: "80", REPLY_CORE_HOME: mkdtempSync(path.join(os.tmpdir(), "rc-")) });
    const { code } = await p.exited;
    assert.equal(code, 78);
    assert.equal(p.output().err.trim(), "reply-core: invalid configuration: REPLY_CORE_PORT must be 1024-65535");
});

test("starts, serves health, creates a 0700 home, exits 0 on SIGTERM; a second start exits 75", async () => {
    const home = path.join(mkdtempSync(path.join(os.tmpdir(), "rc-")), "home");
    const port = await freePort();
    const env = { REPLY_CORE_PORT: String(port), REPLY_CORE_HOME: home, REPLY_CORE_LOG_LEVEL: "error" };
    const first = run(env);
    try {
        const up = await waitFor(async () => {
            try {
                return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
            } catch {
                return false;
            }
        });
        assert.ok(up, `service did not start: ${first.output().err}`);
        assert.equal(statSync(home).mode & 0o777, 0o700);
        assert.match(first.output().out, /reply-core listening on http:\/\/127\.0\.0\.1:\d+/);

        const second = run(env);
        assert.equal((await second.exited).code, 75);
        assert.match(second.output().err, /port \d+ is already in use/);

        const started = Date.now();
        first.child.kill("SIGTERM");
        const { code } = await first.exited;
        assert.equal(code, 0);
        assert.ok(Date.now() - started < 5000);
    } finally {
        first.child.kill("SIGKILL");
        rmSync(path.dirname(home), { recursive: true, force: true });
    }
});
