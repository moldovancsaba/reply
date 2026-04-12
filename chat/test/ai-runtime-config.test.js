const test = require("node:test");
const assert = require("node:assert/strict");

test("resolveOllamaHttpBase prefers OLLAMA_HOST over OLLAMA_PORT", () => {
  const prevHost = process.env.OLLAMA_HOST;
  const prevPort = process.env.OLLAMA_PORT;
  try {
    process.env.OLLAMA_HOST = "http://example:9999/";
    process.env.OLLAMA_PORT = "11434";
    delete require.cache[require.resolve("../ai-runtime-config.js")];
    const { resolveOllamaHttpBase } = require("../ai-runtime-config.js");
    assert.equal(resolveOllamaHttpBase(), "http://example:9999");
  } finally {
    if (prevHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = prevHost;
    if (prevPort === undefined) delete process.env.OLLAMA_PORT;
    else process.env.OLLAMA_PORT = prevPort;
    delete require.cache[require.resolve("../ai-runtime-config.js")];
  }
});

test("resolveOllamaHttpBase falls back to 127.0.0.1:OLLAMA_PORT", () => {
  const prevHost = process.env.OLLAMA_HOST;
  const prevPort = process.env.OLLAMA_PORT;
  try {
    delete process.env.OLLAMA_HOST;
    process.env.OLLAMA_PORT = "11435";
    delete require.cache[require.resolve("../ai-runtime-config.js")];
    const { resolveOllamaHttpBase } = require("../ai-runtime-config.js");
    assert.equal(resolveOllamaHttpBase(), "http://127.0.0.1:11435");
  } finally {
    if (prevHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = prevHost;
    if (prevPort === undefined) delete process.env.OLLAMA_PORT;
    else process.env.OLLAMA_PORT = prevPort;
    delete require.cache[require.resolve("../ai-runtime-config.js")];
  }
});
