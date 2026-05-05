"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function freshFoundationStore(tempDir) {
  process.env.REPLY_DATA_HOME = tempDir;
  process.env.REPLY_CONTACTS_DB_PATH = path.join(tempDir, "contacts.db");
  const appPathsPath = require.resolve("../app-paths.js");
  const foundationStorePath = require.resolve("../conversation-foundation-store.js");
  const messageStorePath = require.resolve("../message-store.js");
  const contactStorePath = require.resolve("../contact-store.js");
  delete require.cache[appPathsPath];
  delete require.cache[foundationStorePath];
  delete require.cache[messageStorePath];
  delete require.cache[contactStorePath];
  return require("../conversation-foundation-store.js");
}

test("conversation foundation schema tables are initialized in chat.db", { concurrency: false }, async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-foundation-"));
  fs.writeFileSync(path.join(tempDir, "chat.db"), "");

  const store = freshFoundationStore(tempDir);
  await store.waitUntilReady();

  const tables = await store.getSchemaSummary();
  assert.deepEqual(tables, [
    "conversation_channel_capabilities",
    "conversation_messages",
    "conversation_participants",
    "conversation_snapshots",
    "external_threads",
    "message_recipients",
  ]);

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

test("conversation foundation keeps channel capabilities snapshot-local even when the contact has other verified identities", { concurrency: false }, async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-foundation-"));
  fs.writeFileSync(path.join(tempDir, "chat.db"), "");
  const foundationStore = freshFoundationStore(tempDir);
  const messageStore = require("../message-store.js");
  const contactStore = require("../contact-store.js");
  await foundationStore.waitUntilReady();
  await messageStore.waitUntilReady();
  await contactStore.waitUntilReady();

  await contactStore.updateContact("+15550001111", {
    id: "contact-whatsapp-only",
    handle: "+15550001111",
    displayName: "WhatsApp Only",
    channels: {
      email: ["alice@example.com"],
      phone: ["+15550001111"]
    },
    verifiedChannels: {
      "alice@example.com": "2026-05-01T10:00:00.000Z",
      "+15550001111": "2026-05-03T11:00:00.000Z"
    }
  });

  await messageStore.saveMessages([
    {
      id: "m1",
      text: "whatsapp inbound",
      source: "WhatsApp",
      handle: "+15550001111",
      timestamp: "2026-05-01T10:00:00.000Z",
      path: "whatsapp://+15550001111",
      is_from_me: false,
    },
    {
      id: "m2",
      text: "whatsapp outbound",
      source: "WhatsApp",
      handle: "+15550001111",
      timestamp: "2026-05-03T11:00:00.000Z",
      path: "whatsapp://+15550001111",
      is_from_me: true,
    },
  ]);

  const summary = await foundationStore.getConversationSummaryByHandle("+15550001111");
  assert.ok(summary?.conversationId);
  assert.deepEqual(summary.channels, ["whatsapp"]);
  assert.deepEqual(summary.allowedChannels, ["whatsapp"]);

  const thread = await foundationStore.getConversationMessagesByHandle("+15550001111", { limit: 10, offset: 0, order: "asc" });
  assert.equal(thread.total, 2);
  assert.deepEqual(thread.channels, ["whatsapp"]);
  assert.deepEqual(thread.allowedChannels, ["whatsapp"]);
  assert.equal(thread.rows[0].channel, "whatsapp");
  assert.equal(thread.rows[1].channel, "whatsapp");

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

test("conversation foundation creates new snapshots when email participant membership changes", { concurrency: false }, async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-foundation-"));
  fs.writeFileSync(path.join(tempDir, "chat.db"), "");
  const foundationStore = freshFoundationStore(tempDir);
  const messageStore = require("../message-store.js");
  const contactStore = require("../contact-store.js");
  await foundationStore.waitUntilReady();
  await messageStore.waitUntilReady();
  await contactStore.waitUntilReady();

  await contactStore.updateContact("alice@example.com", {
    id: "contact-alice",
    handle: "alice@example.com",
    displayName: "Alice",
    channels: { email: ["alice@example.com"] },
    verifiedChannels: { "alice@example.com": "2026-05-01T10:00:00.000Z" }
  });

  await messageStore.saveMessages([
    {
      id: "g1",
      text: "first thread",
      source: "Mail",
      handle: "alice@example.com",
      timestamp: "2026-05-01T10:00:00.000Z",
      path: "mailto:alice@example.com",
      is_from_me: false,
      metadata: {
        providerMessageKey: "m1",
        channel: "email",
        externalThreadKey: "mail-thread-1",
        externalThreadKind: "direct",
        senderIdentity: "alice@example.com",
        participantIdentities: ["alice@example.com"],
        recipientIdentities: []
      }
    },
    {
      id: "g2",
      text: "expanded recipients",
      source: "Mail",
      handle: "alice@example.com",
      timestamp: "2026-05-02T11:00:00.000Z",
      path: "mailto:alice@example.com",
      is_from_me: false,
      metadata: {
        providerMessageKey: "m2",
        channel: "email",
        externalThreadKey: "mail-thread-1",
        externalThreadKind: "group",
        senderIdentity: "alice@example.com",
        participantIdentities: ["alice@example.com", "bob@example.com"],
        recipientIdentities: []
      }
    }
  ]);

  const sqlite3 = require("sqlite3").verbose();
  const db = new sqlite3.Database(path.join(tempDir, "chat.db"), sqlite3.OPEN_READONLY);
  const snapshots = await new Promise((resolve, reject) => {
    db.all(
      "SELECT conversation_id, conversation_kind, membership_fingerprint FROM conversation_snapshots ORDER BY latest_message_at ASC",
      (err, rows) => err ? reject(err) : resolve(rows || [])
    );
  });
  await new Promise((resolve, reject) => db.close((err) => err ? reject(err) : resolve()));

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].conversation_kind, "direct");
  assert.equal(snapshots[1].conversation_kind, "group");
  assert.notEqual(snapshots[0].membership_fingerprint, snapshots[1].membership_fingerprint);

  const summary = await foundationStore.getConversationSummaryByHandle("alice@example.com");
  assert.ok(summary?.conversationId);

  const thread = await foundationStore.getConversationMessagesByHandle("alice@example.com", { limit: 10, offset: 0, order: "asc" });
  assert.equal(thread.total, 1);
  assert.equal(thread.rows[0].text, "expanded recipients");

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

test("conversation foundation merges stale duplicate same-membership snapshots for thread reads", { concurrency: false }, async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-foundation-"));
  fs.writeFileSync(path.join(tempDir, "chat.db"), "");
  const foundationStore = freshFoundationStore(tempDir);
  const messageStore = require("../message-store.js");
  const contactStore = require("../contact-store.js");
  await foundationStore.waitUntilReady();
  await messageStore.waitUntilReady();
  await contactStore.waitUntilReady();

  await contactStore.updateContact("+36701234567", {
    id: "contact-alice",
    handle: "+36701234567",
    displayName: "Alice",
    channels: { phone: ["+36701234567"] },
    verifiedChannels: { "+36701234567": "2026-05-01T10:00:00.000Z" }
  });

  await messageStore.saveMessages([
    {
      id: "m1",
      text: "older inbound",
      source: "iMessage",
      handle: "+36701234567",
      timestamp: "2026-05-01T10:00:00.000Z",
      path: "imessage://+36701234567",
      is_from_me: false,
    },
    {
      id: "m2",
      text: "latest outbound",
      source: "iMessage",
      handle: "+36701234567",
      timestamp: "2026-05-02T10:00:00.000Z",
      path: "imessage://+36701234567",
      is_from_me: true,
    },
  ]);

  const sqlite3 = require("sqlite3").verbose();
  const db = new sqlite3.Database(path.join(tempDir, "chat.db"));
  const snapshots = await new Promise((resolve, reject) => {
    db.all(
      "SELECT conversation_id, channel, membership_fingerprint, title, latest_message_at FROM conversation_snapshots ORDER BY latest_message_at DESC",
      (err, rows) => err ? reject(err) : resolve(rows || [])
    );
  });
  assert.equal(snapshots.length, 1);
  const original = snapshots[0];
  const duplicateConversationId = "conversation:stale-duplicate";
  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `INSERT INTO conversation_snapshots (
          conversation_id, external_thread_id, parent_conversation_id, superseded_by_conversation_id,
          channel, conversation_kind, membership_fingerprint, title, opened_at, closed_at, closure_reason,
          latest_message_at, latest_inbound_at, latest_outbound_at, latest_message_id, last_visible_summary
        ) VALUES (?, NULL, NULL, NULL, ?, 'direct', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
        [
          duplicateConversationId,
          original.channel,
          original.membership_fingerprint,
          original.title,
          "2026-05-02T10:00:00.000Z",
          "2026-05-02T10:00:00.000Z",
          "2026-05-01T10:00:00.000Z",
          "2026-05-02T10:00:00.000Z",
          "m2-dup",
          "latest outbound",
        ]
      );
      db.run(
        `INSERT INTO conversation_participants (
          conversation_id, participant_id, contact_id, raw_address, normalized_address, channel_identity_kind, is_self, role, joined_at, left_at
        ) VALUES (?, 'self-dup', NULL, 'self', 'self', 'self', 1, 'self', '2026-05-02T10:00:00.000Z', NULL)`,
        [duplicateConversationId]
      );
      db.run(
        `INSERT INTO conversation_participants (
          conversation_id, participant_id, contact_id, raw_address, normalized_address, channel_identity_kind, is_self, role, joined_at, left_at
        ) VALUES (?, 'p-dup', 'contact-alice', '+36701234567', '+36701234567', 'imessage', 0, 'participant', '2026-05-02T10:00:00.000Z', NULL)`,
        [duplicateConversationId]
      );
      db.run(
        `INSERT INTO conversation_messages (
          message_id, conversation_id, external_thread_id, provider_message_key, provider_message_key_normalized,
          channel, source, handle, from_participant_id, direction, sent_at_utc, received_at_utc, sort_timestamp_utc,
          content_text, content_summary, has_attachments, metadata_json
        ) VALUES (?, ?, NULL, ?, ?, 'imessage', 'iMessage', '+36701234567', 'self-dup', 'outbound', ?, NULL, ?, ?, ?, 0, '{}')`,
        [
          "m2-dup",
          duplicateConversationId,
          "m2-dup",
          "m2-dup",
          "2026-05-02T10:00:00.000Z",
          "2026-05-02T10:00:00.000Z",
          "latest outbound",
          "latest outbound",
        ],
        (err) => err ? reject(err) : resolve()
      );
    });
  });
  await new Promise((resolve, reject) => db.close((err) => err ? reject(err) : resolve()));

  const summary = await foundationStore.getConversationSummaryByHandle("+36701234567");
  assert.equal(summary?.conversationIds?.length, 2);

  const thread = await foundationStore.getConversationMessagesByHandle("+36701234567", { limit: 10, offset: 0, order: "asc" });
  assert.equal(thread.total, 3);
  assert.deepEqual(thread.rows.map((row) => row.text), [
    "older inbound",
    "latest outbound",
    "latest outbound",
  ]);

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
