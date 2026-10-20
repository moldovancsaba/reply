"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function freshStores(tempDir) {
  process.env.REPLY_DATA_HOME = tempDir;
  process.env.REPLY_CONTACTS_DB_PATH = path.join(tempDir, "contacts.db");
  process.env.REPLY_DISABLE_TRINITY_OUTBOX_DRAIN = "1";
  const appPathsPath = require.resolve("../app-paths.js");
  const messageStorePath = require.resolve("../message-store.js");
  const preparedContextStorePath = require.resolve("../prepared-context-store.js");
  const contactStorePath = require.resolve("../contact-store.js");
  const foundationPath = require.resolve("../conversation-foundation-store.js");
  const brainRuntimePath = require.resolve("../brain-runtime.js");
  const outboxPath = require.resolve("../trinity-event-outbox.js");
  delete require.cache[appPathsPath];
  delete require.cache[messageStorePath];
  delete require.cache[preparedContextStorePath];
  delete require.cache[contactStorePath];
  delete require.cache[foundationPath];
  delete require.cache[brainRuntimePath];
  delete require.cache[outboxPath];
  return {
    messageStore: require("../message-store.js"),
    preparedContextStore: require("../prepared-context-store.js"),
  };
}

test("prepared draft snapshots are materialized from canonical unified messages", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-prepared-context-"));
  fs.writeFileSync(path.join(tempDir, "chat.db"), "");
  const { messageStore, preparedContextStore } = freshStores(tempDir);
  try {
    await messageStore.waitUntilReady();
    await preparedContextStore.waitUntilReady();

    await messageStore.saveMessages([
      {
        id: "mail-1",
        text: "Earlier inbound mail",
        source: "Mail",
        handle: "alice@example.com",
        timestamp: "2026-05-01T10:00:00.000Z",
        path: "mailto:alice@example.com",
        is_from_me: false,
      },
      {
        id: "mail-2",
        text: "Outbound reply",
        source: "Mail",
        handle: "alice@example.com",
        timestamp: "2026-05-01T10:05:00.000Z",
        path: "mailto:alice@example.com",
        is_from_me: true,
      },
      {
        id: "mail-3",
        text: "Latest inbound mail",
        source: "Mail",
        handle: "alice@example.com",
        timestamp: "2026-05-03T09:00:00.000Z",
        path: "mailto:alice@example.com",
        is_from_me: false,
      },
    ]);

    const snapshots = await preparedContextStore.getDraftContextSnapshots(["alice@example.com"]);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].handle, "alice@example.com");
    assert.equal(snapshots[0].latestInboundText, "Latest inbound mail");
    assert.equal(snapshots[0].latestInboundChannel, "email");
    assert.equal(snapshots[0].recentThread.length, 3);
    assert.deepEqual(
      snapshots[0].recentThread.map((row) => row.role),
      ["contact", "me", "contact"],
    );
    assert.equal(snapshots[0].snippetCandidates.length, 2);
    assert.deepEqual(
      snapshots[0].snippetCandidates.map((snippet) => snippet.text),
      ["Earlier inbound mail", "Latest inbound mail"],
    );
  } finally {
    await require("../contact-store.js").close?.().catch(() => null);
    delete process.env.REPLY_DATA_HOME;
    delete process.env.REPLY_CONTACTS_DB_PATH;
    delete process.env.REPLY_DISABLE_TRINITY_OUTBOX_DRAIN;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
