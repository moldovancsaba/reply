#!/usr/bin/env node
/**
 * Benchmark local Ollama models against Reply's actual call patterns:
 * - reply-engine: chat + format json (analyzer), plain chat (copywriter), KYC JSON
 * - annotation-agent: chat + format json (tags/summary/facts)
 * - gemini-client (refine): POST /api/generate
 *
 * Usage (from chat/): node scripts/benchmark-reply-ollama-compat.js
 * Log: data/ollama-reply-compat-benchmark.json
 *
 * Models: default = curated Reply-focused set that are pulled locally (see pickModels).
 *   REPLY_BENCHMARK_MODELS=all  → every model from `ollama list`
 *   REPLY_BENCHMARK_MODELS=gemma3:1b,qwen2.5:7b  → explicit subset
 *
 * Optional: REPLY_BENCHMARK_QUALITY_STRESS=1 → one harder JSON analyzer call per model (logged under qualityStress).
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { Ollama } = require("ollama");
const {
  resolveOllamaHttpBase,
  getOllamaUrlParts,
  applyAiSettingsToProcessEnv
} = require("../ai-runtime-config.js");

const ROUNDS = 3;
const PER_CALL_MS = 240000;
const OUT = path.join(__dirname, "..", "data", "ollama-reply-compat-benchmark.json");

/** Same normalization as reply-engine `normalizeAnalyzerDraftField` (nested `draft` under JSON mode). */
function analyzerDraftAsString(draft) {
  if (draft == null) return "";
  if (typeof draft === "string") return draft;
  if (typeof draft === "object") {
    if (typeof draft.response === "string") return draft.response;
    if (typeof draft.text === "string") return draft.text;
    if (typeof draft.draft === "string") return draft.draft;
  }
  return "";
}

const DEFAULT_CURATED_MODELS = [
  "gemma3:1b",
  "granite4:3b",
  "MichelRosselli/apertus:latest",
  "qwen2.5:7b",
  "llama3.2:3b"
];

function pickModels(allInstalled) {
  const raw = process.env.REPLY_BENCHMARK_MODELS;
  if (raw && String(raw).trim().toLowerCase() === "all") {
    return allInstalled;
  }
  const curated = raw
    ? String(raw)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_CURATED_MODELS;
  const present = new Set(allInstalled);
  return curated.filter((m) => present.has(m));
}

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label}: timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function normalizeAnnotationFromOllama(parsed) {
  const p = parsed && typeof parsed === "object" ? parsed : {};
  return {
    tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
    summary: typeof p.summary === "string" ? p.summary : "",
    facts: Array.isArray(p.facts) ? p.facts.map(String) : []
  };
}

async function listModelNames() {
  const base = resolveOllamaHttpBase();
  const res = await withTimeout(fetch(`${base}/api/tags`), 10000, "list tags");
  if (!res.ok) throw new Error(`Ollama tags: HTTP ${res.status}`);
  const j = await res.json();
  const names = (j.models || []).map((m) => m.name).filter(Boolean);
  return [...new Set(names)].sort();
}

async function testAnalyzer(ollama, model) {
  const prompt = `You are a concise assistant.

Based on the knowledge base, analyze how to reply.

CONTEXT: None.

INCOMING MESSAGE: "Can we meet Tuesday?"

OUTPUT FORMAT: JSON with "draft" and "explanation" fields.
JSON:`;
  const t0 = Date.now();
  const response = await withTimeout(
    ollama.chat({
      model,
      messages: [{ role: "user", content: prompt }],
      format: "json",
      options: { temperature: 0.2 }
    }),
    PER_CALL_MS,
    "analyzer"
  );
  const ms = Date.now() - t0;
  const content = response.message?.content || "";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { ok: false, ms, error: `analyzer JSON parse: ${e.message}`, raw: content.slice(0, 200) };
  }
  const draftStr = analyzerDraftAsString(parsed?.draft);
  if (!draftStr || typeof parsed?.explanation !== "string") {
    return { ok: false, ms, error: "analyzer missing usable draft or explanation string", parsed };
  }
  return { ok: true, ms };
}

