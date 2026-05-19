"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("resolveAppleMailIndexPath prefers highest available versioned MailData store", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reply-mail-root-"));
  const originalHome = process.env.HOME;
  const originalExplicit = process.env.REPLY_APPLE_MAIL_INDEX_PATH;

  try {
    const v9 = path.join(tmpRoot, "Library", "Mail", "V9", "MailData");
    const v10 = path.join(tmpRoot, "Library", "Mail", "V10", "MailData");
    fs.mkdirSync(v9, { recursive: true });
    fs.mkdirSync(v10, { recursive: true });
    fs.writeFileSync(path.join(v9, "Envelope Index"), "older");
    fs.writeFileSync(path.join(v10, "Envelope Index"), "newer");

    process.env.HOME = tmpRoot;
    delete process.env.REPLY_APPLE_MAIL_INDEX_PATH;

    delete require.cache[require.resolve("../mail-runtime-utils.js")];
    const { resolveAppleMailIndexPath } = require("../mail-runtime-utils.js");
    assert.equal(
      resolveAppleMailIndexPath(),
      path.join(tmpRoot, "Library", "Mail", "V10", "MailData", "Envelope Index"),
    );
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalExplicit === undefined) delete process.env.REPLY_APPLE_MAIL_INDEX_PATH;
    else process.env.REPLY_APPLE_MAIL_INDEX_PATH = originalExplicit;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete require.cache[require.resolve("../mail-runtime-utils.js")];
  }
});

test("buildMailStatus preserves last successful sync across errors and clears stale state fields", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reply-mail-status-"));
  const originalDataHome = process.env.REPLY_DATA_HOME;

  try {
    process.env.REPLY_DATA_HOME = tmpRoot;
    delete require.cache[require.resolve("../status-manager.js")];
    delete require.cache[require.resolve("../mail-runtime-utils.js")];
    const statusManager = require("../status-manager.js");
    const { buildMailStatus } = require("../mail-runtime-utils.js");

    statusManager.replace("mail", {
      connector: "apple_mail",
      state: "idle",
      message: "No new Apple Mail index rows found",
      progress: 100,
      processed: 216043,
      lastSync: "2026-05-18T08:31:40.428Z",
      lastSuccessfulSync: "2026-05-18T08:31:40.428Z",
      lastAttemptedSync: "2026-05-18T08:31:40.428Z",
    });

    const next = buildMailStatus(
      statusManager.get("mail"),
      { state: "error", message: "SQLITE_CANTOPEN: unable to open database file", progress: 10 },
      "apple_mail",
    );

    assert.equal(next.connector, "apple_mail");
    assert.equal(next.state, "error");
    assert.equal(next.message, "SQLITE_CANTOPEN: unable to open database file");
    assert.equal(next.progress, 10);
    assert.equal(next.lastSuccessfulSync, "2026-05-18T08:31:40.428Z");
    assert.equal(next.lastSync, "2026-05-18T08:31:40.428Z");
    assert.ok(next.lastAttemptedSync);
    assert.equal("status" in next, false);
  } finally {
    if (originalDataHome === undefined) delete process.env.REPLY_DATA_HOME;
    else process.env.REPLY_DATA_HOME = originalDataHome;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete require.cache[require.resolve("../status-manager.js")];
    delete require.cache[require.resolve("../mail-runtime-utils.js")];
  }
});
