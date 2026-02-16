/**
 * Reply POC — ingest local .txt/.md files into the knowledge store.
 * Run from repo root: node chat/ingest.js
 * Or from chat/: node ingest.js
 *
 * Set REPLY_KNOWLEDGE_PATH to override the documents folder (default: ../knowledge/documents when run from chat/).
 * Set REPLY_KNOWLEDGE_STORE to override the output file (default: ../knowledge/store.json).
 */

const fs = require("fs");
const path = require("path");

const CHAT_DIR = __dirname;
const REPO_ROOT = path.join(CHAT_DIR, "..");

const DEFAULT_DOCS = path.join(REPO_ROOT, "knowledge", "documents");
const DEFAULT_STORE = path.join(REPO_ROOT, "knowledge", "store.json");

const docsPath = process.env.REPLY_KNOWLEDGE_PATH || DEFAULT_DOCS;
const storePath = process.env.REPLY_KNOWLEDGE_STORE || DEFAULT_STORE;

const EXT = [".txt", ".md"];

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

function ingest() {
  const absoluteDocs = path.isAbsolute(docsPath) ? docsPath : path.resolve(REPO_ROOT, docsPath);
  const absoluteStore = path.isAbsolute(storePath) ? storePath : path.resolve(REPO_ROOT, storePath);

  const fileList = walkDir(absoluteDocs);
  const snippets = [];
  let id = 0;
  for (const file of fileList) {
    const rel = path.relative(absoluteDocs, file);
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) continue;
    snippets.push({
      id: String(++id),
      source: "local",
      path: rel,
      text,
    });
  }

  const storeDir = path.dirname(absoluteStore);
  if (!fs.existsSync(storeDir)) fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(absoluteStore, JSON.stringify({ snippets, ingestedAt: new Date().toISOString() }, null, 2), "utf8");

  console.log(`Ingested ${snippets.length} file(s) from ${absoluteDocs} -> ${absoluteStore}`);
}

ingest();
