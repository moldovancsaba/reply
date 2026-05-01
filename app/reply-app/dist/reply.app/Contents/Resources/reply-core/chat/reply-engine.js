const { Ollama } = require('ollama');
const { getReplyOllamaModel } = require('./ollama-model.js');
const { resolveOllamaHttpBase } = require('./ai-runtime-config.js');
const { assembleReplyContext, enrichAnnotatedDocText } = require('./context-engine.js');
const { search, getGoldenExamples, getHistory } = require('./vector-store.js');
const fs = require('fs');
const path = require('path');
const contactStore = require('./contact-store.js');

/**
 * Extract the last N messages for a conversation handle from LanceDB.
 * Returns a simplified array of { role, text, date } for local prompt assembly.
 */
async function buildThreadContext(handle, limit = 15) {
  try {
    if (!handle) return [];
    const handles = contactStore.getAllHandles(handle);
    const prefixes = handles.flatMap(h => [`imessage://${h}`, `whatsapp://${h}`, `email://${h}`, h]);
    const unique = [...new Set(prefixes)];
    const batches = await Promise.all(unique.map(p => getHistory(p).catch(() => [])));
    const all = batches.flat();
    return all
      .map(d => {
        const isMe = (d.text || '').includes('] Me:');
        const dateRaw = d.text && d.text.match(/\[(\d{4}-\d{2}-\d{2}[^\]]+)\]/);
        const date = dateRaw ? dateRaw[1] : null;
        const stripped = (d.text || '').replace(/^\[[^\]]+\]\s*(Me|\S+):?\s*/i, '').trim();
        return {
          role: isMe ? 'me' : 'contact',
          text: stripped,
          date,
          channel: (d.channel || d.source || '').toString().toLowerCase()
        };
      })
      .filter(m => m.text)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, limit)
      .reverse();
  } catch (e) {
    console.warn('[reply-engine] buildThreadContext failed:', e.message);
    return [];
  }
}

module.exports.buildThreadContext = buildThreadContext;

function detectLanguageHeuristic(text) {
  const sample = String(text || '').toLowerCase();
  if (!sample.trim()) return 'en';
  if (/[áéíóöőúüű]/.test(sample) || /\b(szia|köszi|koszi|vagy|hogy|nem|igen|majd|és|de)\b/.test(sample)) return 'hu';
  if (/[äöüß]/.test(sample) || /\b(und|nicht|bitte|danke|ja|nein)\b/.test(sample)) return 'de';
  if (/[ñ¿¡]/.test(sample) || /\b(hola|gracias|por|favor|que|como)\b/.test(sample)) return 'es';
  return 'en';
}

function detectDominantLanguage(threadContext, fallbackText = '') {
  const counts = new Map();
  const push = (code) => counts.set(code, (counts.get(code) || 0) + 1);
  const arr = Array.isArray(threadContext) ? threadContext : [];
  for (const m of arr.slice(-40)) {
    const code = detectLanguageHeuristic(m?.text || '');
    push(code);
  }
  if (fallbackText) push(detectLanguageHeuristic(fallbackText));
  let best = 'en';
  let bestN = -1;
  for (const [k, v] of counts.entries()) {
    if (v > bestN) {
      best = k;
      bestN = v;
    }
  }
  return best;
}

function inferToneProfile(threadContext) {
  const arr = Array.isArray(threadContext) ? threadContext : [];
  if (!arr.length) return 'neutral';
  let informal = 0;
  let formal = 0;
  for (const m of arr.slice(-40)) {
    const t = String(m?.text || '').toLowerCase();
    if (!t) continue;
    if (/(😀|😅|😂|🤣|😊|❤️|👍)/u.test(t) || /\b(xd|lol|haha|köszi|koszi|szia)\b/.test(t)) informal += 1;
    if (/\b(tisztelettel|köszönöm|udvozlettel|regards|dear|best regards)\b/.test(t)) formal += 1;
  }
  if (informal > formal + 1) return 'friendly';
  if (formal > informal + 1) return 'formal';
  return 'balanced';
}

// Ollama: host from OLLAMA_HOST / Settings (see ai-runtime-config); model from REPLY_OLLAMA_MODEL.
function getOllamaClient() {
  return new Ollama({ host: resolveOllamaHttpBase() });
}

function getOllamaModel() {
  return getReplyOllamaModel();
}

/** Some small models return nested objects for `draft` under JSON mode; normalize for the copywriter. */
function normalizeAnalyzerDraftField(draft) {
  if (draft == null) return "";
  if (typeof draft === "string") return draft;
  if (typeof draft === "object") {
    if (typeof draft.response === "string") return draft.response;
    if (typeof draft.text === "string") return draft.text;
    if (typeof draft.draft === "string") return draft.draft;
  }
  return "";
}

let cachedPersona = null;
function getPersona() {
  if (!cachedPersona) {
    try {
      const file = path.join(__dirname, 'data', 'system_persona.txt');
      if (fs.existsSync(file)) {
        cachedPersona = fs.readFileSync(file, 'utf8');
      }
    } catch (e) { }
  }
  return cachedPersona || "";
}

