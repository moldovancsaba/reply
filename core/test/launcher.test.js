import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRotatingStream } from "../src/logfile.js";
import { EXIT, FDA_STEPS_APP, firstPath, isOurPlist, launcherPaths, nodeOk, parsePidfile, plistFor, readPidfile, statusLines } from "../src/launcher/lib.js";

const launcher = path.resolve(import.meta.dirname, "..", "scripts", "reply-core");
const golden = path.resolve(import.meta.dirname, "fixtures", "launchd.golden.plist");

test("nodeOk: the minimum is 20.17.0", () => {
    for (const [v, ok] of [["20.17.0", true], ["20.17.1", true], ["v22.1.0", true], ["24.0.0", true], ["20.16.9", false], ["18.20.0", false], ["20.9", false], ["garbage", false], ["", false]]) assert.equal(nodeOk(v), ok, v);
});

test("pidfile parsing: valid, damaged and stale", () => {
    assert.deepEqual(parsePidfile('{"pid":42,"startedAt":"2026-10-19T08:00:00.000Z","port":45511}'), { pid: 42, startedAt: "2026-10-19T08:00:00.000Z", port: 45511 });
    for (const bad of ["", "{", "[]", '{"pid":"x"}', '{"pid":0}', '{"pid":-3}']) assert.equal(parsePidfile(bad), null, bad);
    const home = mkdtempSync(path.join(os.tmpdir(), "rc-pid-"));
    writeFileSync(path.join(home, "reply-core.pid"), JSON.stringify({ pid: process.pid, port: 1 }));
    assert.equal(readPidfile(home).pid, process.pid);
    writeFileSync(path.join(home, "reply-core.pid"), JSON.stringify({ pid: 2 ** 22 - 1, port: 1 })); // no such process
    assert.equal(readPidfile(home), null, "a stale pidfile counts as no pidfile");
    assert.equal(readPidfile(path.join(home, "missing")), null);
});

test("plist: golden file, KeepAlive with a 30 s throttle, background process, no secrets", () => {
    const text = plistFor({ node: "/opt/node/bin/node", entry: "/r/core/src/index.js", workingDirectory: "/r/core", launchdLog: "/h/Library/Logs/reply-core/launchd.log", env: { REPLY_CORE_LOG_FILE: "/h/Library/Logs/reply-core/service.log", REPLY_CORE_PORT: "45511" } });
    assert.equal(text, readFileSync(golden, "utf8"));
    assert.match(text, /<key>KeepAlive<\/key>\s*<true\/>/);
    assert.match(text, /<key>ThrottleInterval<\/key>\s*<integer>30<\/integer>/);
    assert.match(text, /<key>ProcessType<\/key>\s*<string>Background<\/string>/);
    assert.ok(isOurPlist(text));
    assert.equal(isOurPlist("<plist><string>com.moldovancsaba.reply-core</string></plist>"), false, "needs our marker too");
    assert.doesNotMatch(text, /password|secret|token/i);
    assert.match(plistFor({ node: "/a&b/<n>", entry: "e", workingDirectory: "w", launchdLog: "l" }), /\/a&amp;b\/&lt;n&gt;/);
});

test("firstPath and the status table", () => {
    assert.equal(firstPath({ overall: "ok" }), "/inbox");
    assert.equal(firstPath({ overall: "blocked" }), "/sources");
    assert.equal(firstPath({ overall: "degraded" }), "/sources");
    assert.equal(firstPath(null), "/sources");
    const lines = statusLines({ overall: "blocked", storage: { state: "ok" }, helper: { state: "ok" }, connectors: [{ label: "iMessage", state: "blocked", message: "Needs Full Disk Access", messagesTotal: 0 }, { label: "Contacts", state: "ok", message: "", messagesTotal: 12 }], backups: { count: 2, lastBackupAt: "2026-10-19" } }, { url: "http://127.0.0.1:1", pid: 7 });
    assert.match(lines[0], /running at http:\/\/127\.0\.0\.1:1 \(pid 7\)/);
    assert.ok(lines.some((l) => /iMessage\s+blocked\s+Needs Full Disk Access/.test(l)));
    assert.ok(lines.some((l) => /Contacts\s+ok\s+12 messages/.test(l)));
});

