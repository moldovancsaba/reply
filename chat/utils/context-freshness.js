/**
 * Recency / freshness scoring for vector-store snippets and RAG facts (local-first).
 */

function parseBracketDateMs(text) {
  const m = String(text || "").match(/^\[([^\]]+)\]/);
  if (!m) return null;
  const t = new Date(m[1]).getTime();
  return Number.isFinite(t) ? t : null;
}

function halfLifeDaysFromEnv() {
  const n = parseFloat(process.env.REPLY_CONTEXT_HALF_LIFE_DAYS || "21", 10);
  return Number.isFinite(n) && n > 0 ? n : 21;
}

function relevanceWeightFromEnv() {
  const n = parseFloat(process.env.REPLY_CONTEXT_RELEVANCE_WEIGHT || "0.45", 10);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.45;
}

function freshnessWeightFromEnv() {
  const n = parseFloat(process.env.REPLY_CONTEXT_FRESHNESS_WEIGHT || "0.55", 10);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.55;
}

/**
 * Exponential decay: 1 at age 0, 0.5 at halfLifeDays.
 */
function freshnessScore(dateMs, nowMs = Date.now(), halfLifeDays = halfLifeDaysFromEnv()) {
  if (dateMs == null || !Number.isFinite(dateMs)) return 0.35;
  const ageDays = Math.max(0, (nowMs - dateMs) / 86400000);
  const hl = Math.max(0.5, halfLifeDays);
  return Math.pow(0.5, ageDays / hl);
}

function isMailLikeSource(source, path) {
  const s = String(source || "").toLowerCase();
  const p = String(path || "").toLowerCase();
  return (
    p.startsWith("mailto:") ||
    s.includes("gmail") ||
    s.includes("imap") ||
    s.includes("mail") ||
    s === "mbox"
  );
}

/**
 * @param {Array<{ text?: string, source?: string, path?: string, _rank?: number }>} docs
 * @param {number} [nowMs]
 * @returns {Array<{ doc: object, combined: number, freshness: number, relevance: number, isMail: boolean }>}
 */
function rankDocumentsByFreshnessAndRelevance(docs, nowMs = Date.now()) {
  const wF = freshnessWeightFromEnv();
  const wR = relevanceWeightFromEnv();
  const sumW = wF + wR || 1;

  const out = (docs || []).map((doc, i) => {
    const dateMs = parseBracketDateMs(doc.text || "");
    const fresh = freshnessScore(dateMs, nowMs);
    const rel = typeof doc._rank === "number" ? doc._rank : 1 / (1 + i);
    const isMail = isMailLikeSource(doc.source, doc.path);
    const combined = (wF * fresh + wR * rel) / sumW;
    return {
      doc,
      combined,
      freshness: fresh,
      relevance: rel,
      isMail,
      approxAgeDays:
        dateMs != null ? Math.max(0, (nowMs - dateMs) / 86400000) : null,
    };
  });

  out.sort((a, b) => b.combined - a.combined);
  return out;
}

/**
 * Labels for API / prompt annotation.
 */
function freshnessBucket(freshScore) {
  if (freshScore >= 0.65) return "fresh";
  if (freshScore >= 0.35) return "recent";
  return "archival";
}

module.exports = {
  parseBracketDateMs,
  freshnessScore,
  rankDocumentsByFreshnessAndRelevance,
  freshnessBucket,
  isMailLikeSource,
  halfLifeDaysFromEnv,
};
