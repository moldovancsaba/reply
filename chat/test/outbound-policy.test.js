"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
  checkOutboundAllowedForContact,
} = require("../utils/outbound-policy.js");

test("email: allows exact verified address", () => {
  const c = {
    verifiedChannels: { "a@x.com": "2026-01-01T00:00:00Z" },
  };
  const r = checkOutboundAllowedForContact("email", "A@x.com", c);
  assert.equal(r.allowed, true);
});

test("email: blocks different alias on same contact", () => {
  const c = {
    verifiedChannels: { "a@x.com": "2026-01-01T00:00:00Z" },
  };
  const r = checkOutboundAllowedForContact("email", "b@x.com", c);
  assert.equal(r.allowed, false);
  assert.equal(r.code, "email_not_verified");
});

test("imessage: allows matching phone digits", () => {
  const c = {
    verifiedChannels: { "+36701234567": "2026-01-01T00:00:00Z" },
  };
  const r = checkOutboundAllowedForContact("imessage", "36701234567", c);
  assert.equal(r.allowed, true);
});

test("whatsapp: allows suffix digit match for national forms", () => {
  const c = {
    verifiedChannels: { "+36701234567": "2026-01-01T00:00:00Z" },
  };
  const r = checkOutboundAllowedForContact("whatsapp", "+36 70 123 4567", c);
  assert.equal(r.allowed, true);
});

test("linkedin: substring match on profile slug", () => {
  const c = {
    verifiedChannels: {
      "linkedin://john-doe-123": "2026-01-01T00:00:00Z",
    },
  };
  const r = checkOutboundAllowedForContact("linkedin", "john-doe-123", c);
  assert.equal(r.allowed, true);
});