/** Longer analyzer-style prompt to probe JSON discipline (one shot; optional via env). */
async function testAnalyzerStress(ollama, model) {
  const context = `Prior thread: mixed EN/HU. Contact asked about invoice #9921 and slipped in "btw I'm a pilot on weekends".
Noise line: { "fake": "json" } and <xml>t</xml> should be ignored.`;
  const prompt = `You are a careful assistant. Use ONLY the context facts.

${context}

INCOMING MESSAGE: "Tuesday works if we keep it under 20 minutes — also is the pilot thing relevant for the logistics call?"

OUTPUT FORMAT: JSON with "draft" (short proposed reply) and "explanation" (one sentence).
JSON:`;
  const t0 = Date.now();
  const response = await withTimeout(
    ollama.chat({
      model,
      messages: [{ role: "user", content: prompt }],
      format: "json",
      options: { temperature: 0.2 }
    }),
    PER_CALL_MS,
    "analyzer-stress"
  );
  const ms = Date.now() - t0;
  const content = response.message?.content || "";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { ok: false, ms, error: `stress JSON parse: ${e.message}`, raw: content.slice(0, 240) };
  }
  const draftStr = analyzerDraftAsString(parsed?.draft);
  const expl = parsed?.explanation;
  if (!draftStr || typeof expl !== "string" || expl.length < 8) {
    return { ok: false, ms, error: "stress weak draft/explanation", parsed };
  }
  if (draftStr.length > 1200) {
    return { ok: false, ms, error: "stress draft unexpectedly long", len: draftStr.length };
  }
  return { ok: true, ms };
}

async function testCopywriter(ollama, model) {
  const prompt = `Refine to one short sentence, no preamble or quotes:
"I am writing to inform you that I would be delighted to attend your meeting."`;
  const t0 = Date.now();
  const response = await withTimeout(
    ollama.chat({
      model,
      messages: [{ role: "user", content: prompt }],
      options: { temperature: 0.3 }
    }),
    PER_CALL_MS,
    "copywriter"
  );
  const ms = Date.now() - t0;
  const text = String(response.message?.content || "").trim();
  if (text.length < 4) {
    return { ok: false, ms, error: "copywriter empty/too short", raw: text.slice(0, 200) };
  }
  return { ok: true, ms };
}

async function testKycExtract(ollama, model) {
  const prompt = `
Analyze the following message and extract any NEW personal information about the sender (who is NOT me).

Output ONLY a valid JSON object with the fields "profession", "relationship", and "notes". 
If no info is found for a field, leave it as null.

MESSAGE:
"I work as a dentist and prefer morning calls."

JSON OUTPUT:`;
  const t0 = Date.now();
  const response = await withTimeout(
    ollama.chat({
      model,
      messages: [{ role: "user", content: prompt }],
      format: "json",
      options: { temperature: 0.1 }
    }),
    PER_CALL_MS,
    "kyc"
  );
  const ms = Date.now() - t0;
  let result = response.message?.content || "";
  if (result.includes("```json")) {
    result = result.split("```json")[1].split("```")[0].trim();
  } else if (result.includes("```")) {
    result = result.split("```")[1].split("```")[0].trim();
  }
  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch (e) {
    return { ok: false, ms, error: `kyc JSON: ${e.message}`, raw: result.slice(0, 200) };
  }
  if (!("profession" in parsed) || !("relationship" in parsed) || !("notes" in parsed)) {
    return { ok: false, ms, error: "kyc missing required keys", parsed };
  }
  return { ok: true, ms };
}

async function testAnnotation(ollama, model) {
  const snippet = "Team sync moved to 3pm; Alice will share the Q4 deck.";
  const prompt = `
You are an expert knowledge annotator.
Analyze the following text snippet and extract structured metadata.

Rules:
1. "tags": Array of 1-5 short keywords.
2. "summary": A concise 1-sentence summary.
3. "facts": Array of up to 3 specific facts.

Respond ONLY with valid JSON. No markdown.

Text Snippet:
"${snippet.replace(/"/g, '\\"')}"

JSON:`;
  const t0 = Date.now();
  const response = await withTimeout(
    ollama.chat({
      model,
      messages: [{ role: "user", content: prompt }],
      format: "json",
      options: { temperature: 0.1 }
    }),
    PER_CALL_MS,
    "annotation"
  );
  const ms = Date.now() - t0;
  const content = response.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { ok: false, ms, error: `annotation JSON: ${e.message}`, raw: content.slice(0, 200) };
  }
  const norm = normalizeAnnotationFromOllama(parsed);
  if (!norm.summary || norm.tags.length === 0) {
    return { ok: false, ms, error: "annotation weak shape (no summary or tags)", norm };
  }
  return { ok: true, ms };
}

