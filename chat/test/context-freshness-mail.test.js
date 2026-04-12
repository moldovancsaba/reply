"use strict";

/** reply#14 — Gmail / mail-like RAG freshness ranking and summary helpers. */
const test = require("node:test");
const assert = require("node:assert");
const {
  rankDocumentsByFreshnessAndRelevance,
  freshnessBucket,
  summarizeRagFreshnessTraces,
  freshnessScore,
} = require("../utils/context-freshness.js");

test("freshness: newer bracketed mail outranks stale mail at same vector rank", () => {
  const now = new Date("2026-04-12T12:00:00Z").getTime();
  const old = `[2020-01-01T10:00:00Z] Contact: old thread\nBody`;
  const recent = `[2026-04-10T10:00:00Z] Contact: reactivated\nBody`;
  const pool = [
    { text: old, source: "Gmail", path: "mailto:a@x.com", _rank: 0.5 },
    { text: recent, source: "Gmail", path: "mailto:a@x.com", _rank: 0.5 },
  ];
  const ranked = rankDocumentsByFreshnessAndRelevance(pool, now);
  assert.equal(ranked[0].doc.text, recent);
});

test("freshness: periodic contact (two old pings) still orders deterministically", () => {
  const now = new Date("2026-04-12T12:00:00Z").getTime();
  const a = `[2025-12-01T08:00:00Z] Contact: quarterly check-in A`;
  const b = `[2025-12-15T08:00:00Z] Contact: quarterly check-in B`;
  const pool = [
    { text: a, source: "IMAP", path: "mailto:p@x.com", _rank: 0.5 },
    { text: b, source: "IMAP", path: "mailto:p@x.com", _rank: 0.5 },
  ];
  const ranked = rankDocumentsByFreshnessAndRelevance(pool, now);
  assert.ok(ranked[0].combined >= ranked[1].combined);
});

test("summarizeRagFreshnessTraces: exposes dominant bucket and mail-like count", () => {
  const traces = [
    { bucket: "fresh", mailLike: true },
    { bucket: "archival", mailLike: true },
    { bucket: "archival", mailLike: false },
  ];
  const s = summarizeRagFreshnessTraces(traces);
  assert.equal(s.traceCount, 3);
  assert.equal(s.mailLikeSnippetCount, 2);
  assert.equal(s.dominantBucket, "archival");
});

test("freshnessBucket boundaries", () => {
  assert.equal(freshnessBucket(0.7), "fresh");
  assert.equal(freshnessBucket(0.5), "recent");
  assert.equal(freshnessBucket(0.1), "archival");
});

test("freshnessScore decays with age", () => {
  const now = Date.now();
  const recent = now - 86400000;
  const old = now - 86400000 * 120;
  assert.ok(freshnessScore(recent, now, 21) > freshnessScore(old, now, 21));
});
