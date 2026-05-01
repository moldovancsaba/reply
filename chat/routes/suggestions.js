const { generateReply } = require('../reply-engine.js');
const { getSnippets, getGoldenExamples, getHistory } = require("../vector-store.js");
const contactStore = require("../contact-store.js");
const messageStore = require("../message-store.js");
const { pathPrefixesForHandle, pickLatestInboundFromVectorDocs, inferChannelFromHandle } = require("../utils/chat-utils.js");


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

/**
 * Maps a LanceDB document to the JSON shape returned on `/api/suggest-reply` under `snippets`.
 * When `is_annotated` is true, includes summary/tags/facts for UI or clients (reply#37).
 * @param {object} doc - Row from vector store (may include annotation_* fields).
 * @returns {{ source: string, path: string, text: string, is_annotated: boolean, annotation_summary?: string, annotation_tags?: string[], annotation_facts?: string[] }}
 */
function snippetShapeForSuggestReply(doc) {
  const raw = doc.text || "";
  const preview = raw.slice(0, 200) + (raw.length > 200 ? "…" : "");
  const isAnnotated = Boolean(doc.is_annotated);
  const base = {
    source: doc.source,
    path: doc.path,
    text: preview,
    is_annotated: isAnnotated
  };
  if (!isAnnotated) return base;
  let tags = [];
  let facts = [];
  try {
    const t = JSON.parse(doc.annotation_tags || "[]");
    if (Array.isArray(t)) tags = t.map(String);
  } catch { /* ignore */ }
  try {
    const f = JSON.parse(doc.annotation_facts || "[]");
    if (Array.isArray(f)) facts = f.map(String);
  } catch { /* ignore */ }
  return {
    ...base,
    annotation_summary: doc.annotation_summary || "",
    annotation_tags: tags,
    annotation_facts: facts
  };
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
      const picked = pickLatestInboundFromVectorDocs(docs);
      message = picked?.text?.trim() || "";

      if (!message) {
        const dbRow = await messageStore.getLatestContextForHandles(handles, { limit: 120 });
        message = String(dbRow?.text || '').trim();
        inferChannelFromHandle(dbRow?.handle || handle);
      }
    }

    if (!message) {
      writeJson(res, 422, {
        error: "No inbound contact message found in index for this handle — cannot generate a reply.",
        code: "no_inbound_context",
        suggestion: ""
      });
      return;
    }

    const snippets = await getSnippets(message, 3);
    const goldenExamples = await getGoldenExamples(5);

    const suggestionResult = await generateReply(message, snippets, handle, goldenExamples);
    const suggestion = typeof suggestionResult === 'string' ? suggestionResult : (suggestionResult.suggestion || "");
    const explanation = suggestionResult.explanation || "";

    // Save as pending suggestion
    const { addDocuments } = require("../vector-store.js");
    addDocuments([{
      id: `urn:reply:suggestion:${Date.now()}`,
      text: suggestion,
      source: "agent_suggestion",
      path: `suggestion://${handle}`,
      is_annotated: false
    }]).catch(e => console.error("Failed to save suggestion:", e.message));

    writeJson(res, 200, { suggestion, explanation });
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
    snippets: snippets.map(snippetShapeForSuggestReply)
  });
}

module.exports = {
  serveSuggest,
  serveSuggestReply,
  snippetShapeForSuggestReply
};
