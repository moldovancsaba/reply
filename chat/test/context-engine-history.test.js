const test = require("node:test");
const assert = require("node:assert/strict");
const { formatChronologicalHistoryLines } = require("../context-engine.js");

test("formatChronologicalHistoryLines: orders by bracket date and appends annotation", () => {
    const docs = [
        {
            text: "[2024-01-02] Me: second",
            is_annotated: false
        },
        {
            text: "[2024-01-01] Contact: first",
            is_annotated: true,
            annotation_summary: "Booking",
            annotation_tags: JSON.stringify(["travel"]),
            annotation_facts: JSON.stringify(["Paris"])
        }
    ];
    const out = formatChronologicalHistoryLines(docs, 10);
    assert.match(out, /2024-01-01/);
    assert.match(out, /2024-01-02/);
    const idxFirst = out.indexOf("2024-01-01");
    const idxSecond = out.indexOf("2024-01-02");
    assert.ok(idxFirst < idxSecond, "chronological order");
    assert.match(out, /Summary: Booking/);
    assert.match(out, /Tags: travel/);
    assert.match(out, /Key Facts: Paris/);
});
