const { Ollama } = require('ollama');
const { assembleReplyContext } = require('./context-engine.js');
const { search, getGoldenExamples, getHistory } = require('./vector-store.js');
const fs = require('fs');
const path = require('path');
const hatori = require('./hatori-client.js');
const contactStore = require('./contact-store.js');

/**
 * Extract the last N messages for a conversation handle from LanceDB.
 * Returns a simplified array of { role, text, date } for the {hatori} thread_context.
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
      .reverse(); // chronological order for {hatori}
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
    if (/[😀😅😂🤣😊❤️👍]/.test(t) || /\b(xd|lol|haha|köszi|koszi|szia)\b/.test(t)) informal += 1;
    if (/\b(tisztelettel|köszönöm|udvozlettel|regards|dear|best regards)\b/.test(t)) formal += 1;
  }
  if (informal > formal + 1) return 'friendly';
  if (formal > informal + 1) return 'formal';
  return 'balanced';
}

// Using default localhost:11434
const ollama = new Ollama();
const MODEL = "llama3.2:3b"; // Upgraded to the new primary model

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
  if (!message || typeof message !== "string") {
    return { suggestion: "Please provide a message to reply to.", explanation: "" };
  }

  // OPTION: Route to Hatori if enabled
  if (process.env.REPLY_USE_HATORI === '1') {
    try {
      console.log(`[Hatori] Routing logic for ${recipient || 'unknown'}...`);
      // Build the stateless thread_context payload so {hatori} has guaranteed
      // accurate conversation history without relying on its own replicated DB.
      const thread_context = await buildThreadContext(recipient, 50);
      const identifiedLanguage = detectDominantLanguage(thread_context, message);
      const toneProfile = inferToneProfile(thread_context);
      const externalRequestId = `reply:req:${recipient || 'general'}:${Buffer.from(message).toString('base64').slice(0, 48)}`;
      const response = await hatori.getResponse({
        conversation_id: `reply:${recipient || 'general'}`,
        message_id: `reply:msg-${Date.now()}`,
        sender_id: `reply:${recipient || 'unknown'}`,
        message: message,
        thread_context,
        external_request_id: externalRequestId,
        metadata: {
          platform: 'reply-poc',
          context_messages: thread_context.length,
          identified_language: identifiedLanguage,
          language_hint: identifiedLanguage,
          tone_profile: toneProfile,
          omnichannel: true,
        }
      });

      return {
        suggestion: response.assistant_message,
        explanation: `Generated by {hatori} (${response.language}). Sources: ${response.sources?.join(', ') || 'N/A'}. ID: ${response.assistant_interaction_id}`,
        hatori_id: response.assistant_interaction_id // Useful for outcome reporting
      };
    } catch (e) {
      console.warn(`[Hatori] Integration failed, falling back to local Ollama pipeline:`, e.message);
    }
  }

  // 1. Get Unified Context Bundle
  const context = await assembleReplyContext(message, recipient);
  const { identity, tone, history, facts } = context;

  // Combine golden examples from all sources
  const allGolden = [
    ...(goldenExamples || []),
    ...(context.goldenExamples || [])
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
${facts || contextSnippets.map((s) => `[Source: ${s.path}]\n${s.text}`).join("\n\n---\n\n") || "No relevant notes discovered."}

INCOMING MESSAGE:
"${message}"

OUTPUT FORMAT: JSON with "draft" and "explanation" fields.
JSON:`;

  try {
    const analyzerResponse = await ollama.chat({
      model: MODEL,
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

    // --- AGENT 2: THE COPYWRITER ---
    const copywriterPrompt = `You are a professional copywriter specialized in a concise, "Csaba Style" communication.
Your task is to take a draft reply and refine it to be as short, direct, and impactful as possible.
Remove all conversational filler (e.g., "I hope you are well", "Here's the information").
Use the language of the draft (Hungarian or English).

DRAFT:
"${analyzerResult.draft}"

REPLY (Text only, 1-2 sentences max, no filler):`;

    const copywriterResponse = await ollama.chat({
      model: MODEL,
      messages: [{ role: 'user', content: copywriterPrompt }]
    });

    const finalSuggestion = copywriterResponse.message.content.trim().replace(/^"(.*)"$/, '$1');

    return {
      suggestion: finalSuggestion,
      explanation: analyzerResult.explanation || ""
    };

  } catch (error) {
    console.error("Error in two-agent pipeline:", error);
    return {
      suggestion: `Error: ${error.message}`,
      explanation: "Ollama communication failed."
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
    const response = await ollama.chat({
      model: MODEL,
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

module.exports = { generateReply, extractKYC };
