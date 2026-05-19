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
  return require("../contact-store.js");
}

async function withFreshStore(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-contact-owner-"));
  const dbPath = path.join(tempDir, "contacts.db");
  const store = freshContactStore(dbPath);
  try {
    await store.waitUntilReady();
    await run({ store, tempDir });
  } finally {
    await store.close?.().catch(() => null);
    delete process.env.REPLY_DATA_HOME;
    delete process.env.REPLY_CONTACTS_DB_PATH;
    delete process.env.REPLY_DISABLE_TRINITY_OUTBOX_DRAIN;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

test("contact store persists owner and customer flags across refresh", async () => {
  await withFreshStore(async ({ store }) => {
    await store.updateContact("alice@example.com", {
      displayName: "Alice",
      owner: "cs",
      customerFlags: ["vip", "renewal", "vip"],
      channels: { email: ["alice@example.com"] },
    });

    await store.refreshIfChanged(0);
    const contact = store.findContact("alice@example.com");
    assert.equal(contact.owner, "cs");
    assert.deepEqual(contact.customerFlags, ["vip", "renewal"]);

    await store.updateContact("alice@example.com", {
      owner: "",
    });

    await store.refreshIfChanged(0);
    const cleared = store.findContact("alice@example.com");
    assert.equal(cleared.owner, "");
    assert.deepEqual(cleared.customerFlags, ["vip", "renewal"]);

    await store.updateContact("alice@example.com", {
      customerFlags: ["vip", "renewal", "escalated", "vip"],
    });

    await store.refreshIfChanged(0);
    const escalated = store.findContact("alice@example.com");
    assert.deepEqual(escalated.customerFlags, ["vip", "renewal", "escalated"]);
  });
});

test("contact store persists profile fields updated through KYC saves", async () => {
  await withFreshStore(async ({ store }) => {
    await store.updateContact("+36707282522", {
      displayName: "Csaba",
      profession: "Founder",
      company: "Reply Labs",
      intro: "Builds the workspace runtime.",
      channels: { phone: ["+36707282522"] },
    });

    await store.refreshIfChanged(0);
    const contact = store.findContact("+36707282522");
    assert.equal(contact.displayName, "Csaba");
    assert.equal(contact.profession, "Founder");
    assert.equal(contact.company, "Reply Labs");
    assert.equal(contact.intro, "Builds the workspace runtime.");
  });
});

test("explicit contact updates prefer the exact handle row over alias-resolved canonical matches", async () => {
  await withFreshStore(async ({ store }) => {
    await store.saveContacts([
      {
        id: "canonical-1",
        handle: "owner@example.com",
        displayName: "Canonical Owner",
        channels: { email: ["owner@example.com"], phone: ["+36707282522"] },
        verifiedChannels: { "+36707282522": "2026-05-18T10:00:00.000Z" },
        lastContacted: "2026-05-18T10:00:00.000Z",
        lastChannel: "imessage",
        status: "open",
      },
      {
        id: "phone-1",
        handle: "+36707282522",
        displayName: "",
        channels: { phone: ["+36707282522"], email: [] },
        lastContacted: "2026-05-18T09:00:00.000Z",
        lastChannel: "imessage",
        status: "open",
      },
    ]);

    await store.updateContact("+36707282522", {
      displayName: "Phone Row",
      profession: "Founder",
    });

    await store.refreshIfChanged(0);
    const direct = store.getContactRowByHandle("+36707282522");
    const resolved = store.findContact("+36707282522");
    assert.equal(direct.displayName, "Phone Row");
    assert.equal(direct.profession, "Founder");
    assert.equal(resolved.handle, "owner@example.com");
    assert.equal(resolved.displayName, "Canonical Owner");
  });
});
