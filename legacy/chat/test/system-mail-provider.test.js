"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveMailProvider } = require("../routes/system.js");

test("mail provider prefers active connector from sync status over configured providers", () => {
  assert.equal(
    resolveMailProvider({
      mailStatus: { connector: "apple_mail" },
      gmailOk: true,
      imapOk: true,
    }),
    "apple_mail",
  );
});

test("mail provider falls back to configured gmail or imap when no active connector is present", () => {
  assert.equal(resolveMailProvider({ mailStatus: {}, gmailOk: true, imapOk: true }), "gmail");
  assert.equal(resolveMailProvider({ mailStatus: {}, gmailOk: false, imapOk: true }), "imap");
  assert.equal(resolveMailProvider({ mailStatus: {}, gmailOk: false, imapOk: false }), "");
});
