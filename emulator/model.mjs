// Gemini client for the emulator: function calling, image and PDF input, retries, usage tracking.
// A scripted model with the same interface is used by the tests (no network).
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const CACHE_DIR = "emulator/.cache";

export function loadEnv(file = ".env.local") {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GeminiModel {
  // models: tried in order; a model whose daily free quota is spent is dropped for the rest of the run.
  constructor({ models = (process.env.EMULATOR_MODELS ?? "gemini-3.5-flash,gemini-3-flash-preview,gemini-2.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite").split(","), apiKey = process.env.GEMINI_API_KEY, minGapMs = 0 } = {}) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set (put it in .env.local)");
    this.models = [...models];
    this.model = this.models[0];
    this.byModel = {};
    this.apiKey = apiKey;
    this.minGapMs = minGapMs;
    this.lastCall = 0;
    this.usage = { calls: 0, input: 0, output: 0, thoughts: 0, cached: 0 };
    this.cache = process.env.EMULATOR_CACHE !== "0";
    this.lastServed = null;
  }

  // Thought signatures belong to the model that wrote them. After a fallback to another model,
  // Gemini 3 accepts the documented placeholder; older models get the field removed.
  prepare(contents, model) {
    if (!this.lastServed || this.lastServed === model) return contents;
    return contents.map((c) => ({ ...c, parts: (c.parts ?? []).filter((p) => !p.thought).map((p) => {
      if (!("thoughtSignature" in p)) return p;
      const { thoughtSignature, ...rest } = p;
      return model.startsWith("gemini-3") ? { ...rest, thoughtSignature: "skip_thought_signature_validator" } : rest;
    }) }));
  }

  // contents: Gemini-format turns; tools: [{name, description, parameters}] (JSON schema subset)
  async generate({ system, contents, tools, temperature = 0.2 }) {
    const body = {
      contents,
      generationConfig: { temperature, thinkingConfig: { thinkingLevel: "low" } },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (tools?.length) body.tools = [{ functionDeclarations: tools }];
    // Identical requests (same instructions, history and tools) replay the stored answer: a re-run
    // repeats the steps already taken for free and spends quota only on new ones.
    const key = createHash("sha256").update(JSON.stringify({ system, contents, tools, temperature })).digest("hex");
    const file = `${CACHE_DIR}/${key}.json`;
    if (this.cache && existsSync(file)) {
      const hit = JSON.parse(readFileSync(file, "utf8"));
      this.usage.cached += 1;
      return { ...hit, cached: true };
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!this.models.length) throw new Error("Gemini: every model in the chain has spent its daily quota");
      this.model = this.models[0];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
      if (!this.model.startsWith("gemini-3")) delete body.generationConfig.thinkingConfig;
      body.contents = this.prepare(contents, this.model);
      const wait = this.lastCall + this.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      let res;
      try {
        res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey }, body: JSON.stringify(body) });
      } catch (e) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 429 || res.status >= 500) {
        const details = data?.error?.details ?? [];
        const perDay = details.some((d) => (d.violations ?? []).some((v) => /PerDay/.test(v.quotaId ?? "")));
        const retry = parseFloat(details.find((d) => d.retryDelay)?.retryDelay ?? "0");
        if (perDay || retry > 120 || res.status === 404) { this.models.shift(); attempt -= 1; continue; }
        await sleep(retry ? (retry + 1) * 1000 : 4000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${data?.error?.message ?? "unknown error"}`);
      const u = data.usageMetadata ?? {};
      this.usage.calls += 1;
      this.byModel[this.model] = (this.byModel[this.model] ?? 0) + 1;
      this.usage.input += u.promptTokenCount ?? 0;
      this.usage.output += u.candidatesTokenCount ?? 0;
      this.usage.thoughts += u.thoughtsTokenCount ?? 0;
      const content = data.candidates?.[0]?.content ?? { role: "model", parts: [] };
      if (!content.role) content.role = "model";
      this.lastServed = this.model;
      const out = {
        content,
        calls: (content.parts ?? []).filter((p) => p.functionCall).map((p) => p.functionCall),
        text: (content.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim(),
        model: this.model,
        finish: data.candidates?.[0]?.finishReason ?? null,
      };
      if (this.cache && (out.calls.length || out.text)) {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(file, JSON.stringify(out));
      }
      return out;
    }
    throw new Error("Gemini: gave up after retries");
  }
}

// Replays scripted responses keyed by agent name; used by tests.
export class ScriptedModel {
  constructor(script) {
    this.script = script; // { agentName: [ {calls:[{name,args}]} | {text} , ... ] }
    this.cursor = {};
    this.model = "scripted";
    this.usage = { calls: 0, input: 0, output: 0, thoughts: 0 };
  }
  async generate({ agent }) {
    const i = (this.cursor[agent] = (this.cursor[agent] ?? -1) + 1);
    const step = this.script[agent]?.[i];
    if (!step) throw new Error(`scripted model: no step ${i} for ${agent}`);
    this.usage.calls += 1;
    const parts = step.calls ? step.calls.map((c) => ({ functionCall: c })) : [{ text: step.text }];
    return { content: { role: "model", parts }, calls: step.calls ?? [], text: step.text ?? "" };
  }
}
