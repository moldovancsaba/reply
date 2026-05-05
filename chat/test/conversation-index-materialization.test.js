"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function freshMessageStore(tempDir) {
  process.env.REPLY_DATA_HOME = tempDir;
  process.env.REPLY_CONTACTS_DB_PATH = path.join(tempDir, "contacts.db");
  const appPathsPath = require.resolve("../app-paths.js");
  const messageStorePath = require.resolve("../message-store.js");
  const contactStorePath = require.resolve("../contact-store.js");
  delete require.cache[appPathsPath];
  delete require.cache[messageStorePath];
  delete require.cache[contactStorePath];
  return require("../message-store.js");
}

test("materialized conversation index stores counts and precomputed order locally", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-msg-store-"));
  fs.writeFileSync(path.join(tempDir, "chat.db"), "");
  const store = freshMessageStore(tempDir);
  await store.waitUntilReady();

  await store.saveMessages([
    {
      id: "m1",
      text: "older inbound",
      source: "Mail",
      handle: "alice@example.com",
      timestamp: "2026-05-01T10:00:00.000Z",
      path: "mailto:alice@example.com",
      is_from_me: false,
    },
    {
      id: "m2",
      text: "latest outbound",
      source: "Mail",
      handle: "alice@example.com",
      timestamp: "2026-05-03T10:00:00.000Z",
      path: "mailto:alice@example.com",
      is_from_me: true,
    },
    {
      id: "m3",
      text: "newest overall",
      source: "iMessage",
      handle: "+36701234567",
      timestamp: "2026-05-04T10:00:00.000Z",
      path: "imessage://+36701234567",
      is_from_me: false,
    },
  ]);

  const newest = await store.getConversationIndexRows({ sort: "newest" });
  assert.equal(newest.length, 2);
  assert.equal(newest[0].handle, "+36701234567");
  assert.equal(newest[1].handle, "alice@example.com");

  const alice = newest.find((row) => row.handle === "alice@example.com");
  assert.equal(Number(alice.total_count), 2);
  assert.equal(Number(alice.message_count_in), 1);
  assert.equal(Number(alice.message_count_out), 1);
  assert.equal(alice.text, "latest outbound");

  const oldest = await store.getConversationIndexRows({ sort: "oldest" });
  assert.equal(oldest[0].handle, "alice@example.com");

  t.after(() => {
    delete process.env.REPLY_DATA_HOME;
    delete process.env.REPLY_CONTACTS_DB_PATH;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });
});

test("materialized conversation index collapses alias handles onto one canonical contact row", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-msg-store-"));
  fs.writeFileSync(path.join(tempDir, "chat.db"), "");
  const store = freshMessageStore(tempDir);
  const contactStore = require("../contact-store.js");
  await store.waitUntilReady();
  await contactStore.waitUntilReady();

  await contactStore.updateContact("alice@work.example", {
    id: "contact-alice",
    handle: "alice@work.example",
    displayName: "Alice",
    channels: {
      email: ["alice@work.example", "alice@gmail.com"]
    }
  });

  await store.saveMessages([
    {
      id: "m1",
      text: "older work email",
      source: "Mail",
      handle: "alice@work.example",
      timestamp: "2026-05-01T10:00:00.000Z",
      path: "mailto:alice@work.example",
      is_from_me: false,
    },
    {
      id: "m2",
      text: "latest personal email",
      source: "Mail",
      handle: "alice@gmail.com",
      timestamp: "2026-05-03T10:00:00.000Z",
      path: "mailto:alice@gmail.com",
      is_from_me: true,
    },
  ]);

  const newest = await store.getConversationIndexRows({ sort: "newest" });
  assert.equal(newest.length, 1);
  assert.equal(newest[0].handle, "alice@gmail.com");
  assert.equal(Number(newest[0].total_count), 2);
  assert.equal(Number(newest[0].message_count_in), 1);
  assert.equal(Number(newest[0].message_count_out), 1);
  assert.equal(newest[0].text, "latest personal email");

  t.after(() => {
    delete process.env.REPLY_DATA_HOME;
    delete process.env.REPLY_CONTACTS_DB_PATH;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });
});

test("materialized conversation index self-heals stale blank canonical rows", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-msg-store-"));
  fs.writeFileSync(path.join(tempDir, "chat.db"), "");
  const store = freshMessageStore(tempDir);
  await store.waitUntilReady();

  await store.saveMessages([
    {
      id: "m1",
      text: "latest message",
      source: "iMessage",
      handle: "+36701234567",
      timestamp: "2026-05-04T10:00:00.000Z",
      path: "imessage://+36701234567",
      is_from_me: false,
    },
  ]);

  const sqlite3 = require("sqlite3").verbose();
  const db = new sqlite3.Database(path.join(tempDir, "chat.db"));
  await new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO conversation_index (
        canonical_key, handle, path, source, preview, latest_timestamp, latest_timestamp_ms,
        first_timestamp, first_timestamp_ms, message_count_total, message_count_in, message_count_out,
        sort_freq, sort_recommendation
      ) VALUES ('', '+36701234567', 'imessage://+36701234567', 'iMessage', 'stale duplicate', '2026-05-04T09:00:00.000Z', 1, '2026-05-04T09:00:00.000Z', 1, 1, 1, 0, 0, 0)`,
      (err) => err ? reject(err) : resolve()
    );
  });
  await new Promise((resolve, reject) => db.close((err) => err ? reject(err) : resolve()));

  const rows = await store.getConversationIndexRows({ sort: "newest" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].handle, "+36701234567");
  assert.equal(rows[0].text, "latest message");

  t.after(() => {
    delete process.env.REPLY_DATA_HOME;
    delete process.env.REPLY_CONTACTS_DB_PATH;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });
});
