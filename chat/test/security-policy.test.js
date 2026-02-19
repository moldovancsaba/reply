const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
    getSecurityPolicy,
    isLoopbackIp,
    isLocalRequest,
    hasValidOperatorToken,
    isHumanApproved,
} = require("../security-policy.js");

describe("security-policy", () => {
    describe("getSecurityPolicy", () => {
        it("returns defaults when env is empty", () => {
            const policy = getSecurityPolicy({});
            assert.strictEqual(policy.requireHumanApproval, true);
            assert.strictEqual(policy.localWritesOnly, true);
            assert.strictEqual(policy.requireOperatorToken, false);
            assert.strictEqual(policy.operatorToken, "");
        });

        it("reads operator token from env", () => {
            const policy = getSecurityPolicy({
                REPLY_OPERATOR_TOKEN: "test-token-123",
                REPLY_SECURITY_REQUIRE_OPERATOR_TOKEN: "true",
            });
            assert.strictEqual(policy.requireOperatorToken, true);
            assert.strictEqual(policy.operatorToken, "test-token-123");
        });

        it("auto-enables operator token when token value is set", () => {
            const policy = getSecurityPolicy({
                REPLY_OPERATOR_TOKEN: "my-token",
            });
            assert.strictEqual(policy.requireOperatorToken, true);
        });

        it("respects explicit false overrides", () => {
            const policy = getSecurityPolicy({
                REPLY_SECURITY_REQUIRE_HUMAN_APPROVAL: "false",
                REPLY_SECURITY_LOCAL_WRITES_ONLY: "false",
            });
            assert.strictEqual(policy.requireHumanApproval, false);
            assert.strictEqual(policy.localWritesOnly, false);
        });
    });

    describe("isLoopbackIp", () => {
        it("accepts IPv4 loopback", () => {
            assert.strictEqual(isLoopbackIp("127.0.0.1"), true);
            assert.strictEqual(isLoopbackIp("127.0.0.99"), true);
        });

        it("accepts IPv6 loopback", () => {
            assert.strictEqual(isLoopbackIp("::1"), true);
        });

        it("accepts IPv4-mapped IPv6 loopback", () => {
            assert.strictEqual(isLoopbackIp("::ffff:127.0.0.1"), true);
        });

        it("rejects non-loopback addresses", () => {
            assert.strictEqual(isLoopbackIp("192.168.1.1"), false);
            assert.strictEqual(isLoopbackIp("10.0.0.1"), false);
            assert.strictEqual(isLoopbackIp("8.8.8.8"), false);
        });

        it("rejects empty/null", () => {
            assert.strictEqual(isLoopbackIp(""), false);
            assert.strictEqual(isLoopbackIp(null), false);
            assert.strictEqual(isLoopbackIp(undefined), false);
        });
    });

    describe("isLocalRequest", () => {
        it("uses socket.remoteAddress, NOT x-forwarded-for", () => {
            const fakeReq = {
                headers: { "x-forwarded-for": "8.8.8.8" },
                socket: { remoteAddress: "127.0.0.1" },
            };
            // Should be true because socket is loopback, despite XFF being external
            assert.strictEqual(isLocalRequest(fakeReq), true);
        });

        it("rejects when socket is non-loopback, even if XFF says loopback", () => {
            const fakeReq = {
                headers: { "x-forwarded-for": "127.0.0.1" },
                socket: { remoteAddress: "192.168.1.50" },
            };
            assert.strictEqual(isLocalRequest(fakeReq), false);
        });
    });

    describe("hasValidOperatorToken", () => {
        it("returns true when token enforcement is off", () => {
            const req = { headers: {} };
            const policy = { requireOperatorToken: false };
            assert.strictEqual(hasValidOperatorToken(req, policy), true);
        });

        it("returns false when token is required but missing", () => {
            const req = { headers: {} };
            const policy = { requireOperatorToken: true, operatorToken: "secret" };
            assert.strictEqual(hasValidOperatorToken(req, policy), false);
        });

        it("validates correct token", () => {
            const req = { headers: { "x-reply-operator-token": "secret" } };
            const policy = { requireOperatorToken: true, operatorToken: "secret" };
            assert.strictEqual(hasValidOperatorToken(req, policy), true);
        });

        it("rejects wrong token", () => {
            const req = { headers: { "x-reply-operator-token": "wrong" } };
            const policy = { requireOperatorToken: true, operatorToken: "secret" };
            assert.strictEqual(hasValidOperatorToken(req, policy), false);
        });

        it("rejects length-mismatch tokens (timing-safe)", () => {
            const req = { headers: { "x-reply-operator-token": "sh" } };
            const policy = { requireOperatorToken: true, operatorToken: "secret" };
            assert.strictEqual(hasValidOperatorToken(req, policy), false);
        });

        it("accepts operator token from cookie when header is missing", () => {
            const req = { headers: { cookie: "reply_operator_token=secret; foo=bar" } };
            const policy = { requireOperatorToken: true, operatorToken: "secret" };
            assert.strictEqual(hasValidOperatorToken(req, policy), true);
        });

        it("accepts encoded operator token from cookie", () => {
            const req = { headers: { cookie: "reply_operator_token=s%40cret" } };
            const policy = { requireOperatorToken: true, operatorToken: "s@cret" };
            assert.strictEqual(hasValidOperatorToken(req, policy), true);
        });
    });

    describe("isHumanApproved", () => {
        it("accepts header confirmation", () => {
            const req = { headers: { "x-reply-human-approval": "confirmed" } };
            assert.strictEqual(isHumanApproved(req, {}), true);
        });

        it("accepts payload approval object", () => {
            const req = { headers: {} };
            assert.strictEqual(isHumanApproved(req, { approval: { confirmed: true } }), true);
            assert.strictEqual(isHumanApproved(req, { approval: { status: "approved" } }), true);
        });

        it("accepts humanApproved flag", () => {
            const req = { headers: {} };
            assert.strictEqual(isHumanApproved(req, { humanApproved: true }), true);
        });

        it("rejects when no approval signal", () => {
            const req = { headers: {} };
            assert.strictEqual(isHumanApproved(req, {}), false);
            assert.strictEqual(isHumanApproved(req, null), false);
        });
    });
});
