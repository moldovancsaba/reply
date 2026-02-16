const https = require('https');

/**
 * Client for Google's Gemini API.
 * Requires GOOGLE_API_KEY environment variable.
 */

const MODEL = "gemini-flash-latest"; // Efficient Flash model

/**
 * Refines a drafted reply using Gemini.
 * @param {string} draft - The initial draft from the local LLM.
 * @param {string} context - The context used to generate the draft (optional).
 * @returns {Promise<string>} - The refined text.
 */
async function refineReply(draft, context = "") {
    const API_KEY = process.env.GOOGLE_API_KEY;

    if (!API_KEY) {
        throw new Error("Missing GOOGLE_API_KEY environment variable.");
    }

    const systemPrompt = `You are an expert executive communications coach.
Your goal is to refine the following draft email reply.
- Improve clarity, tone, and grammar.
- Make it sound professional but not stiff.
- Preserve the original meaning and key details.
- Do NOT add filler like "Here is a refined version". Just output the text.`;

    const userPrompt = `DRAFT:
"${draft}"

CONTEXT (For reference only):
${context.substring(0, 1000)}...

REFINED VERSION:`;

    const payload = JSON.stringify({
        contents: [{
            parts: [{ text: systemPrompt + "\n\n" + userPrompt }]
        }]
    });

    const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Gemini API Error: ${res.statusCode} ${data}`));
                    return;
                }
                try {
                    const response = JSON.parse(data);
                    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                        resolve(text.trim());
                    } else {
                        reject(new Error("Empty response from Gemini."));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(payload);
        req.end();
    });
}

/**
 * Simple connection test to verify API key.
 */
async function testConnection() {
    try {
        const result = await refineReply("Hello world", "Test context");
        return { success: true, message: "Connected!", sample: result };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

module.exports = { refineReply, testConnection };