test("rotating log: bounded, newest first, oldest dropped, survives a missing directory", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "rc-log-"));
    const file = path.join(dir, "deep", "service.log");
    const log = createRotatingStream({ file, maxBytes: 1024, keep: 3 });
    for (let i = 0; i < 200; i++) log.write(`${"x".repeat(60)} line ${i}\n`);
    log.end();
    const files = readdirSync(path.dirname(file)).sort();
    assert.deepEqual(files, ["service.log", "service.log.1", "service.log.2"], "keep=3 means the live file plus two rotated ones");
    for (const f of files) assert.ok(statSync(path.join(path.dirname(file), f)).size <= 1024 + 80, `${f} stays near the limit`);
    assert.match(readFileSync(file, "utf8"), /line 199\n$/);
    assert.doesNotMatch(readFileSync(path.join(path.dirname(file), "service.log.2"), "utf8"), /line 0\n/, "the oldest lines are gone");
    assert.equal(statSync(file).mode & 0o777, 0o600);
});

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const run = (args, env, opts = {}) => spawnSync(process.execPath, [launcher, ...args], { env, encoding: "utf8", timeout: 60_000, ...opts });
const runAsync = (args, env) => new Promise((resolve) => { const c = spawn(process.execPath, [launcher, ...args], { env, stdio: ["ignore", "pipe", "pipe"] }); let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d)); c.on("exit", (code) => resolve({ code, out, child: c })); });

async function sandbox() {
    const home = mkdtempSync(path.join(os.tmpdir(), "rc-home-"));
    const ui = mkdtempSync(path.join(os.tmpdir(), "rc-ui-"));
    writeFileSync(path.join(ui, "index.html"), "<!doctype html><title>t</title>");
    const bin = mkdtempSync(path.join(os.tmpdir(), "rc-bin-"));
    const opened = path.join(bin, "opened.txt");
    const launchctlLog = path.join(bin, "launchctl.txt");
    writeFileSync(path.join(bin, "open"), `#!/bin/sh\necho "$@" >> "${opened}"\n`); chmodSync(path.join(bin, "open"), 0o755);
    writeFileSync(path.join(bin, "launchctl"), `#!/bin/sh\necho "$@" >> "${launchctlLog}"\n`); chmodSync(path.join(bin, "launchctl"), 0o755);
    const port = await freePort();
    const env = { PATH: process.env.PATH, HOME: home, REPLY_CORE_NO_APP: "1", REPLY_CORE_PORT: String(port), REPLY_CORE_UI_DIR: ui, REPLY_CORE_CONNECTORS: "none", REPLY_CORE_OPEN: path.join(bin, "open"), REPLY_CORE_LAUNCHCTL: path.join(bin, "launchctl") };
    const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
    return { home, port, env, opened: () => read(opened), launchctl: () => read(launchctlLog), paths: launcherPaths({ home, env }) };
}

test("start --background, status, a second start only opens the UI, stop; logs are written to the rotating file", async () => {
    const s = await sandbox();
    const first = run(["start", "--background"], s.env);
    assert.equal(first.status, 0, first.stderr + first.stdout);
    assert.match(first.stdout, new RegExp(`Reply Core is running at http://127\\.0\\.0\\.1:${s.port}/ \\(pid \\d+\\)`));
    assert.match(s.opened(), new RegExp(`^-a Safari http://127\\.0\\.0\\.1:${s.port}/(inbox|sources)`), "opens Safari by default");
    const pid = readPidfile(s.paths.dataHome).pid;

    const st = run(["status"], s.env);
    assert.match(st.stdout, /Reply Core is running/);
    assert.match(st.stdout, new RegExp(`pid ${pid}`));

    const before = s.opened().split("\n").filter(Boolean).length;
    const second = run(["start", "--background"], s.env);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /already running/);
    assert.equal(readPidfile(s.paths.dataHome).pid, pid, "no second process");
    assert.equal(s.opened().split("\n").filter(Boolean).length, before + 1, "the second run only opened the UI");

    assert.match(readFileSync(s.paths.logFile, "utf8"), /"msg":/, "the service logs to the file the launcher chose");

    const stop = run(["stop"], s.env);
    assert.equal(stop.status, 0, stop.stderr);
    assert.match(stop.stdout, /stopped/);
    assert.equal(readPidfile(s.paths.dataHome), null);
    const again = run(["stop"], s.env);
    assert.equal(again.status, EXIT.notRunning);
    assert.match(again.stderr, /not running/);
    const stat2 = run(["status"], s.env);
    assert.equal(stat2.status, EXIT.notRunning);
});

