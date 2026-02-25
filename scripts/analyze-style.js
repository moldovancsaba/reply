const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_FILE = path.join(__dirname, '../training_data.jsonl');
const OUT_FILE = path.join(__dirname, '../chat/data/system_persona.txt');
const OLLAMA_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;

async function analyzeStyle() {
    console.log("Reading dataset...");
    if (!fs.existsSync(DATA_FILE)) {
        console.error("Dataset not found at " + DATA_FILE);
        return;
    }

    const lines = fs.readFileSync(DATA_FILE, 'utf8').trim().split('\n');
    const parsed = lines.map(l => JSON.parse(l));

    // Shuffle
    for (let i = parsed.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [parsed[i], parsed[j]] = [parsed[j], parsed[i]];
    }

    // Select 400 random samples to avoid overwhelming the context window, but give rich style variance.
    const sample = parsed.slice(0, 400);
    console.log(`Analyzing ${sample.length} random conversation pairs...`);

    let promptText = `I am going to provide you with hundreds of examples of my personal text messages.
Your task is to analyze my communication style and generate a strictly formatted "Persona System Prompt" that I can feed to another AI so it can perfectly mimic how I write.

Focus your analysis on:
1. Sentence length and structure.
2. Capitalization and punctuation habits (e.g., do I use proper casing? do I use emojis?).
3. Vocabulary and tone (direct? casual? formal? empathetic?).
4. Greetings and sign-offs (or lack thereof).
5. Preferred shortcuts and colloquialisms.

Output ONLY the final system prompt block. Start directly with: "You are Csaba. You are writing a message to a contact. You must strictly adhere to the following communication style rules:"

### Here are the message examples (Context -> My Reply):
\n`;

    for (const p of sample) {
        promptText += `Context: ${p.context}\nMy Reply: ${p.response}\n\n`;
    }

    const payload = JSON.stringify({
        model: "llama3.2:3b",
        prompt: promptText,
        stream: false,
        options: {
            num_ctx: 32768, // Request large context window
            temperature: 0.3
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

    console.log(`Sending prompt to local llama3.2:3b... (This may take a minute)`);

    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    console.error("API Error:", data);
                    return reject();
                }
                try {
                    const response = JSON.parse(data);
                    if (response.response) {
                        const persona = response.response.trim();
                        // Ensure output dir exists
                        fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
                        fs.writeFileSync(OUT_FILE, persona);
                        console.log("\n✅ Persona successfully generated and saved to:");
                        console.log(OUT_FILE);
                        console.log("\nPreview of generated persona:");
                        console.log(persona.substring(0, 500) + "...\n");
                        resolve();
                    } else {
                        console.error("Empty response");
                        reject();
                    }
                } catch (e) {
                    console.error("Parse Error:", e);
                    reject(e);
                }
            });
        });

        req.on('error', (e) => {
            console.error("HTTP Request Error:", e);
            reject(e);
        });
        req.write(payload);
        req.end();
    });
}

analyzeStyle();
