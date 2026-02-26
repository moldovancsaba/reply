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
    return { suggestion: "Please provide a message to reply to.", explanation: "" };
  }

  // 1. Get Stylistic Context & System Instructions
  const context = await getContext(recipient);
  const { styleInstructions, history, identityContext } = context;
  const mergedGoldenExamples = [...(goldenExamples || []), ...(context.goldenExamples || [])];

  // 2. Load the Holy Grail Persona
  const persona = getPersona();

  // 3. Dynamic RAG: Fetch examples
  let ragExamplesText = "";
  try {
    const results = await search(message, 20);
    const myMessages = results
      .filter(r => r.text && r.text.includes('] Me: '))
      .slice(0, 4);

    if (myMessages.length > 0) {
      ragExamplesText = "\n\n### RAG Context (Past messages sent by me):\n" +
        myMessages.map(m => `- "${m.text.split('] Me: ')[1] || m.text}"`).join('\n');
    }
  } catch (e) {
    console.error("reply-engine RAG fetch failed:", e.message);
  }

  // 4. Construct context string
  const contextText = contextSnippets
    .map((s) => `[Source: ${s.path}]\n${s.text}`)
    .join("\n\n---\n\n");

  // 5. Construct Golden Examples
  let goldenText = "";
  if (mergedGoldenExamples && mergedGoldenExamples.length > 0) {
    goldenText = "\nGOLDEN EXAMPLES (Mimic this short, concise style):\n" +
      mergedGoldenExamples.map((g, i) => `Ex ${i + 1}: "${g.text}"`).join("\n");
  }

  // --- AGENT 1: THE ANALYZER ---
  const analyzerPrompt = `${persona}
${styleInstructions || ""}
${identityContext || ""}
${history || ""}
${goldenText}
${ragExamplesText}

Based on the knowledge base and history, analyze how to best reply to the message below.
Draft a response that is helpful and factually correct based ONLY on the provided context.
Also, provide a brief explanation of why you chose this response (tone, language, historical context).

CONTEXT:
${contextText || "No relevant notes discovered."}

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
