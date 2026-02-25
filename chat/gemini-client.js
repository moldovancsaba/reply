const http = require('http');
const fs = require('fs');
const path = require('path');
const { search } = require('./vector-store.js');

/**
 * Client for local drafting via Ollama (Replaces Gemini API for privacy/cost).
 * No external API key required.
 */

// We use Gemma2:2b as it is blazing fast and excellent at text refinement
const MODEL = "gemma2:2b";
const OLLAMA_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;

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
    return cachedPersona || "You are an expert executive communications coach.";
}

/**
 * Refines a drafted reply using local Gemma2:2b via Ollama.
 * @param {string} draft - The initial draft.
 * @param {string} context - The context used to generate the draft (optional).
 * @returns {Promise<string>} - The refined text.
 */
async function refineReply(draft, context = "") {
    const basePersona = getPersona();

    // Dynamic RAG: Fetch examples of how Csaba writes about this topic
    let ragExamples = "";
    try {
        const query = (draft || "") + " " + (context || "");
        if (query.trim().length > 3) {
            const results = await search(query, 20);

            // Filter only messages successfully sent by Me
            const myMessages = results
                .filter(r => r.text && r.text.includes('] Me: '))
                .slice(0, 4); // Take top 4 examples

            if (myMessages.length > 0) {
                ragExamples = "\n\n### RAG Examples (Use these past messages to mimic my exact tone & vocabulary):\n" +
                    myMessages.map(m => `- "${m.text.split('] Me: ')[1] || m.text}"`).join('\n');
            }
        }
    } catch (e) {
        console.error("RAG fetch failed:", e.message);
    }

    const systemPrompt = basePersona + ragExamples + `\n\nFinal Instructions:
- Rewrite the DRAFT below using the EXACT style described in your persona.
- If RAG Examples are provided, heavily rely on their tone, length, and vocabulary.
- Output ONLY the rewritten text. No preambles, no explanations, no quotes.`;

    const userPrompt = `DRAFT:
"${draft}"

CONTEXT:
${context.substring(0, 1000)}...

REFINED VERSION:`;

    const payload = JSON.stringify({
        model: MODEL,
        system: systemPrompt,
        prompt: userPrompt,
        stream: false,
        options: {
            temperature: 0.3 // Keep it focused and deterministic
        }
    });

    const options = {
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: '/api/generate',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Ollama Local API Error: ${res.statusCode} ${data}`));
                    return;
                }
                try {
                    const response = JSON.parse(data);
                    if (response.response) {
                        resolve(response.response.trim());
                    } else {
                        reject(new Error("Empty response from local drafting model."));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', (e) => {
            if (e.code === 'ECONNREFUSED') {
                reject(new Error("Ollama is not running locally. Please start Ollama to use the Refine feature."));
            } else {
                reject(e);
            }
        });
        req.write(payload);
        req.end();
    });
}

/**
 * Simple connection test to verify local Ollama model is available.
 */
async function testConnection() {
    try {
        const result = await refineReply("Hello world", "Test context");
        return { success: true, message: "Connected to local Gemma2!", sample: result };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

module.exports = { refineReply, testConnection };
