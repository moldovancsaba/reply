const { generateReply } = require('../reply-engine.js');
const { getSnippets, getGoldenExamples, getHistory } = require("../vector-store.js");
const contactStore = require("../contact-store.js");
const hatori = require("../hatori-client.js");


// Helper functions from server.js
function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const body = await readRequestBody(req);
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function pathPrefixesForHandle(handle) {
  if (!handle || typeof handle !== 'string') return [];
  const h = handle.trim();
  if (!h) return [];
  if (h.includes('@')) return [`mailto:${h}`];
  // Phone-like handles may exist across multiple channels, and may be formatted differently (+36... vs 3630...).
  const variants = new Set();
  variants.add(h);
  const normalized = normalizePhone(h);
  if (normalized) variants.add(normalized);

  const out = [];
  for (const v of variants) {
    out.push(`imessage://${v}`);
    out.push(`whatsapp://${v}`);
    out.push(`telegram://${v}`);
    out.push(`discord://${v}`);
    out.push(`signal://${v}`);
    out.push(`viber://${v}`);
    out.push(`linkedin://${v}`);
  }
  return out;
}

function extractDateFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/\[(.*?)\]/);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

function stripMessagePrefix(text) {
  if (!text || typeof text !== 'string') return "";
  const idx = text.indexOf(": ");
  return idx >= 0 ? text.slice(idx + 2) : text;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  if (!raw) return null;
  // Remove punctuation/spaces, keep only digits and a leading "+"
  let cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("00")) cleaned = `+${cleaned.slice(2)}`;
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return digits; // Use digits-only key to match across formatting
}


/**
 * API Endpoint: /api/suggest
 * Generates a draft suggestion using the latest incoming message for a handle.
 * Uses contact KYC/profile context via generateReply(..., recipient).
 */
async function serveSuggest(req, res) {
  if (req.method !== "POST") {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const json = await readJsonBody(req);
    const handle = json.handle || json.recipient || null;
    const providedMessage = (json.message || json.text || "").trim();

    if (!handle) {
      writeJson(res, 400, { error: "Missing handle" });
      return;
    }

    let message = providedMessage;

    if (!message) {
      const handles = contactStore.getAllHandles(handle);

      const prefixes = handles.flatMap((h) => pathPrefixesForHandle(h));
      const historyBatches = await Promise.all(prefixes.map((p) => getHistory(p)));
      const docs = historyBatches.flat();

      const messages = docs
        .map((d) => ({
          role: (d.text || "").includes("] Me:") ? "me" : "contact",
          text: stripMessagePrefix(d.text || ""),
          date: extractDateFromText(d.text || ""),
        }))
        .filter((m) => m.date && m.text)
        .sort((a, b) => b.date - a.date);

      const lastIncoming = messages.find((m) => m.role === "contact");
      message = lastIncoming?.text?.trim() || "";
    }

    if (!message) {
      writeJson(res, 200, { suggestion: "Hi — just checking in." });
      return;
    }

    const snippets = await getSnippets(message, 3);
    const goldenExamples = await getGoldenExamples(5);

    // Ingest into Hatori before suggestion if enabled
    if (process.env.REPLY_USE_HATORI === '1') {
      try {
        await hatori.ingestEvent({
          external_event_id: `reply:msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          kind: handle.includes('@') ? 'email' : 'imessage',
          conversation_id: `reply:${handle}`,
          sender_id: `reply:${handle}`,
          content: message,
          metadata: { source: 'api-suggest' }
        });
      } catch (e) {
        console.warn("[Hatori] Ingest failed, continuing to suggestion:", e.message);
      }
    }

    const suggestionResult = await generateReply(message, snippets, handle, goldenExamples);
    const suggestion = typeof suggestionResult === 'string' ? suggestionResult : (suggestionResult.suggestion || "");
    const explanation = suggestionResult.explanation || "";
    const hatori_id = suggestionResult.hatori_id || null;

    // Save as pending suggestion
    const { addDocuments } = require("../vector-store.js");
    addDocuments([{
      id: `urn:reply:suggestion:${Date.now()}`,
      text: suggestion,
      source: "agent_suggestion",
      path: `suggestion://${handle}`,
      is_annotated: false
    }]).catch(e => console.error("Failed to save suggestion:", e.message));

    writeJson(res, 200, { suggestion, explanation, hatori_id });
  } catch (e) {
    console.error("Suggest error:", e);
    writeJson(res, 500, { error: e.message || "Suggest failed" });
  }
}

/**
 * API Endpoint: /api/suggest-reply
 * Generates a reply suggestion based on the user's message and local knowledge snippets.
 */
async function serveSuggestReply(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const json = await readJsonBody(req);
  const message = json.message ?? json.text ?? "";
  const recipient = json.recipient || null;

  // Retrieve relevant context from the vector store (Hybrid Search).
  const snippets = await getSnippets(message, 3);

  // Retrieve golden examples
  const goldenExamples = await getGoldenExamples(5);

  // Generate a suggested reply using the local LLM.
  const suggestion = await generateReply(message, snippets, recipient, goldenExamples);

  // Save as pending suggestion
  const { addDocuments } = require("../vector-store.js");
  addDocuments([{
    id: `urn:reply:suggestion:${Date.now()}`,
    text: suggestion,
    source: "agent_suggestion",
    path: `suggestion://${recipient}`,
    is_annotated: false
  }]).catch(e => console.error("Failed to save suggestion:", e.message));

  // Identify contact for UI display
  const contact = contactStore.findContact(recipient);

  writeJson(res, 200, {
    suggestion,
    contact: contact ? { displayName: contact.displayName, profession: contact.profession } : null,
    snippets: snippets.map((s) => ({
      source: s.source,
      path: s.path,
      text: s.text.slice(0, 200) + (s.text.length > 200 ? "…" : "")
    }))
  });
}

module.exports = {
  serveSuggest,
  serveSuggestReply,
};
