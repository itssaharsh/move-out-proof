#!/usr/bin/env node
// Copies everything the replay page needs into public/data/ so the build is self-contained:
// saved emulator traces, labels.json, the fixture manifest, CREDITS.md, the photos, and the
// checker results (official Skill checker if the kit is present, invariant checks from check-runs.mjs).
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(web, "..");
const out = path.join(web, "public/data");
const fixture = path.join(root, "fixtures/apartment");
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "runs"), { recursive: true });

// 1. traces
const runsDir = path.join(root, "emulator/runs");
const ORDER = ["letter", "gap", "empty-window", "declined", "no-dates"];
const runFiles = existsSync(runsDir) ? readdirSync(runsDir).filter((f) => f.endsWith(".json") && f !== "labels.json") : [];
const index = [];
for (const f of runFiles) {
  const run = JSON.parse(readFileSync(path.join(runsDir, f), "utf8"));
  if (!Array.isArray(run.steps)) continue; // not a trace (e.g. a labels file)
  cpSync(path.join(runsDir, f), path.join(out, "runs", f));
  index.push({ id: run.id, title: run.title, file: `runs/${f}`, ok: !run.error && !!run.final });
}
index.sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));
writeFileSync(path.join(out, "runs/index.json"), JSON.stringify(index, null, 1));
if (existsSync(path.join(runsDir, "labels.json"))) cpSync(path.join(runsDir, "labels.json"), path.join(out, "labels.json"));

// 2. fixture metadata, credits, photos
cpSync(path.join(fixture, "manifest.json"), path.join(out, "manifest.json"));
cpSync(path.join(fixture, "CREDITS.md"), path.join(out, "CREDITS.md"));
cpSync(path.join(fixture, "Photos"), path.join(out, "Photos"), { recursive: true });

// 3. checks: invariant checks are recomputed here; the official checker only if the kit is present.
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
const inv = run("node", ["emulator/check-runs.mjs"]);
const lines = (inv.stdout || "").split("\n").filter(Boolean);
const invariants = lines.filter((l) => /^(PASS|FAIL) /.test(l)).map((l) => {
  const m = l.match(/^(PASS|FAIL)\s+(\S+)\s+(.*)$/);
  return { pass: m[1] === "PASS", run: m[2], name: m[3].split("  <- ")[0].trim() };
});
let official = null;
const prev = path.join(web, "official-check.json"); // last recorded result, kept so a build without the kit still shows it
const kit = run("node", ["tools/check-skill.mjs", "skill/move-out-proof"]);
const m = (kit.stdout || "").match(/status=(\S+) errors=(\d+) warnings=(\d+) info=(\d+) catalog=(\S+)/);
if (m) {
  official = { status: m[1], errors: +m[2], warnings: +m[3], info: +m[4], catalog: m[5], live: true };
  writeFileSync(prev, JSON.stringify(official, null, 1));
} else if (existsSync(prev)) official = { ...JSON.parse(readFileSync(prev, "utf8")), live: false };
writeFileSync(path.join(out, "checks.json"), JSON.stringify({ official, invariants, summary: lines.at(-1) ?? "" }, null, 1));
console.log(`sync: ${index.length} run(s), ${invariants.length} invariant checks (${invariants.filter((i) => !i.pass).length} failing), official=${official ? official.status : "n/a"}`);
