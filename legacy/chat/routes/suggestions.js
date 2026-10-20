const {
  classifyRuntimeFailure,
  generateReply,
  normalizeSuggestionResult,
} = require('../brain-runtime.js');
const contactStore = require("../contact-store.js");
const preparedContextStore = require("../prepared-context-store.js");


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
 * Maps a prepared snippet artifact to the JSON shape returned under `snippets`
 * by the legacy compatibility suggest-reply route.
 * When `is_annotated` is true, includes summary/tags/facts for UI or clients (reply#37).
 * @param {object} doc - Prepared local snippet payload.
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
    let preparedSnippets = [];
    const goldenExamples = preparedContextStore.readPreparedGoldenExamples();

    if (!message) {
      const handles = contactStore.getAllHandles(handle);
      const snapshots = await preparedContextStore.getDraftContextSnapshots(handles);
      const bestSnapshot = snapshots
        .filter((row) => row.latestInboundText)
        .sort((a, b) => Date.parse(String(b.latestInboundTimestamp || 0)) - Date.parse(String(a.latestInboundTimestamp || 0)))[0] || null;
      message = String(bestSnapshot?.latestInboundText || "").trim();
      preparedSnippets = Array.isArray(bestSnapshot?.snippetCandidates) ? bestSnapshot.snippetCandidates : [];
    }

    if (!message) {
      writeJson(res, 422, {
        error: "No prepared inbound context is available for this handle yet.",
        code: "no_inbound_context",
        suggestion: ""
      });
      return;
    }

    const snippets = preparedSnippets.slice(0, 3);

    const suggestionResult = normalizeSuggestionResult(
      await generateReply(message, snippets, handle, goldenExamples)
    );
    const suggestion = suggestionResult.suggestion;
    const explanation = suggestionResult.explanation;

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
    const failure = classifyRuntimeFailure(e, { fallbackMessage: "Suggest failed" });
    writeJson(res, failure.status, {
      error: failure.error,
      code: failure.code,
      hint: failure.hint,
      retriable: failure.retriable,
    });
  }
}

/**
 * Legacy compatibility API endpoint: /api/suggest-reply
 * Generates a reply suggestion based on the user's message and local knowledge snippets.
 * The current primary product drafting route is `/api/suggest`.
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
  if (!String(message || "").trim()) {
    writeJson(res, 400, { error: "Missing message" });
    return;
  }

  let snippets = [];
  if (recipient) {
    const handles = contactStore.getAllHandles(recipient);
    const snapshots = await preparedContextStore.getDraftContextSnapshots(handles);
    const bestSnapshot = snapshots
      .filter((row) => Array.isArray(row.snippetCandidates) && row.snippetCandidates.length > 0)
      .sort((a, b) => Date.parse(String(b.latestInboundTimestamp || 0)) - Date.parse(String(a.latestInboundTimestamp || 0)))[0] || null;
    snippets = Array.isArray(bestSnapshot?.snippetCandidates) ? bestSnapshot.snippetCandidates.slice(0, 3) : [];
  }
  const goldenExamples = preparedContextStore.readPreparedGoldenExamples();

  // Generate a suggested reply using the local LLM.
  try {
    const suggestionResult = normalizeSuggestionResult(
      await generateReply(message, snippets, recipient, goldenExamples)
    );
    const suggestion = suggestionResult.suggestion;

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
      explanation: suggestionResult.explanation,
      contact: contact ? { displayName: contact.displayName, profession: contact.profession } : null,
      snippets: snippets.map(snippetShapeForSuggestReply)
    });
  } catch (e) {
    console.error("Suggest reply error:", e);
    const failure = classifyRuntimeFailure(e, { fallbackMessage: "Suggest failed" });
    writeJson(res, failure.status, {
      error: failure.error,
      code: failure.code,
      hint: failure.hint,
      retriable: failure.retriable,
    });
  }
}

module.exports = {
  serveSuggest,
  serveSuggestReply,
  snippetShapeForSuggestReply
};
