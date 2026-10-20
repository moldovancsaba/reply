function unique(values) {
  const seen = new Set();
  const out = [];
  for (const v of values || []) {
    const s = String(v || "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function extractUrls(text) {
  const out = [];
  const s = String(text || "");
  const re = /\bhttps?:\/\/[^\s<>"')]+/gi;
  const re2 = /\bwww\.[^\s<>"')]+/gi;
  for (const m of s.matchAll(re)) out.push(m[0]);
  for (const m of s.matchAll(re2)) out.push(`https://${m[0]}`);
  return unique(out.map(u => u.replace(/[),.;!?]+$/g, "")));
}

function extractEmails(text) {
  const s = String(text || "");
  const re = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}\b/g;
  return unique(Array.from(s.matchAll(re)).map(m => m[0]));
}

function extractPhones(text) {
  const s = String(text || "");
  const re = /(\+?\d[\d\s().-]{5,}\d)/g;
  const raw = Array.from(s.matchAll(re)).map(m => m[1]);
  const cleaned = raw
    .map(v => String(v).trim())
    .map(v => v.replace(/[^\d+]/g, ""))
    .map(v => (v.startsWith("00") ? `+${v.slice(2)}` : v))
    .filter(v => {
      const digits = v.replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 16;
    });
  return unique(cleaned);
}

function extractHashtags(text) {
  const s = String(text || "");
  const re = /#[\p{L}\p{N}_]{2,}/gu;
  return unique(Array.from(s.matchAll(re)).map(m => m[0]));
}

// Very lightweight heuristic; deep address extraction is handled by the on-demand analyzer.
function extractAddresses(text) {
  const s = String(text || "");
  const keywords = /(address|location|located|meet at|at\s+\d{1,5}|street|st\.|road|rd\.|avenue|ave\.|boulevard|blvd\.|square|zip|postcode|irányítószám|utca|u\.|tér|ter)\b/i;
  if (!keywords.test(s)) return [];
  // Return the line itself as a candidate "address" suggestion.
  // This will be accepted/declined by the user.
  return unique([s.trim()].filter(v => v.length >= 8 && v.length <= 220));
}

function extractSignals(text) {
  return {
    links: extractUrls(text),
    emails: extractEmails(text),
    phones: extractPhones(text),
    hashtags: extractHashtags(text),
    addresses: extractAddresses(text),
  };
}

module.exports = { extractSignals };

