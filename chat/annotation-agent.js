const { Ollama } = require('ollama');
const ollama = new Ollama();
const { getUnannotatedDocuments, annotateDocument } = require('./vector-store.js');

const MODEL = process.env.REPLY_ANNOTATION_MODEL || "llama3.2:3b";
const MAX_DOCS_PER_RUN = parseInt(process.env.REPLY_ANNOTATION_LIMIT || "50", 10);

const PROMPT_TEMPLATE = `
You are an expert knowledge annotator.
Analyze the following text snippet and extract structured metadata.

Rules:
1. "tags": Array of 1-5 short keywords (e.g. "project planning", "recipe", "tax 2024").
2. "summary": A concise 1-sentence summary of what this text is about.
3. "facts": Array of up to 3 specific, durable facts mentioned (e.g. "John likes coffee", "Server IP is 10.0.0.1"). Keep it empty if none exist.

Respond ONLY with valid JSON. Do not include markdown formatting or explanations.

Text Snippet:
"{TEXT}"

JSON Format Example:
{
  "tags": ["..."],
  "summary": "...",
  "facts": ["..."]
}
`;

async function annotateBatch() {
    console.log(`Fetching up to ${MAX_DOCS_PER_RUN} unannotated documents...`);
    const docs = await getUnannotatedDocuments(MAX_DOCS_PER_RUN);

    if (!docs || docs.length === 0) {
        console.log("No unannotated documents found. Everything is up to date.");
        return;
    }

    console.log(`Found ${docs.length} documents to annotate using model: ${MODEL}`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        console.log(`[${i + 1}/${docs.length}] Annotating document ID: ${doc.id}`);

        try {
            const prompt = PROMPT_TEMPLATE.replace("{TEXT}", doc.text || "");

            const response = await ollama.chat({
                model: MODEL,
                messages: [{ role: 'user', content: prompt }],
                format: 'json',
                options: {
                    temperature: 0.1 // Keep it deterministic
                }
            });

            const content = response.message?.content || "{}";
            let parsed = {};

            try {
                parsed = JSON.parse(content);
            } catch (jsonErr) {
                console.warn(`  Failed to parse JSON from Ollama. Raw output: ${content}`);
                failCount++;
                continue;
            }

            // Normalize fields
            const annotationObj = {
                tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
                summary: typeof parsed.summary === 'string' ? parsed.summary : "",
                facts: Array.isArray(parsed.facts) ? parsed.facts.map(String) : []
            };

            const updated = await annotateDocument(doc.id, annotationObj);

            if (updated) {
                console.log(`  ✓ Annotated. Tags: ${annotationObj.tags.join(', ')}`);
                successCount++;
            } else {
                console.warn(`  ✗ Database update failed for ID: ${doc.id}`);
                failCount++;
            }
        } catch (err) {
            console.error(`  Error processing doc ${doc.id}:`, err.message);
            failCount++;
        }
    }

    console.log(`\nAnnotation run complete. Success: ${successCount}, Failed: ${failCount}.`);
}

if (require.main === module) {
    annotateBatch().catch(err => {
        console.error("Fatal error during annotation run:", err);
        process.exit(1);
    });
}

module.exports = { annotateBatch };
