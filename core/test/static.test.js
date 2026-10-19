import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { request, startServer } from "./helpers.js";

function fakeUi() {
    const dir = mkdtempSync(path.join(os.tmpdir(), "rc-ui-"));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Reply Core</title><div id=root></div>");
    writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log('app')");
    writeFileSync(path.join(dir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
    return dir;
}

async function serve(t, uiDir = fakeUi()) {
    const { app, port } = await startServer({ deps: { uiDir } });
    t.after(() => app.close());
    const get = (p, headers = {}) => request(port, { path: p, headers: { host: `127.0.0.1:${port}`, accept: "text/html", ...headers } });
    return { get, port };
}

test("the app page is served with a strict CSP and revalidation", async (t) => {
    const { get } = await serve(t);
    const r = await get("/");
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /text\/html/);
    assert.equal(r.headers["cache-control"], "no-cache");
    const csp = r.headers["content-security-policy"];
    for (const d of ["default-src 'self'", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'"]) assert.ok(csp.includes(d), d);
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), "no inline scripts");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(r.headers["referrer-policy"], "no-referrer");
});

test("hashed assets are immutable; other files are served too", async (t) => {
    const { get } = await serve(t);
    const a = await get("/assets/app-abc123.js", { accept: "*/*" });
    assert.equal(a.status, 200);
    assert.equal(a.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.equal((await get("/favicon.svg", { accept: "*/*" })).status, 200);
});

test("client routes get the app; unknown API paths and non-page requests stay JSON 404s", async (t) => {
    const { get } = await serve(t);
    const page = await get("/inbox/abc123");
    assert.equal(page.status, 200);
    assert.match(page.text, /id=root/);
    assert.ok(page.headers["content-security-policy"]);
    assert.equal((await get("/search?q=x")).status, 200);
    const api = await get("/api/nope");
    assert.deepEqual([api.status, api.json.error.code], [404, "not_found"]);
    assert.equal(api.headers["cache-control"], "no-store");
    const asset404 = await get("/assets/missing.js", { accept: "*/*" });
    assert.deepEqual([asset404.status, asset404.json.error.code], [404, "not_found"]);
});

test("path traversal never leaves the UI folder", async (t) => {
    const { get } = await serve(t);
    for (const p of ["/../package.json", "/%2e%2e/package.json", "/assets/../../package.json", "/..%2f..%2fetc/passwd"]) {
        const r = await get(p, { accept: "*/*" });
        assert.ok([400, 403, 404].includes(r.status) || (r.status === 200 && r.text.includes("id=root")), `${p} -> ${r.status}`);
        assert.ok(!r.text.includes('"name"') && !r.text.includes("root:"), p);
        if (r.status === 403) assert.equal(r.json.error.code, "forbidden");
    }
});

test("the host guard still applies to the UI", async (t) => {
    const { port } = await serve(t);
    const r = await request(port, { path: "/", headers: { host: "evil.example", accept: "text/html" } });
    assert.deepEqual([r.status, r.json.error.code], [403, "forbidden_host"]);
});

test("without a built UI the service only answers the API", async (t) => {
    const { get } = await serve(t, path.join(os.tmpdir(), "no-such-ui-dir"));
    const r = await get("/");
    assert.deepEqual([r.status, r.json.error.code], [404, "not_found"]);
    assert.equal((await get("/api/health")).status, 200);
});
