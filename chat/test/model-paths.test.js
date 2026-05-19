const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  DEFAULT_EMBEDDING_MODEL_ID,
  applySharedModelEnv,
  getEmbeddingModelRef,
  getModelStorageStatus,
} = require("../model-paths.js");

test("applySharedModelEnv seeds shared cache paths from REPLY_MODELS_ROOT", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reply-models-root-"));
  const previous = {
    REPLY_MODELS_ROOT: process.env.REPLY_MODELS_ROOT,
    OLLAMA_MODELS: process.env.OLLAMA_MODELS,
    HF_HOME: process.env.HF_HOME,
    HF_HUB_CACHE: process.env.HF_HUB_CACHE,
    HUGGINGFACE_HUB_CACHE: process.env.HUGGINGFACE_HUB_CACHE,
    TRANSFORMERS_CACHE: process.env.TRANSFORMERS_CACHE,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  };

  process.env.REPLY_MODELS_ROOT = tmpRoot;
  delete process.env.OLLAMA_MODELS;
  delete process.env.HF_HOME;
  delete process.env.HF_HUB_CACHE;
  delete process.env.HUGGINGFACE_HUB_CACHE;
  delete process.env.TRANSFORMERS_CACHE;
  delete process.env.XDG_CACHE_HOME;

  try {
    const paths = applySharedModelEnv();
    assert.equal(paths.modelsRoot, tmpRoot);
    assert.equal(process.env.OLLAMA_MODELS, path.join(tmpRoot, "ollama", "models"));
    assert.equal(process.env.HF_HOME, path.join(tmpRoot, ".cache", "huggingface"));
    assert.equal(process.env.HF_HUB_CACHE, path.join(tmpRoot, ".cache", "huggingface", "hub"));
    assert.equal(process.env.TRANSFORMERS_CACHE, path.join(tmpRoot, ".cache", "huggingface", "transformers"));
    assert.equal(process.env.XDG_CACHE_HOME, path.join(tmpRoot, ".cache"));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("getEmbeddingModelRef prefers shared encoder directory when present", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reply-embedding-root-"));
  const previousRoot = process.env.REPLY_MODELS_ROOT;
  const modelDir = path.join(tmpRoot, "llms", "encoders", "all-MiniLM-L6-v2");
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, "config.json"), "{}");
  process.env.REPLY_MODELS_ROOT = tmpRoot;

  try {
    assert.equal(getEmbeddingModelRef(), DEFAULT_EMBEDDING_MODEL_ID);
    const status = getModelStorageStatus();
    assert.equal(status.sharedEmbeddingModelAvailable, true);
    assert.equal(status.sharedEmbeddingModelDir, modelDir);
    assert.equal(status.root, tmpRoot);
  } finally {
    if (previousRoot === undefined) delete process.env.REPLY_MODELS_ROOT;
    else process.env.REPLY_MODELS_ROOT = previousRoot;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("getEmbeddingModelRef falls back to remote model id when shared encoder is absent", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reply-embedding-miss-"));
  const previousRoot = process.env.REPLY_MODELS_ROOT;
  process.env.REPLY_MODELS_ROOT = tmpRoot;

  try {
    assert.equal(getEmbeddingModelRef(), DEFAULT_EMBEDDING_MODEL_ID);
  } finally {
    if (previousRoot === undefined) delete process.env.REPLY_MODELS_ROOT;
    else process.env.REPLY_MODELS_ROOT = previousRoot;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
