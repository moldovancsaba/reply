const fs = require("fs");
const path = require("path");
const { mboxReader } = require("mbox-reader");
const { simpleParser } = require("mailparser");
const { addDocuments } = require("./vector-store.js");

const CHAT_DIR = __dirname;
const REPO_ROOT = path.join(CHAT_DIR, "..");
const DEFAULT_DOCS = path.join(REPO_ROOT, "knowledge", "documents");

const docsPath = process.env.REPLY_KNOWLEDGE_PATH || DEFAULT_DOCS;
const EXT = [".txt", ".md"];
const BATCH_SIZE = 50;

/**
 * Basic argument parsing
 */
const args = process.argv.slice(2);
const mboxIndex = args.indexOf("--mbox");
const mboxPath = mboxIndex !== -1 ? args[mboxIndex + 1] : null;

function walkDir(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, files);
    else if (EXT.includes(path.extname(e.name).toLowerCase())) files.push(full);
  }
  return files;
}

/**
 * Handle local directory ingestion
 */
async function ingestLocalDocs() {
  console.log(`Scanning directory: ${docsPath}`);
  const absoluteDocs = path.isAbsolute(docsPath) ? docsPath : path.resolve(REPO_ROOT, docsPath);
  const fileList = walkDir(absoluteDocs);
  const snippets = [];
  let id = Date.now();

  for (const file of fileList) {
    const rel = path.relative(absoluteDocs, file);
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) continue;
    snippets.push({
      id: `local-${id++}`,
      source: "local",
      path: rel,
      text,
    });
  }

  if (snippets.length > 0) {
    console.log(`Found ${snippets.length} snippets. Adding to vector store...`);
    await addDocuments(snippets);
    console.log("Local ingestion complete.");
  } else {
    console.log("No markdown/text documents found.");
  }
}

/**
 * Handle Mbox ingestion (Scalable Logic)
 */
async function ingestMbox(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`Error: Mbox file not found at ${fullPath}`);
    return;
  }

  console.log(`Ingesting Mbox: ${fullPath}`);
  const stream = fs.createReadStream(fullPath);
  let batch = [];
  let count = 0;
  let totalStored = 0;

  try {
    for await (const msg of mboxReader(stream)) {
      count++;
      try {
        const parsed = await simpleParser(msg.content);
        const text = (parsed.text || parsed.subject || "").trim();

        if (text) {
          batch.push({
            id: `email-${Date.now()}-${count}`,
            source: "mbox",
            path: path.basename(filePath),
            text: `Subject: ${parsed.subject}\nFrom: ${parsed.from?.text}\nDate: ${parsed.date}\n\n${text}`,
          });
        }

        if (batch.length >= BATCH_SIZE) {
          const currentBatch = [...batch];
          batch = [];
          console.log(`Vectorizing batch... (Total emails found: ${count})`);
          await addDocuments(currentBatch);
          totalStored += currentBatch.length;
        }
      } catch (err) {
        console.error(`Error parsing message #${count}:`, err.message);
      }
    }

    if (batch.length > 0) {
      console.log(`Vectorizing final batch of ${batch.length}...`);
      await addDocuments(batch);
      totalStored += batch.length;
    }
    console.log(`Successfully ingested ${totalStored} emails from Mbox.`);
  } catch (err) {
    console.error("Mbox Reader Error:", err.message);
  }
}

async function run() {
  if (mboxPath) {
    await ingestMbox(mboxPath);
  } else {
    await ingestLocalDocs();
  }
}

run().catch(console.error);
