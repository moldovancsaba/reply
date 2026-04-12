"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { normalizeAnnotationFromOllama } = require("../annotation-agent.js");

test("normalizeAnnotationFromOllama coerces tags summary facts", () => {
    assert.deepEqual(
        normalizeAnnotationFromOllama({ tags: ["a", 1], summary: "s", facts: ["f"] }),
        { tags: ["a", "1"], summary: "s", facts: ["f"] }
    );
});

test("normalizeAnnotationFromOllama tolerates garbage input", () => {
    assert.deepEqual(normalizeAnnotationFromOllama(null), { tags: [], summary: "", facts: [] });
    assert.deepEqual(normalizeAnnotationFromOllama({}), { tags: [], summary: "", facts: [] });
    assert.deepEqual(
        normalizeAnnotationFromOllama({ tags: "not-array", summary: 3, facts: null }),
        { tags: [], summary: "", facts: [] }
    );
});
