"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOutboundMessageIndex,
  buildContactIntelligenceEvents,
  buildOutcomeBackfillEvents,
  inferDraftOutcomeRowsFromGenerated,
  normalizeRequestedSources,
  normalizedEditDistance,
  resolveOutcomeFinalText,
} = require("../trinity-source-backfill.js");

test("normalizeRequestedSources defaults to the bounded first backfill lane", () => {
  assert.deepEqual(
    normalizeRequestedSources([]),
    ["notes", "calendar", "contacts", "contact-intelligence"],
  );
});

test("normalizeRequestedSources preserves explicit conversation and outcome families", () => {
  assert.deepEqual(
    normalizeRequestedSources(["mail", "imessage", "accepted-outcome"]),
    ["mail", "imessage", "accepted-outcome"],
  );
});

test("buildContactIntelligenceEvents builds structured Trinity memory payloads", () => {
  const events = buildContactIntelligenceEvents([
    {
      id: "contact-1",
      handle: "alice@example.com",
      displayName: "Alice",
      profession: "Mathematician",
      relationship: "Partner",
      company: "Example Labs",
      intro: "Direct and analytical.",
      notes: [{ text: "Prefers concise answers." }],
      pendingSuggestions: [{ type: "note", content: "VIP contact", timestamp: "2026-05-21T12:00:00.000Z" }],
      rejectedSuggestions: ["old suggestion"],
      kycAnalysis: { confidence: "high", source: "kyc-agent" },
    },
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].event_kind, "contact_intelligence_upserted");
  assert.equal(events[0].contact_handle, "alice@example.com");
  assert.match(events[0].content_text, /Mathematician/);
  assert.match(events[0].content_text, /VIP contact/);
  assert.deepEqual(events[0].metadata.kyc_analysis, { confidence: "high", source: "kyc-agent" });
  assert.deepEqual(events[0].metadata.notes, ["Prefers concise answers."]);
});

test("buildOutcomeBackfillEvents rebuilds strict Trinity outcome payloads from persisted learning rows", () => {
  const events = buildOutcomeBackfillEvents([
    {
      event_kind: "draft_outcome",
      runtime_mode: "trinity",
      cycle_id: "11111111-1111-4111-8111-111111111111",
      candidate_id: "22222222-2222-4222-8222-222222222222",
      thread_ref: "reply:email:alice@example.com",
      channel: "email",
      reason: "SENT_AS_IS",
      suggestion_text: "Original draft",
      final_text: "Final draft",
      created_at: "2026-05-21T12:00:00.000Z",
      metadata_json: JSON.stringify({
        edit_distance: 0,
        latency_ms: 10,
        send_result: "ok",
        notes: "backfill",
      }),
    },
    {
      event_kind: "draft_outcome",
      runtime_mode: "local",
      cycle_id: "not-a-uuid",
      reason: "SENT_AS_IS",
      created_at: "2026-05-21T12:01:00.000Z",
    },
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].cycle_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(events[0].candidate_id, "22222222-2222-4222-8222-222222222222");
  assert.equal(events[0].disposition, "SENT_AS_IS");
  assert.equal(events[0].channel, "email");
  assert.equal(events[0].final_text, "Final draft");
  assert.equal(events[0].notes, "backfill");
});

test("buildOutcomeBackfillEvents rejects ambiguous or non-send-grade replay rows", () => {
  const events = buildOutcomeBackfillEvents([
    {
      event_kind: "draft_outcome",
      runtime_mode: "trinity",
      cycle_id: "11111111-1111-4111-8111-111111111111",
      candidate_id: "22222222-2222-4222-8222-222222222222",
      thread_ref: "reply:whatsapp:alice",
      channel: "whatsapp",
      reason: "SHOWN",
      suggestion_text: "Draft only",
      final_text: null,
      created_at: "2026-05-21T12:00:00.000Z",
    },
    {
      event_kind: "draft_outcome",
      runtime_mode: "trinity",
      cycle_id: "11111111-1111-4111-8111-111111111111",
      candidate_id: "bad-candidate-id",
      thread_ref: "reply:whatsapp:alice",
      channel: "whatsapp",
      reason: "SENT_AS_IS",
      suggestion_text: "Draft only",
      final_text: null,
      created_at: "2026-05-21T12:00:01.000Z",
    },
  ]);

  assert.equal(events.length, 0);
});

test("buildOutcomeBackfillEvents normalizes sent-as-is rows without stored final text", () => {
  const events = buildOutcomeBackfillEvents([
    {
      event_kind: "draft_outcome",
      runtime_mode: "trinity",
      cycle_id: "11111111-1111-4111-8111-111111111111",
      candidate_id: "22222222-2222-4222-8222-222222222222",
      thread_ref: "reply:whatsapp:alice",
      channel: "whatsapp",
      reason: "SENT_AS_IS",
      suggestion_text: "Original draft",
      final_text: null,
      created_at: "2026-05-21T12:00:00.000Z",
    },
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].original_draft_text, "Original draft");
  assert.equal(events[0].final_text, "Original draft");
});

test("buildOutcomeBackfillEvents rejects generic operator-placeholder drafts", () => {
  const events = buildOutcomeBackfillEvents([
    {
      event_kind: "draft_outcome",
      runtime_mode: "trinity",
      cycle_id: "11111111-1111-4111-8111-111111111111",
      candidate_id: "22222222-2222-4222-8222-222222222222",
      thread_ref: "reply:whatsapp:alice",
      channel: "whatsapp",
      reason: "SENT_AS_IS",
      suggestion_text: "Thanks 242910582800433, I saw this. I can move this forward.",
      final_text: "Thanks 242910582800433, I saw this. I can move this forward.",
      created_at: "2026-05-21T12:00:00.000Z",
    },
  ]);

  assert.equal(events.length, 0);
});

test("resolveOutcomeFinalText prefers nearest real outbound text over placeholder drafts", () => {
  const outboundIndex = buildOutboundMessageIndex([
    {
      source: "whatsapp",
      handle: "+36705957647",
      text: "Kérek egy linket",
      timestamp: "2026-05-18T13:51:12.697Z",
      is_from_me: 1,
    },
    {
      source: "whatsapp",
      handle: "+36705957647",
      text: "Thanks 36705957647, I saw this. I can move this forward.",
      timestamp: "2026-05-18T13:52:12.697Z",
      is_from_me: 1,
    },
  ]);

  const resolved = resolveOutcomeFinalText(
    {
      channel: "whatsapp",
      contact_handle: "+36705957647",
      created_at: "2026-05-18T13:51:20.000Z",
    },
    outboundIndex,
  );

  assert.equal(resolved, "Kérek egy linket");
});

test("buildOutcomeBackfillEvents uses recovered outbound final text when available", () => {
  const events = buildOutcomeBackfillEvents(
    [
      {
        event_kind: "draft_outcome",
        runtime_mode: "trinity",
        cycle_id: "11111111-1111-4111-8111-111111111111",
        candidate_id: "22222222-2222-4222-8222-222222222222",
        thread_ref: "reply:whatsapp:+36705957647",
        channel: "whatsapp",
        reason: "SENT_AS_IS",
        suggestion_text: "Thanks 36705957647, I saw this. I can move this forward.",
        final_text: "Thanks 36705957647, I saw this. I can move this forward.",
        created_at: "2026-05-18T13:51:20.000Z",
      },
    ],
    {
      resolveFinalText: () => "Kérek egy linket",
    },
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].final_text, "Kérek egy linket");
});

