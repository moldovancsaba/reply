const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

const qmod = require("../suggestion-draft-queue.js");
const QUEUE_PATH = qmod.QUEUE_PATH;

test("vectorDocLooksInboundFromContact", () => {
  assert.equal(
    qmod.vectorDocLooksInboundFromContact("[2026-01-01] Me: hello"),
    false
  );
  assert.equal(
    qmod.vectorDocLooksInboundFromContact("[2026-01-01] alice@ex.com: Subject: hi"),
    true
  );
});

test("extractHandleFromVectorPath", () => {
  assert.equal(qmod.extractHandleFromVectorPath("whatsapp://36201234567"), "36201234567");
  assert.equal(qmod.extractHandleFromVectorPath("mailto:Bob@Ex.COM"), "Bob@Ex.COM");
});

test("enqueueSuggestionDraft moves handle to front (newest first)", () => {
  const prev = fs.existsSync(QUEUE_PATH) ? fs.readFileSync(QUEUE_PATH, "utf8") : null;
  try {
    if (fs.existsSync(QUEUE_PATH)) fs.unlinkSync(QUEUE_PATH);
    delete require.cache[require.resolve("../suggestion-draft-queue.js")];
    const q = require("../suggestion-draft-queue.js");
    q.enqueueSuggestionDraft("h1");
    q.enqueueSuggestionDraft("h2");
    q.enqueueSuggestionDraft("h1");
    const items = q.readQueue().items.map((x) => x.handle);
    assert.deepEqual(items, ["h1", "h2"]);
  } finally {
    try {
      if (prev) fs.writeFileSync(QUEUE_PATH, prev, "utf8");
      else if (fs.existsSync(QUEUE_PATH)) fs.unlinkSync(QUEUE_PATH);
    } catch {
      /* ignore */
    }
    delete require.cache[require.resolve("../suggestion-draft-queue.js")];
  }
});
