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

test("processOneSuggestionDraft skips hidden contacts", async () => {
  const prev = fs.existsSync(QUEUE_PATH) ? fs.readFileSync(QUEUE_PATH, "utf8") : null;
  try {
    if (fs.existsSync(QUEUE_PATH)) fs.unlinkSync(QUEUE_PATH);
    delete require.cache[require.resolve("../suggestion-draft-queue.js")];
    const q = require("../suggestion-draft-queue.js");
    q.writeQueue([{ handle: "hidden-contact", queuedAt: new Date().toISOString() }]);
    const result = await q.processOneSuggestionDraft({
      contactStore: {
        findContact: () => ({ handle: "hidden-contact", status: "open", draft: "" }),
        isVisibleInInbox: () => false,
      },
      generateReply: async () => {
        throw new Error("should not generate");
      },
      getSnippets: async () => [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no_contact_or_closed");
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

test("processOneSuggestionDraft reuses fresh Trinity prepared draft when available", async () => {
  const prev = fs.existsSync(QUEUE_PATH) ? fs.readFileSync(QUEUE_PATH, "utf8") : null;
  try {
    if (fs.existsSync(QUEUE_PATH)) fs.unlinkSync(QUEUE_PATH);
    delete require.cache[require.resolve("../suggestion-draft-queue.js")];
    const q = require("../suggestion-draft-queue.js");
    q.writeQueue([{ handle: "alice@example.com", queuedAt: new Date().toISOString() }]);

    let persistedDraft = null;
    const result = await q.processOneSuggestionDraft({
      contactStore: {
        findContact: () => ({ handle: "alice@example.com", status: "open", draft: "" }),
        isVisibleInInbox: () => true,
        setDraft: async (_handle, text) => {
          persistedDraft = text;
        },
      },
      buildThreadSnapshot: async () => ({
        company_id: "company-1",
        thread_ref: "reply:email:alice@example.com",
      }),
      getPreparedDraft: async () => ({
        status: "ok",
        stale: false,
        prepared_draft_set: {
          ranked_draft_set: {
            drafts: [{ draft_text: "Prepared Trinity draft." }],
          },
        },
      }),
      generateReply: async () => {
        throw new Error("should not generate");
      },
      getPreparedDraftContext: async () => ({
        message: "Latest inbound",
        snippets: [],
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, "prepared_draft_ready");
    assert.equal(persistedDraft, "Prepared Trinity draft.");
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

test("processOneSuggestionDraft generates when prepared draft is stale", async () => {
  const prev = fs.existsSync(QUEUE_PATH) ? fs.readFileSync(QUEUE_PATH, "utf8") : null;
  try {
    if (fs.existsSync(QUEUE_PATH)) fs.unlinkSync(QUEUE_PATH);
    delete require.cache[require.resolve("../suggestion-draft-queue.js")];
    const q = require("../suggestion-draft-queue.js");
    q.writeQueue([{ handle: "alice@example.com", queuedAt: new Date().toISOString() }]);

    let persistedDraft = null;
    const result = await q.processOneSuggestionDraft({
      contactStore: {
        findContact: () => ({ handle: "alice@example.com", status: "open", draft: "" }),
        isVisibleInInbox: () => true,
        setDraft: async (_handle, text) => {
          persistedDraft = text;
        },
      },
      buildThreadSnapshot: async () => ({
        company_id: "company-1",
        thread_ref: "reply:email:alice@example.com",
      }),
      getPreparedDraft: async () => ({
        status: "ok",
        stale: true,
        prepared_draft_set: {
          ranked_draft_set: {
            drafts: [{ draft_text: "Old draft." }],
          },
        },
      }),
      getPreparedDraftContext: async () => ({
        message: "Latest inbound",
        snippets: [],
      }),
      generateReply: async () => ({ suggestion: "Fresh Trinity draft." }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, undefined);
    assert.equal(persistedDraft, "Fresh Trinity draft.");
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
