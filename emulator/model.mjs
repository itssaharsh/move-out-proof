// Gemini client for the emulator: function calling, image and PDF input, retries, usage tracking.
// A scripted model with the same interface is used by the tests (no network).
import { readFileSync, existsSync } from "node:fs";

export function loadEnv(file = ".env.local") {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GeminiModel {
  constructor({ model = process.env.EMULATOR_MODEL ?? "gemini-3.5-flash", apiKey = process.env.GEMINI_API_KEY, minGapMs = 0 } = {}) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set (put it in .env.local)");
    this.model = model;
    this.apiKey = apiKey;
    this.minGapMs = minGapMs;
    this.lastCall = 0;
    this.usage = { calls: 0, input: 0, output: 0, thoughts: 0 };
  }

  // contents: Gemini-format turns; tools: [{name, description, parameters}] (JSON schema subset)
  async generate({ system, contents, tools, temperature = 0.2 }) {
    const body = {
      contents,
      generationConfig: { temperature, thinkingConfig: { thinkingLevel: "low" } },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (tools?.length) body.tools = [{ functionDeclarations: tools }];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    for (let attempt = 0; attempt < 6; attempt++) {
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
        const retry = data?.error?.details?.find((d) => d.retryDelay)?.retryDelay;
        await sleep(retry ? (parseFloat(retry) + 1) * 1000 : 4000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${data?.error?.message ?? "unknown error"}`);
      const u = data.usageMetadata ?? {};
      this.usage.calls += 1;
      this.usage.input += u.promptTokenCount ?? 0;
      this.usage.output += u.candidatesTokenCount ?? 0;
      this.usage.thoughts += u.thoughtsTokenCount ?? 0;
      const content = data.candidates?.[0]?.content ?? { role: "model", parts: [] };
      if (!content.role) content.role = "model";
      return {
        content,
        calls: (content.parts ?? []).filter((p) => p.functionCall).map((p) => p.functionCall),
        text: (content.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim(),
      };
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
