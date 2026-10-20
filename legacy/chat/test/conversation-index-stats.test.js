"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function freshMessageStore(tempDir) {
  process.env.REPLY_DATA_HOME = tempDir;
  process.env.REPLY_CONTACTS_DB_PATH = path.join(tempDir, "contacts.db");
  process.env.REPLY_DISABLE_TRINITY_OUTBOX_DRAIN = "1";
  const appPathsPath = require.resolve("../app-paths.js");
  const messageStorePath = require.resolve("../message-store.js");
  const contactStorePath = require.resolve("../contact-store.js");
  delete require.cache[appPathsPath];
  delete require.cache[messageStorePath];
  delete require.cache[contactStorePath];
  return require("../message-store.js");
}

test("conversation index stats come from the local materialized index", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-msg-stats-"));
  fs.writeFileSync(path.join(tempDir, "chat.db"), "");
  const store = freshMessageStore(tempDir);
  await store.waitUntilReady();

  await store.saveMessages([
    {
      id: "i1",
      text: "imessage inbound",
      source: "iMessage",
      handle: "+36701234567",
      timestamp: "2026-05-04T10:00:00.000Z",
      path: "imessage://+36701234567",
      is_from_me: false,
    },
    {
      id: "w1",
      text: "whatsapp inbound",
      source: "WhatsApp",
      handle: "+447700900123",
      timestamp: "2026-05-04T11:00:00.000Z",
      path: "whatsapp://+447700900123",
      is_from_me: false,
    },
    {
      id: "m1",
      text: "mail inbound",
      source: "Mail",
      handle: "alice@example.com",
      timestamp: "2026-05-04T12:00:00.000Z",
      path: "mailto:alice@example.com",
      is_from_me: false,
    },
  ]);

  const stats = await store.getConversationIndexStats();
  assert.equal(stats.total, 3);
  assert.equal(stats.byChannel.imessage, 1);
  assert.equal(stats.byChannel.whatsapp, 1);
  assert.equal(stats.byChannel.email, 1);

  t.after(async () => {
    await require("../contact-store.js").close?.().catch(() => null);
    delete process.env.REPLY_DATA_HOME;
    delete process.env.REPLY_CONTACTS_DB_PATH;
    delete process.env.REPLY_DISABLE_TRINITY_OUTBOX_DRAIN;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });
});