test("inferDraftOutcomeRowsFromGenerated rebuilds trustworthy sent outcomes from generated drafts and outbound messages", () => {
  const outboundIndex = buildOutboundMessageIndex([
    {
      source: "mail",
      handle: "alice@example.com",
      text: "Please confirm tomorrow at 10.",
      timestamp: "2026-05-21T12:15:00.000Z",
      is_from_me: 1,
    },
  ]);

  const inferred = inferDraftOutcomeRowsFromGenerated(
    [
      {
        event_kind: "draft_generated",
        runtime_mode: "trinity",
        cycle_id: "11111111-1111-4111-8111-111111111111",
        candidate_id: "22222222-2222-4222-8222-222222222222",
        thread_ref: "reply:email:alice@example.com",
        channel: "email",
        contact_handle: "alice@example.com",
        suggestion_text: "Please confirm tomorrow at 10.",
        created_at: "2026-05-21T12:00:00.000Z",
      },
    ],
    outboundIndex,
  );

  assert.equal(inferred.length, 1);
  assert.equal(inferred[0].event_kind, "draft_outcome");
  assert.equal(inferred[0].reason, "SENT_AS_IS");
  assert.equal(inferred[0].final_text, "Please confirm tomorrow at 10.");
  assert.equal(inferred[0].metadata.inferred_from, "draft_generated_outbound_match");
});

test("inferDraftOutcomeRowsFromGenerated rejects weak or generic outbound matches", () => {
  const outboundIndex = buildOutboundMessageIndex([
    {
      source: "mail",
      handle: "alice@example.com",
      text: "Thanks alice, I saw this. I can move this forward.",
      timestamp: "2026-05-21T12:15:00.000Z",
      is_from_me: 1,
    },
  ]);

  const inferred = inferDraftOutcomeRowsFromGenerated(
    [
      {
        event_kind: "draft_generated",
        runtime_mode: "trinity",
        cycle_id: "11111111-1111-4111-8111-111111111111",
        candidate_id: "22222222-2222-4222-8222-222222222222",
        thread_ref: "reply:email:alice@example.com",
        channel: "email",
        contact_handle: "alice@example.com",
        suggestion_text: "Please confirm tomorrow at 10.",
        created_at: "2026-05-21T12:00:00.000Z",
      },
    ],
    outboundIndex,
  );

  assert.equal(inferred.length, 0);
});

test("normalizedEditDistance reports partial edits consistently", () => {
  assert.equal(normalizedEditDistance("same draft", "same draft"), 0);
  assert.ok(normalizedEditDistance("Please confirm tomorrow at 10.", "Please confirm at 10 tomorrow.") < 0.45);
});
