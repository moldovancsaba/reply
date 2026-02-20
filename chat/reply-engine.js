const { Ollama } = require('ollama');
const { getContext } = require('./context-engine.js');

// Using default localhost:11434
const ollama = new Ollama();
const MODEL = "qwen2.5:7b";

async function generateReply(message, contextSnippets = [], recipient = null, goldenExamples = []) {
  if (!message || typeof message !== "string") {
    return "Please provide a message to reply to.";
  }

  // 1. Get Stylistic Context & System Instructions
  const { styleInstructions, history, identityContext } = await getContext(recipient);

  // 2. Construct context string from snippets
  const contextText = contextSnippets
    .map((s) => `[Source: ${s.path}]\n${s.text}`)
    .join("\n\n---\n\n");

  // 3. Construct Golden Examples
  let goldenText = "";
  if (goldenExamples && goldenExamples.length > 0) {
    goldenText = "\nHere are GOLDEN EXAMPLES of how you should talk and structure your messages. Mimic this short, concise style perfectly:\n\n" +
      goldenExamples.map((g, i) => `Example ${i + 1}:\n"${g.text}"`).join("\n\n");
  }

  const prompt = `${styleInstructions}
${identityContext || ""}
${history || ""}
${goldenText}

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
