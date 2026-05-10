"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function freshContactStore(dbPath) {
  process.env.REPLY_DATA_HOME = path.dirname(dbPath);
  process.env.REPLY_CONTACTS_DB_PATH = dbPath;
  process.env.REPLY_DISABLE_TRINITY_OUTBOX_DRAIN = "1";
  const appPathsPath = require.resolve("../app-paths.js");
  const modPath = require.resolve("../contact-store.js");
  const brainRuntimePath = require.resolve("../brain-runtime.js");
  const outboxPath = require.resolve("../trinity-event-outbox.js");
  delete require.cache[appPathsPath];
  delete require.cache[modPath];
  delete require.cache[brainRuntimePath];
  delete require.cache[outboxPath];
  return {
    contactStore: require("../contact-store.js"),
  };
}

async function withFreshStore(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-contact-store-"));
  const dbPath = path.join(tempDir, "contacts.db");
  const { contactStore: store } = freshContactStore(dbPath);
  try {
    await store.waitUntilReady();
    await run({ store, tempDir, dbPath });
  } finally {
    await store.close?.().catch(() => null);
    delete process.env.REPLY_DATA_HOME;
    delete process.env.REPLY_CONTACTS_DB_PATH;
    delete process.env.REPLY_DISABLE_TRINITY_OUTBOX_DRAIN;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

test("contact store inbox eligibility and runtime contact-upsert events stay consistent", async () => {
  await withFreshStore(async ({ store }) => {
    await store.refreshIfChanged(0);
    assert.equal(store.isInboxEligible("120363425107932945"), true);
    assert.equal(store.isInboxEligible("+36 70 123 4567"), true);
    assert.equal(store.isInboxEligible("unknown"), false);
  });

  await withFreshStore(async ({ store }) => {
    await store.saveContact({
      id: "c1",
      handle: "+36701234567",
      displayName: "Hidden Contact",
      lastContacted: new Date().toISOString(),
      lastChannel: "imessage",
      status: "open",
      visibility_state: "archived",
      channels: { phone: ["+36701234567"], email: [] },
    });
    await store.refreshIfChanged(0);
    assert.equal(store.isInboxEligible("+36701234567"), false);
  });

  await withFreshStore(async ({ store, tempDir }) => {
    await store.saveContact({
      id: "c1",
      handle: "+36701234567",
      displayName: "Alice",
      lastContacted: "2026-05-03T10:00:00.000Z",
      lastChannel: "imessage",
      status: "open",
      visibility_state: "active",
      channels: { phone: ["+36701234567"], email: [] },
      verifiedChannels: { "+36701234567": "2026-05-03T10:00:00.000Z" },
    });

    const sqlite3 = require("sqlite3").verbose();
    const db = new sqlite3.Database(path.join(tempDir, "chat.db"), sqlite3.OPEN_READONLY);
    const rows = await new Promise((resolve, reject) => {
      db.all(
        "SELECT event_type, payload_json FROM trinity_event_outbox ORDER BY id ASC",
        (err, result) => err ? reject(err) : resolve(result || []),
      );
    });
    await new Promise((resolve, reject) => db.close((err) => err ? reject(err) : resolve()));

    assert.equal(rows.length, 1);
    const payload = JSON.parse(String(rows[0].payload_json || "{}"));
    assert.equal(rows[0].event_type, "memory_event");
    assert.equal(payload.event_kind, "contact_upserted");
    assert.equal(payload.contact_handle, "+36701234567");
    assert.equal(payload.metadata.display_name, "Alice");
    assert.equal(payload.metadata.last_channel, "imessage");
  });
});
