#!/usr/bin/env node
// Runs the Move-out Proof Skill in the emulator against a fixture library and writes a trace.
// Usage: node emulator/run.mjs emulator/scenarios/letter.json [--out emulator/out] [--save]
process.env.TZ = "UTC"; // EXIF times have no zone; read them as written.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { GeminiModel, loadEnv } from "./model.mjs";
import { Nas } from "./nas.mjs";
import { Trace, runParent } from "./agents.mjs";

const args = process.argv.slice(2);
const scenarioFile = args.find((a) => a.endsWith(".json"));
if (!scenarioFile) {
  console.error("usage: node emulator/run.mjs <scenario.json> [--save]");
  process.exit(2);
}
loadEnv();
const scenario = JSON.parse(readFileSync(scenarioFile, "utf8"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = path.resolve("emulator/out", `${scenario.id}-${stamp}`);
mkdirSync(out, { recursive: true });

const model = new GeminiModel({ minGapMs: Number(process.env.EMULATOR_GAP_MS ?? 0) });
const nas = new Nas({ fixture: scenario.fixture, out });
const trace = new Trace({ id: scenario.id, title: scenario.title, phrase: scenario.phrase, fixture: scenario.fixture, today: scenario.today });
const t0 = Date.now();
let final, error;
try {
  ({ final } = await runParent({ skillDir: "skill/move-out-proof", scenario, model, nas, trace, today: scenario.today }));
} catch (e) {
  error = e.message;
  trace.add({ kind: "error", text: e.message });
}
const result = {
  ...trace.meta,
  started_at: new Date(t0).toISOString(),
  duration_ms: Date.now() - t0,
  final,
  error,
  steps: trace.steps,
  created: nas.created,
  albums: nas.albums,
  usage: { ...model.usage, by_model: model.byModel },
};
writeFileSync(path.join(out, "trace.json"), JSON.stringify(result, null, 2));
if (args.includes("--save")) {
  mkdirSync("emulator/runs", { recursive: true });
  writeFileSync(`emulator/runs/${scenario.id}.json`, JSON.stringify(result, null, 2));
}
const delegates = trace.steps.filter((s) => s.kind === "delegate").length;
const actions = trace.steps.filter((s) => s.kind === "action").length;
console.log(`${scenario.id}: ${error ? "ERROR " + error : "done"} in ${(result.duration_ms / 1000).toFixed(1)}s | delegates=${delegates} actions=${actions} created=${nas.created.length} | model calls=${model.usage.calls} cached=${model.usage.cached} ${JSON.stringify(model.byModel)} in=${model.usage.input} out=${model.usage.output} thoughts=${model.usage.thoughts}`);
console.log(`trace: ${path.relative(process.cwd(), out)}/trace.json`);
console.log(`final: ${(final ?? "").slice(0, 400)}`);
process.exit(error ? 1 : 0);
