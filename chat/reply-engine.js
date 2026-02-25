const { Ollama } = require('ollama');
const { getContext } = require('./context-engine.js');
const { search } = require('./vector-store.js');
const fs = require('fs');
const path = require('path');

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
    return "Please provide a message to reply to.";
  }

  // 1. Get Stylistic Context & System Instructions
  const context = await getContext(recipient);
  const { styleInstructions, history, identityContext } = context;
  const mergedGoldenExamples = [...(goldenExamples || []), ...(context.goldenExamples || [])];

  // 2. Load the Holy Grail Persona
  const persona = getPersona();

  // 3. Dynamic RAG: Fetch examples of how Csaba writes about this topic
  let ragExamplesText = "";
  try {
    const results = await search(message, 20);
    const myMessages = results
      .filter(r => r.text && r.text.includes('] Me: '))
      .slice(0, 4); // Take top 4 examples

    if (myMessages.length > 0) {
      ragExamplesText = "\n\n### RAG Context (Use these past messages sent by me to perfectly mimic my tone & vocabulary):\n" +
        myMessages.map(m => `- "${m.text.split('] Me: ')[1] || m.text}"`).join('\n');
    }
  } catch (e) {
    console.error("reply-engine RAG fetch failed:", e.message);
  }

  // 4. Construct context string from snippets
  const contextText = contextSnippets
    .map((s) => `[Source: ${s.path}]\n${s.text}`)
    .join("\n\n---\n\n");

  // 5. Construct Golden Examples
  let goldenText = "";
  if (mergedGoldenExamples && mergedGoldenExamples.length > 0) {
    goldenText = "\nHere are GOLDEN EXAMPLES of how you should talk and structure your messages. Mimic this short, concise style perfectly:\n\n" +
      mergedGoldenExamples.map((g, i) => `Example ${i + 1}:\n"${g.text}"`).join("\n\n");
  }

  const prompt = `${persona}
${styleInstructions || ""}
${identityContext || ""}
${history || ""}
${goldenText}
${ragExamplesText}

The Identity Context and Local Intelligence (if present) are the most reliable source of facts.
Prioritize them above the general knowledge snippets if there is any conflict.
Only use facts that appear in the provided context; do not invent personal details.
Never mention that you used notes, profiles, or "context" in the draft.

Based on the knowledge below (my notes/emails), draft a reply to the incoming message.

CONTEXT FROM KNOWLEDGE BASE:
${contextText || "No relevant notes found."}

INCOMING MESSAGE:
"${message}"

DRAFT REPLY (Text only, no conversational filler):`;

  try {
    const response = await ollama.chat({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.message.content;
  } catch (error) {
    console.error("Error connecting to Ollama:", error);
    return `Error generating reply: ${error.message}. Is Ollama running?`;
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
