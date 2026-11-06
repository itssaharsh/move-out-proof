#!/usr/bin/env node
// Runs UGREEN's official Skill checker (Skill Creation Tool 0.7.3) and fails on any error or warning.
// The kit is not vendored: fetch it with `sh tools/fetch-kit.sh` (or point UGREEN_KIT at an unpacked copy).
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const target = process.argv[2] ?? "skill/move-out-proof";
const kit = process.env.UGREEN_KIT ?? ".kit/uliya-skill-kit";
const lib = path.resolve(kit, "scripts/check-lib.mjs");
if (!existsSync(lib)) {
  console.error(`UGREEN kit not found at ${kit}. Run: sh tools/fetch-kit.sh`);
  process.exit(2);
}
const { checkSkill } = await import(pathToFileURL(lib).href);
const result = await checkSkill(target);
const { errors, warnings, info } = result.summary;
for (const d of result.diagnostics) {
  console.log(`${d.severity.toUpperCase()} ${d.code} ${d.file ?? ""}${d.line ? ":" + d.line : ""} ${d.message}`);
}
console.log(`status=${result.status} errors=${errors} warnings=${warnings} info=${info} catalog=${result.catalog?.checkedVersion ?? "?"}`);
for (const f of result.files ?? []) console.log(`  ${f.path} sha256=${f.sha256.slice(0, 12)}`);
process.exit(errors + warnings === 0 ? 0 : 1);
