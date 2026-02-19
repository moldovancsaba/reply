/**
 * Reply POC — query snippets from vector store.
 * Used by the chat server to add "how I act" context to suggestions.
 */

const { search } = require("./vector-store.js");

/**
 * Return up to max snippets that are semantically similar to the query.
 * @returns {Promise<Array>}
 */
async function getSnippets(query, max = 5) {
  if (!query || typeof query !== "string") return [];

  try {
    // Vector store search returns [{ text, source, path, score, ... }]
    const results = await search(query, max);
    return results.map(r => ({
      text: r.text,
      source: r.source,
      path: r.path,
      score: r.score // Useful for debugging or filtering
    }));
  } catch (err) {
    console.error("Error retrieving snippets:", err);
    return [];
  }
}

module.exports = { getSnippets };
