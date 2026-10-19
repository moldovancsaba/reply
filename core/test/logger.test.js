import test from "node:test";
import assert from "node:assert/strict";
import { memoryLogger } from "./helpers.js";

test("message text and personal identifiers are redacted", () => {
    const { logger, lines } = memoryLogger();
    logger.info({
        text: "secret words",
        handle: "+36301234567",
        nested: { email: "a@example.com", deeper: { phone: "+1555" } },
        list: [{ body: "hello" }],
        req: { headers: { authorization: "Bearer x", cookie: "c=1" } },
        counts: 3,
    }, "event");
    const out = lines.join("");
    for (const secret of ["secret words", "+36301234567", "a@example.com", "+1555", "Bearer x", "c=1"]) {
        assert.ok(!out.includes(secret), `leaked ${secret}`);
    }
    assert.ok(out.includes('"counts":3'));
});