test("a stale pidfile does not block a start", async () => {
    const s = await sandbox();
    mkdirSync(s.paths.dataHome, { recursive: true });
    writeFileSync(path.join(s.paths.dataHome, "reply-core.pid"), JSON.stringify({ pid: 2 ** 22 - 1, port: s.port }));
    const r = run(["start", "--background", "--no-open"], s.env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(s.opened(), "", "--no-open opens nothing");
    run(["stop"], s.env);
});

test("a port used by another program is explained and keeps the service's exit code", async () => {
    const s = await sandbox();
    const blocker = net.createServer().listen(s.port, "127.0.0.1");
    await new Promise((r) => blocker.on("listening", r));
    try {
        const r = await runAsync(["start", "--background", "--no-open"], s.env);
        assert.equal(r.code, 75);
        assert.match(r.out, /port \d+ is used by another program/);
    } finally { blocker.close(); }
});

test("an old Node is refused with exit 10 and the next step", () => {
    const shim = mkdtempSync(path.join(os.tmpdir(), "rc-shim-"));
    const wrapper = path.join(shim, "old.mjs");
    writeFileSync(wrapper, `Object.defineProperty(process.versions, "node", { value: "18.0.0" });\nprocess.argv.splice(1, 1, ${JSON.stringify(launcher)});\nawait import(${JSON.stringify(launcher)});\n`);
    const r = spawnSync(process.execPath, [wrapper, "start"], { env: { PATH: process.env.PATH, HOME: shim }, encoding: "utf8" });
    assert.equal(r.status, EXIT.nodeTooOld);
    assert.match(r.stderr, /needs Node 20\.17 or newer; this is 18\.0\.0/);
});

test("install-agent and uninstall-agent (launchctl stubbed): idempotent, only our own file, Full Disk Access steps for the real node", async () => {
    const s = await sandbox();
    const i1 = run(["install-agent"], s.env);
    assert.equal(i1.status, 0, i1.stderr);
    const text = readFileSync(s.paths.plist, "utf8");
    assert.ok(isOurPlist(text));
    assert.match(text, new RegExp(`<string>${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</string>|<string>${path.dirname(process.execPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(text, /<key>KeepAlive<\/key>\s*<true\/>/);
    assert.doesNotMatch(text, /password|secret|token/i);
    assert.match(i1.stdout, /Full Disk Access/);
    assert.match(i1.stdout, /Command\+Shift\+G/);
    assert.match(i1.stdout, /Node upgrade/);
    assert.match(s.launchctl(), /bootstrap gui\/\d+ .*com\.moldovancsaba\.reply-core\.plist/);
    assert.equal(statSync(s.paths.plist).mode & 0o777, 0o644);

    const i2 = run(["install-agent"], s.env);
    assert.match(i2.stdout, /already installed/);
    assert.equal(readFileSync(s.paths.plist, "utf8"), text);

    const u = run(["uninstall-agent"], s.env);
    assert.equal(u.status, 0);
    assert.equal(existsSync(s.paths.plist), false);
    assert.match(s.launchctl(), /bootout gui\/\d+\/com\.moldovancsaba\.reply-core/);
    assert.match(run(["uninstall-agent"], s.env).stdout, /not installed/);

    // a plist that is not ours is left alone
    mkdirSync(s.paths.agentsDir, { recursive: true });
    writeFileSync(s.paths.plist, "<plist><string>com.moldovancsaba.reply-core</string></plist>");
    const refuse = run(["uninstall-agent"], s.env);
    assert.equal(refuse.status, 1);
    assert.ok(existsSync(s.paths.plist));
    assert.equal(run(["install-agent"], s.env).status, 1);
});

test("no secrets in the plist or in the first log lines even when secrets are in the environment", async () => {
    const s = await sandbox();
    const env = { ...s.env, GITHUB_TOKEN: "ghp_SECRETSECRETSECRET", REPLY_CORE_IMAP_PASSWORD: "hunter2hunter2" };
    run(["install-agent"], env);
    run(["start", "--background", "--no-open"], env);
    try {
        for (const f of [s.paths.plist, s.paths.logFile, s.paths.startupLog]) if (existsSync(f)) assert.doesNotMatch(readFileSync(f, "utf8"), /SECRETSECRET|hunter2/, f);
    } finally { run(["stop"], env); }
});

test("foreground start stays attached, opens the UI, and Control+C stops the service cleanly", async () => {
    const s = await sandbox();
    const c = spawn(process.execPath, [launcher, "start"], { env: s.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    const deadline = Date.now() + 20_000;
    while (!/Press Control\+C/.test(out) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /Reply Core is running at/);
    assert.match(s.opened(), /127\.0\.0\.1/);
    const pid = readPidfile(s.paths.dataHome)?.pid;
    assert.ok(pid, "the service holds its pidfile while attached");
    c.kill("SIGINT");
    const code = await new Promise((r) => c.on("exit", r));
    assert.equal(code, 0);
    assert.equal(readPidfile(s.paths.dataHome), null, "the pidfile is removed on a clean stop");
});

test("the agent can run the signed {reply}.app host instead of node, and the steps name {reply}", () => {
    const text = plistFor({ node: "/n", entry: "/e", program: ["/Users/x/Applications/{reply}.app/Contents/MacOS/reply", "--service"], workingDirectory: "/w", launchdLog: "/l" });
    assert.match(text, /<string>\/Users\/x\/Applications\/\{reply\}\.app\/Contents\/MacOS\/reply<\/string>\s*<string>--service<\/string>/);
    assert.doesNotMatch(text, /<string>\/n<\/string>/);
    assert.ok(FDA_STEPS_APP("/Users/x/Applications").join("\n").includes("{reply}"));
    assert.equal(launcherPaths({ home: "/h" }).appExe, "/h/Applications/{reply}.app/Contents/MacOS/reply");
});