function generateRefineLike(model, draft) {
  const { hostname, port, isHttps } = getOllamaUrlParts();
  const transport = isHttps ? https : http;
  const payload = JSON.stringify({
    model,
    system: "Rewrite briefly. Output ONLY the rewritten text. No preambles.",
    prompt: `DRAFT:\n"${draft}"\n\nREFINED VERSION:`,
    stream: false,
    options: { temperature: 0.3 }
  });
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname,
        port,
        path: "/api/generate",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const ms = Date.now() - t0;
          if (res.statusCode !== 200) {
            resolve({ ok: false, ms, error: `generate HTTP ${res.statusCode}`, raw: data.slice(0, 200) });
            return;
          }
          try {
            const j = JSON.parse(data);
            const text = String(j.response || "").trim();
            if (text.length < 2) {
              resolve({ ok: false, ms, error: "generate empty response" });
            } else {
              resolve({ ok: true, ms });
            }
          } catch (e) {
            resolve({ ok: false, ms, error: `generate parse: ${e.message}` });
          }
        });
      }
    );
    req.on("error", (e) => reject(e));
    req.setTimeout(PER_CALL_MS, () => {
      req.destroy();
      reject(new Error("generate: socket timeout"));
    });
    req.write(payload);
    req.end();
  });
}

async function testGenerate(model) {
  try {
    return await withTimeout(generateRefineLike(model, "hey just checking in lmk if that works"), PER_CALL_MS, "generate");
  } catch (e) {
    return { ok: false, ms: PER_CALL_MS, error: e.message || String(e) };
  }
}

