/**
 * Reply POC — load knowledge store and query snippets by keyword.
 * Used by the chat server to add "how I act" context to suggestions.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const DEFAULT_STORE = path.join(REPO_ROOT, "knowledge", "store.json");

let cached = null;

function getStorePath() {
  const raw = process.env.REPLY_KNOWLEDGE_STORE || DEFAULT_STORE;
  return path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
}

function load() {
  if (cached) return cached;
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    cached = { snippets: [] };
    return cached;
  }
  try {
    const data = JSON.parse(fs.readFileSync(storePath, "utf8"));
    cached = data.snippets ? { snippets: data.snippets } : { snippets: [] };
  } catch {
    cached = { snippets: [] };
  }
  return cached;
}

/**
 * Return up to max snippets that contain any of the words in the query (case-insensitive).
 */
function getSnippets(query, max = 5) {
  if (!query || typeof query !== "string") return [];
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const { snippets } = load();
  const out = [];
  for (const s of snippets) {
    const t = (s.text || "").toLowerCase();
    if (words.some((w) => t.includes(w))) {
      out.push(s);
      if (out.length >= max) break;
    }
  }
  return out;
}

module.exports = { load, getSnippets, getStorePath };
