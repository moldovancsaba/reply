"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function freshContactStore(dbPath) {
  process.env.REPLY_CONTACTS_DB_PATH = dbPath;
  const modPath = require.resolve("../contact-store.js");
  delete require.cache[modPath];
  return require("../contact-store.js");
}

test("message-backed handles are inbox-eligible without a contact row", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-contact-store-"));
  const dbPath = path.join(tempDir, "contacts.db");
  const store = freshContactStore(dbPath);
  await store.waitUntilReady();
  await store.refreshIfChanged(0);

  assert.equal(store.isInboxEligible("120363425107932945"), true);
  assert.equal(store.isInboxEligible("+36 70 123 4567"), true);
  assert.equal(store.isInboxEligible("unknown"), false);

  t.after(() => {
    delete process.env.REPLY_CONTACTS_DB_PATH;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });
});

test("hidden contacts stay out of inbox even with a usable handle", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-contact-store-"));
  const dbPath = path.join(tempDir, "contacts.db");
  const store = freshContactStore(dbPath);
  await store.waitUntilReady();
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

  t.after(() => {
    delete process.env.REPLY_CONTACTS_DB_PATH;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });
});
