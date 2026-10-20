"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_MODELS_ROOT = "/Users/Shared/Models";
const DEFAULT_EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";

function normalizeDir(value) {
  return path.resolve(String(value || "").trim());
}

function getModelsRoot() {
  const configured = String(process.env.REPLY_MODELS_ROOT || "").trim();
  return normalizeDir(configured || DEFAULT_MODELS_ROOT);
}

function resolveModelPaths() {
  const modelsRoot = getModelsRoot();
  const cacheRoot = path.join(modelsRoot, ".cache");
  const huggingFaceCache = path.join(cacheRoot, "huggingface");
  const huggingFaceHubCache = path.join(huggingFaceCache, "hub");
  const transformersCache = path.join(huggingFaceCache, "transformers");
  const ollamaModels = path.join(modelsRoot, "ollama", "models");
  const sharedEmbeddingModelDir = path.join(
    modelsRoot,
    "llms",
    "encoders",
    "all-MiniLM-L6-v2",
  );

  return {
    modelsRoot,
    cacheRoot,
    huggingFaceCache,
    huggingFaceHubCache,
    transformersCache,
    ollamaModels,
    sharedEmbeddingModelDir,
    defaultEmbeddingModelId: DEFAULT_EMBEDDING_MODEL_ID,
  };
}

function ensureDirIfMissing(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
}

function applySharedModelEnv() {
  const paths = resolveModelPaths();

  process.env.REPLY_MODELS_ROOT = paths.modelsRoot;
  process.env.OLLAMA_MODELS = process.env.OLLAMA_MODELS || paths.ollamaModels;
  process.env.HF_HOME = process.env.HF_HOME || paths.huggingFaceCache;
  process.env.HF_HUB_CACHE = process.env.HF_HUB_CACHE || paths.huggingFaceHubCache;
  process.env.HUGGINGFACE_HUB_CACHE =
    process.env.HUGGINGFACE_HUB_CACHE || process.env.HF_HUB_CACHE;
  process.env.TRANSFORMERS_CACHE = process.env.TRANSFORMERS_CACHE || paths.transformersCache;
  process.env.XDG_CACHE_HOME = process.env.XDG_CACHE_HOME || paths.cacheRoot;

  ensureDirIfMissing(paths.cacheRoot);
  ensureDirIfMissing(process.env.HF_HOME);
  ensureDirIfMissing(process.env.HF_HUB_CACHE);
  ensureDirIfMissing(process.env.TRANSFORMERS_CACHE);

  return paths;
}

function pathIsInside(child, parent) {
  try {
    const childResolved = normalizeDir(child);
    const parentResolved = normalizeDir(parent);
    return childResolved === parentResolved || childResolved.startsWith(`${parentResolved}${path.sep}`);
  } catch {
    return false;
  }
}

function getEmbeddingModelRef() {
  return DEFAULT_EMBEDDING_MODEL_ID;
}

function getModelStorageStatus() {
  const paths = resolveModelPaths();
  const embeddingModelRef = getEmbeddingModelRef();
  const sharedEmbeddingModelAvailable = fs.existsSync(
    path.join(paths.sharedEmbeddingModelDir, "config.json"),
  );
  const ollamaModelsDir = String(process.env.OLLAMA_MODELS || paths.ollamaModels).trim();
  const huggingFaceCacheDir = String(process.env.HF_HOME || paths.huggingFaceCache).trim();
  const transformersCacheDir = String(
    process.env.TRANSFORMERS_CACHE || paths.transformersCache,
  ).trim();

  return {
    root: paths.modelsRoot,
    rootExists: fs.existsSync(paths.modelsRoot),
    usingSharedRoot: pathIsInside(paths.modelsRoot, DEFAULT_MODELS_ROOT),
    ollamaModelsDir,
    ollamaModelsDirExists: fs.existsSync(ollamaModelsDir),
    ollamaModelsDirShared: pathIsInside(ollamaModelsDir, paths.modelsRoot),
    huggingFaceCacheDir,
    huggingFaceCacheDirExists: fs.existsSync(huggingFaceCacheDir),
    huggingFaceCacheDirShared: pathIsInside(huggingFaceCacheDir, paths.modelsRoot),
    transformersCacheDir,
    transformersCacheDirExists: fs.existsSync(transformersCacheDir),
    transformersCacheDirShared: pathIsInside(transformersCacheDir, paths.modelsRoot),
    embeddingModelRef,
    sharedEmbeddingModelDir: paths.sharedEmbeddingModelDir,
    sharedEmbeddingModelAvailable,
  };
}

module.exports = {
  DEFAULT_MODELS_ROOT,
  DEFAULT_EMBEDDING_MODEL_ID,
  applySharedModelEnv,
  getEmbeddingModelRef,
  getModelStorageStatus,
  getModelsRoot,
  pathIsInside,
  resolveModelPaths,
};
