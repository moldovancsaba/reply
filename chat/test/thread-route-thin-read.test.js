"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

test("thread route does not perform request-time vector history or lid expansion", () => {
  const src = fs.readFileSync(path.join(__dirname, "../routes/messaging.js"), "utf8");
  const serveThreadStart = src.indexOf("async function serveThread");
  const serveThreadEnd = src.indexOf("async function serveSuggest", serveThreadStart);
  const body = serveThreadStart >= 0 && serveThreadEnd > serveThreadStart
    ? src.slice(serveThreadStart, serveThreadEnd)
    : src;

  assert.equal(body.includes("getHistory("), false, "serveThread should not call vector-store getHistory");
  assert.equal(body.includes("lidsForPhones("), false, "serveThread should not expand WhatsApp lids at request time");
});