async function generateReply(message, contextSnippets = [], recipient = null, goldenExamples = []) {
  if (!message || typeof message !== "string" || !String(message).trim()) {
    return { suggestion: "", explanation: "", code: "no_message" };
  }

  // 1. Get Unified Context Bundle
  const context = await assembleReplyContext(message, recipient);
  const contextMeta = context.meta || null;
  const { identity, tone, history, facts, goldenExamples: ctxGolden } = context;

  // Combine golden examples from all sources
  const allGolden = [
    ...(goldenExamples || []),
    ...(ctxGolden || [])
  ];

  // 2. Load the Holy Grail Persona
  const persona = getPersona();

  // 3. Dynamic RAG: Style examples (fetch specifically for "Me" style)
  let ragStyleText = "";
  try {
    const results = await search(message, 15);
    const myStyleExamples = results
      .filter(r => r.text && r.text.includes('] Me: '))
      .slice(0, 4);

    if (myStyleExamples.length > 0) {
      ragStyleText = "\n\n### STYLISTIC EXAMPLES (My past replies to mimic):\n" +
        myStyleExamples.map(m => `- "${m.text.split('] Me: ')[1] || m.text}"`).join('\n');
    }
  } catch (e) {
    console.error("reply-engine style RAG failed:", e.message);
  }

  // 4. Construct Golden Examples String
  let goldenText = "";
  if (allGolden.length > 0) {
    goldenText = "\nGOLDEN EXAMPLES (Mimic this short, concise style):\n" +
      allGolden.slice(0, 5).map((g, i) => `Ex ${i + 1}: "${g.text}"`).join("\n");
  }

  // --- AGENT 1: THE ANALYZER ---
  const analyzerPrompt = `${persona}
${tone || ""}
${identity || ""}
${history || ""}
${goldenText}
${ragStyleText}

Based on the knowledge base and history, analyze how to best reply to the message below.
Draft a response that is helpful and factually correct based ONLY on the provided context.
Also, provide a brief explanation of why you chose this response (tone, language, historical context).

CONTEXT (Factual Snippets):
${facts || contextSnippets.map((s) => `[Source: ${s.path}]\n${enrichAnnotatedDocText(s)}`).join("\n\n---\n\n") || "No relevant notes discovered."}

INCOMING MESSAGE:
"${message}"

OUTPUT FORMAT: JSON with "draft" and "explanation" fields.
JSON:`;

  try {
    const analyzerResponse = await getOllamaClient().chat({
      model: getOllamaModel(),
      messages: [{ role: 'user', content: analyzerPrompt }],
      format: 'json'
    });

    let analyzerResult;
    try {
      analyzerResult = JSON.parse(analyzerResponse.message.content);
    } catch (e) {
      // Fallback if JSON fails
      analyzerResult = { draft: analyzerResponse.message.content, explanation: "Direct response generated." };
    }

    const draftStr = normalizeAnalyzerDraftField(analyzerResult.draft);
    if (draftStr) {
      analyzerResult.draft = draftStr;
    } else if (typeof analyzerResult.draft !== "string") {
      analyzerResult.draft =
        typeof analyzerResponse.message.content === "string"
          ? analyzerResponse.message.content
          : "";
    }

    // --- AGENT 2: THE COPYWRITER ---
    const copywriterPrompt = `You are a professional copywriter specialized in a concise, "Csaba Style" communication.
Your task is to take a draft reply and refine it to be as short, direct, and impactful as possible.
Remove all conversational filler (e.g., "I hope you are well", "Here's the information").
Use the language of the draft (Hungarian or English).

DRAFT:
"${analyzerResult.draft}"

REPLY (Text only, 1-2 sentences max, no filler):`;

    const copywriterResponse = await getOllamaClient().chat({
      model: getOllamaModel(),
      messages: [{ role: 'user', content: copywriterPrompt }]
    });

    const finalSuggestion = copywriterResponse.message.content.trim().replace(/^"(.*)"$/, '$1');

    return {
      suggestion: finalSuggestion,
      explanation: analyzerResult.explanation || "",
      contextMeta
    };

  } catch (error) {
    console.error("Error in two-agent pipeline:", error);
    return {
      suggestion: "",
      explanation: error.message || "Ollama communication failed.",
      code: "agent_error",
      contextMeta
    };
  }
}

async function extractKYC(message) {
  if (!message || typeof message !== "string") return null;

  const prompt = `
Analyze the following message and extract any NEW personal information about the sender (who is NOT me).
Look for:
- Profession/Job
- Relationship to me (e.g. wife, daughter, boss)
- Significant notes (e.g. "prefers concise emails", "has a cat named Luna", "just moved to London")

Output ONLY a valid JSON object with the fields "profession", "relationship", and "notes". 
If no info is found for a field, leave it as null.
DO NOT include any other text.

MESSAGE:
"${message}"

JSON OUTPUT:`;

  try {
    const response = await getOllamaClient().chat({
      model: getOllamaModel(),
      messages: [{ role: 'user', content: prompt }],
      format: 'json' // Ensure JSON output if supported by model/library
    });

    let result = response.message.content;
    // Basic cleanup in case model didn't follow format strictly
    if (result.includes("```json")) {
      result = result.split("```json")[1].split("```")[0].trim();
    } else if (result.includes("```")) {
      result = result.split("```")[1].split("```")[0].trim();
    }

    return JSON.parse(result);
  } catch (error) {
    console.error("Error in extractKYC:", error);
    return null;
  }
}

module.exports = { generateReply, extractKYC, getOllamaModel };
