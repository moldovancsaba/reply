const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { createRateLimiter } = require("../rate-limiter.js");

describe("rate-limiter", () => {
    it("allows requests within limit", () => {
        const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 3 });
        assert.strictEqual(limiter.isAllowed("1.2.3.4"), true);
        assert.strictEqual(limiter.isAllowed("1.2.3.4"), true);
        assert.strictEqual(limiter.isAllowed("1.2.3.4"), true);
    });

    it("blocks requests exceeding limit", () => {
        const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
        assert.strictEqual(limiter.isAllowed("1.2.3.4"), true);
        assert.strictEqual(limiter.isAllowed("1.2.3.4"), true);
        assert.strictEqual(limiter.isAllowed("1.2.3.4"), false);
    });

    it("tracks IPs independently", () => {
        const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
        assert.strictEqual(limiter.isAllowed("1.1.1.1"), true);
        assert.strictEqual(limiter.isAllowed("2.2.2.2"), true);
        assert.strictEqual(limiter.isAllowed("1.1.1.1"), false);
        assert.strictEqual(limiter.isAllowed("2.2.2.2"), false);
    });

    it("reports correct remaining count", () => {
        const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 3 });
        limiter.isAllowed("5.5.5.5");
        const status = limiter.getStatus("5.5.5.5");
        assert.strictEqual(status.remaining, 2);
        assert.ok(status.resetMs > 0);
    });

    it("returns full quota for unknown IP", () => {
        const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 10 });
        const status = limiter.getStatus("unknown-ip");
        assert.strictEqual(status.remaining, 10);
    });

    it("resets counters", () => {
        const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
        limiter.isAllowed("9.9.9.9");
        assert.strictEqual(limiter.isAllowed("9.9.9.9"), false);
        limiter.reset();
        assert.strictEqual(limiter.isAllowed("9.9.9.9"), true);
    });
});
