// End-to-end smoke for the release gate: the real launcher starts the real service on a free port with an empty data
// folder and a stub UI, the service answers health, status and the app shell, a second start only opens the UI, and stop
// leaves nothing running. Everything lives in a temporary HOME.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const launcher = path.resolve(import.meta.dirname, "reply-core");
const home = mkdtempSync(path.join(os.tmpdir(), "rc-smoke-home-"));
const ui = mkdtempSync(path.join(os.tmpdir(), "rc-smoke-ui-"));
writeFileSync(path.join(ui, "index.html"), "<!doctype html><title>Reply Core</title>");
const port = await new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const { port: p } = s.address(); s.close(() => resolve(p)); }); });
const env = { PATH: process.env.PATH, HOME: home, REPLY_CORE_PORT: String(port), REPLY_CORE_UI_DIR: ui, REPLY_CORE_CONNECTORS: "none", REPLY_CORE_OPEN: "true" };
const run = (...args) => spawnSync(process.execPath, [launcher, ...args], { env, encoding: "utf8", timeout: 60_000 });
const fail = (msg) => { console.error(`smoke: ${msg}`); run("stop"); process.exit(1); };

try {
    const start = run("start", "--background");
    if (start.status !== 0) fail(`start failed (${start.status}): ${start.stderr}${start.stdout}`);
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    if (health.status !== "ok") fail("health is not ok");
    const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
    if (status.storage?.state !== "ok") fail("storage is not ok");
    const page = await fetch(`http://127.0.0.1:${port}/inbox/anything`, { headers: { accept: "text/html" } });
    if (page.status !== 200 || !(await page.text()).includes("Reply Core")) fail("the app shell is not served");
    const second = run("start", "--background");
    if (second.status !== 0 || !/already running/.test(second.stdout)) fail("a second start is not idempotent");
    const stop = run("stop");
    if (stop.status !== 0) fail(`stop failed: ${stop.stderr}`);
    if (run("status").status !== 13) fail("the service is still running after stop");
    console.log("smoke: ok");
} finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(ui, { recursive: true, force: true });
}
