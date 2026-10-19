import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ConfigError, defaultHome, loadConfig } from "../src/config.js";

test("defaults", () => {
    const c = loadConfig({});
    assert.equal(c.port, 45511);
    assert.equal(c.logLevel, "info");
    assert.deepEqual(c.allowedOrigins, []);
    assert.equal(c.home, defaultHome());
});

test("overrides", () => {
    const c = loadConfig({
        REPLY_CORE_PORT: "50000",
        REPLY_CORE_LOG_LEVEL: "DEBUG",
        REPLY_CORE_HOME: "relative/home",
        REPLY_CORE_ALLOWED_ORIGINS: "http://127.0.0.1:5173, http://localhost:5173",
    });
    assert.equal(c.port, 50000);
    assert.equal(c.logLevel, "debug");
    assert.equal(c.home, path.resolve("relative/home"));
    assert.deepEqual(c.allowedOrigins, ["http://127.0.0.1:5173", "http://localhost:5173"]);
});

for (const port of ["abc", "80", "1023", "65536", "1.5", "-1"]) {
    test(`invalid port ${port}`, () => {
        assert.throws(() => loadConfig({ REPLY_CORE_PORT: port }), (e) => e instanceof ConfigError && /REPLY_CORE_PORT must be 1024-65535/.test(e.message));
    });
}

test("invalid log level", () => {
    assert.throws(() => loadConfig({ REPLY_CORE_LOG_LEVEL: "loud" }), /REPLY_CORE_LOG_LEVEL/);
});

for (const origin of ["not a url", "ftp://x.example", "http://x.example/path", "http://x.example/"]) {
    test(`invalid origin ${origin}`, () => {
        assert.throws(() => loadConfig({ REPLY_CORE_ALLOWED_ORIGINS: origin }), /REPLY_CORE_ALLOWED_ORIGINS/);
    });
}

test("unknown REPLY_CORE_ keys are reported, others ignored", () => {
    const c = loadConfig({ REPLY_CORE_TYPO: "1", PATH: "/bin" });
    assert.deepEqual(c.unknownKeys, ["REPLY_CORE_TYPO"]);
});
