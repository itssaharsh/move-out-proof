#!/usr/bin/env node
// Spot-label accuracy: runs the Skill's own vision prompt on every fixture photo and compares
// the first-line label with the fixture's ground truth.
//   node emulator/eval-labels.mjs --live     label every photo (one vision call each), save emulator/runs/labels.json
//   node emulator/eval-labels.mjs --report   print the saved result
process.env.TZ = "UTC";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { GeminiModel, loadEnv } from "./model.mjs";

const OUT = "emulator/runs/labels.json";
const manifest = JSON.parse(readFileSync("fixtures/apartment/manifest.json", "utf8"));

function skillPrompt() {
  const skill = readFileSync("skill/move-out-proof/SKILL.md", "utf8");
  const m = skill.match(/with this prompt: (Which part of a rented home[\s\S]*?or write none visible\.)/);
  if (!m) throw new Error("vision prompt not found in SKILL.md");
  return m[1];
}

const lines = (answer) => (answer ?? "").trim().split("\n").map((l) => l.trim()).filter(Boolean);
const labelOf = (answer) => (lines(answer)[0] ?? "").replace(/[`*.\s]/g, "").toLowerCase();
const alsoOf = (answer) => (lines(answer)[1] ?? "").toLowerCase().split(/[,\s]+/).map((x) => x.replace(/[`*.]/g, "")).filter((x) => x && x !== "none");

if (process.argv.includes("--live")) {
  loadEnv();
  const model = new GeminiModel();
  const prompt = skillPrompt();
  const rows = [];
  for (const p of manifest.photos) {
    const data = readFileSync(`fixtures/apartment/${p.file}`).toString("base64");
    const r = await model.generate({ system: "You are an image description model. Answer only what the image shows.", contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data } }, { text: prompt }] }] });
    const label = labelOf(r.text);
    rows.push({ model: r.model, file: p.file, truth: p.spot_truth, label, also: alsoOf(r.text), correct: label === p.spot_truth, covered: label === p.spot_truth || alsoOf(r.text).includes(p.spot_truth), answer: r.text });
    console.log(`${label === p.spot_truth ? "ok  " : "MISS"} ${p.file.padEnd(42)} truth=${p.spot_truth.padEnd(20)} got=${label}`);
  }
  mkdirSync("emulator/runs", { recursive: true });
  writeFileSync(OUT, JSON.stringify({ model: Object.keys(model.byModel).join("+"), by_model: model.byModel, prompt, at: new Date().toISOString(), usage: model.usage, rows }, null, 2));
}

if (!existsSync(OUT)) {
  console.error(`no saved labels at ${OUT}; run with --live first`);
  process.exit(1);
}
const saved = JSON.parse(readFileSync(OUT, "utf8"));
const n = saved.rows.length, correct = saved.rows.filter((r) => r.correct).length;
const spots = saved.rows.filter((r) => !["unclear", "not-a-spot"].includes(r.truth));
const wrongSpot = saved.rows.filter((r) => !r.correct && !["unclear", "not-a-spot"].includes(r.label) && !["unclear", "not-a-spot"].includes(r.truth));
const covered = saved.rows.filter((r) => r.covered ?? r.correct).length;
console.log(`main label: ${correct}/${n} correct; spot in frame (main or also-visible): ${covered}/${n}`);
console.log(`labels: ${correct}/${n} correct (${Math.round((100 * correct) / n)}%) with ${saved.model}; spot photos ${spots.filter((r) => r.correct).length}/${spots.length}; labelled as the WRONG spot: ${wrongSpot.length}`);
for (const r of saved.rows.filter((x) => !x.correct)) console.log(`  miss: ${r.file} truth=${r.truth} got=${r.label}`);
// The Skill's safety property: a photo may fall back to unclear, but must not be labelled as a different spot.
process.exit(wrongSpot.length === 0 ? 0 : 1);
