"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

test("suggest routes do not perform request-time snippet or history assembly", () => {
  const src = fs.readFileSync(path.join(__dirname, "../routes/suggestions.js"), "utf8");

  assert.equal(src.includes("getSnippets("), false, "suggest routes should not call knowledge snippets live");
  assert.equal(src.includes("getHistory("), false, "suggest routes should not call vector history live");
  assert.equal(src.includes("getGoldenExamples("), false, "suggest routes should not call vector golden examples live");
  assert.equal(src.includes("getLatestContextForHandles("), false, "suggest routes should not reconstruct latest context live");
});