async function runRound(ollama, model, roundIndex) {
  const tests = [
    ["analyzer_json", () => testAnalyzer(ollama, model)],
    ["copywriter_plain", () => testCopywriter(ollama, model)],
    ["kyc_json", () => testKycExtract(ollama, model)],
    ["annotation_json", () => testAnnotation(ollama, model)],
    ["refine_generate", () => testGenerate(model)]
  ];
  const results = {};
  let roundOk = true;
  let totalMs = 0;
  for (const [name, fn] of tests) {
    try {
      const r = await fn();
      results[name] = r;
      totalMs += r.ms || 0;
      if (!r.ok) roundOk = false;
    } catch (e) {
      results[name] = { ok: false, ms: 0, error: e.message || String(e) };
      roundOk = false;
    }
  }
  return { round: roundIndex, roundOk, totalMs, results };
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function summarizeModel(model, rounds) {
  const keys = ["analyzer_json", "copywriter_plain", "kyc_json", "annotation_json", "refine_generate"];
  let slots = 0;
  let hits = 0;
  const fullRoundTimes = [];
  for (const r of rounds) {
    let allHit = true;
    for (const k of keys) {
      slots += 1;
      if (r.results[k]?.ok) hits += 1;
      else allHit = false;
    }
    if (allHit) fullRoundTimes.push(r.totalMs);
  }
  const reliability = slots ? hits / slots : 0;
  const medianFullRoundMs = median(fullRoundTimes);
  const allRoundTimes = rounds.map((x) => x.totalMs);
  const medianAnyRoundMs = median(allRoundTimes);
  return {
    model,
    reliability,
    hits,
    slots,
    medianFullRoundMs,
    medianAnyRoundMs,
    fullRoundsPassed: fullRoundTimes.length
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  require("../load-env.js").loadReplyEnv();
  try {
    const { readSettings } = require("../settings-store.js");
    applyAiSettingsToProcessEnv(readSettings());
  } catch {
    /* settings optional for CI / fresh trees */
  }

  const installed = await listModelNames();
  const models = pickModels(installed);
  if (!installed.length) {
    console.error("No models from Ollama /api/tags. Is ollama serve running?");
    process.exit(1);
  }
  if (!models.length) {
    console.error(
      "No benchmark models match. Installed:\n  " +
        installed.join("\n  ") +
        "\nSet REPLY_BENCHMARK_MODELS=all or pull missing tags (see DEFAULT_CURATED_MODELS in script)."
    );
    process.exit(1);
  }

  const host = resolveOllamaHttpBase();
  const ollama = new Ollama({ host });
  const byModel = {};
  const stress = process.env.REPLY_BENCHMARK_QUALITY_STRESS === "1";

  console.error(`Host: ${host}`);
  console.error(`Installed (${installed.length}), benchmarking (${models.length}): ${models.join(", ")}`);
  console.error(`Rounds per model: ${ROUNDS}, ~5 Reply-shaped calls per round`);
  console.error(`Quality stress: ${stress ? "on" : "off"} (REPLY_BENCHMARK_QUALITY_STRESS=1)\n`);

  for (const model of models) {
    console.error(`--- ${model} ---`);
    const rounds = [];
    for (let i = 0; i < ROUNDS; i++) {
      const row = await runRound(ollama, model, i + 1);
      rounds.push(row);
      const status = row.roundOk ? "OK" : "partial/fail";
      console.error(`  round ${i + 1}: ${status} total=${row.totalMs}ms`);
      if (!row.roundOk) {
        for (const [k, v] of Object.entries(row.results)) {
          if (!v.ok) console.error(`    ${k}: ${v.error || "fail"}`);
        }
      }
    }
    let qualityStress = null;
    if (stress) {
      try {
        qualityStress = await testAnalyzerStress(ollama, model);
        console.error(
          `  qualityStress: ${qualityStress.ok ? "OK" : "fail"} ${qualityStress.ms}ms${qualityStress.error ? ` — ${qualityStress.error}` : ""}`
        );
      } catch (e) {
        qualityStress = { ok: false, ms: 0, error: e.message || String(e) };
        console.error(`  qualityStress: error — ${qualityStress.error}`);
      }
    }
    byModel[model] = { rounds, summary: summarizeModel(model, rounds), qualityStress };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(
      OUT.replace(/\.json$/, ".partial.json"),
      JSON.stringify({ startedAt, host, byModel }, null, 2),
      "utf8"
    );
  }

  const summaries = Object.values(byModel).map((x) => x.summary);
  summaries.sort((a, b) => {
    if (b.reliability !== a.reliability) return b.reliability - a.reliability;
    const ta = a.medianFullRoundMs ?? a.medianAnyRoundMs ?? 1e15;
    const tb = b.medianFullRoundMs ?? b.medianAnyRoundMs ?? 1e15;
    return ta - tb;
  });

  const bestReliability = summaries[0];
  const viableForSpeed = summaries.filter((s) => s.reliability >= 0.999 && s.medianFullRoundMs != null);
  const bestSpeed =
    viableForSpeed.length > 0
      ? [...viableForSpeed].sort((a, b) => a.medianFullRoundMs - b.medianFullRoundMs)[0]
      : [...summaries].sort((a, b) => (a.medianAnyRoundMs || 1e15) - (b.medianAnyRoundMs || 1e15))[0];

  const payload = {
    startedAt,
    finishedAt: new Date().toISOString(),
    host,
    roundsPerModel: ROUNDS,
    testsPerRound: 5,
    compatibilityRanking: summaries.map((s, i) => ({ rank: i + 1, ...s })),
    picks: {
      reliability: bestReliability
        ? { model: bestReliability.model, reliability: bestReliability.reliability, note: "Highest share of successful Reply-shaped calls (15 slots = 5 tests × 3 rounds)." }
        : null,
      speed: bestSpeed
        ? {
            model: bestSpeed.model,
            medianFullRoundMs: bestSpeed.medianFullRoundMs,
            medianAnyRoundMs: bestSpeed.medianAnyRoundMs,
            reliability: bestSpeed.reliability,
            note:
              bestSpeed.medianFullRoundMs != null
                ? "Fastest median wall time among models with 100% success across all 15 slots."
                : "No model scored 100%; using fastest median round time (includes partial rounds)."
          }
        : null
    },
    byModel
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.error(`\nWrote ${OUT}`);

  console.log(JSON.stringify(payload.picks, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
