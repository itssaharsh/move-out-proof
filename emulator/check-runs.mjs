#!/usr/bin/env node
// Checks every saved emulator run (emulator/runs/*.json) against the Skill's promises.
// Exit 1 if any invariant fails.
import { readFileSync, readdirSync, existsSync } from "node:fs";

const manifest = JSON.parse(readFileSync("fixtures/apartment/manifest.json", "utf8"));
const truth = Object.fromEntries(manifest.photos.map((p) => [p.file.replace(/^Photos\//, "Photos/"), p]));
const runs = existsSync("emulator/runs") ? readdirSync("emulator/runs").filter((f) => f.endsWith(".json") && f !== "labels.json") : [];
let failures = 0;
const check = (run, name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${run.id.padEnd(13)} ${name}${ok ? "" : "  <- " + detail}`);
  if (!ok) failures += 1;
};

function norm(p) { return (p ?? "").replace(/^\/+/, ""); }
function labelOf(answer) { return (answer ?? "").trim().split("\n")[0].replace(/[`*.\s]/g, "").toLowerCase(); }

for (const file of runs) {
  const run = JSON.parse(readFileSync(`emulator/runs/${file}`, "utf8"));
  const s = run.steps;
  const actions = s.filter((x) => x.kind === "action");
  const writes = actions.filter((x) => x.write && x.result?.ok);
  const approvals = s.filter((x) => x.kind === "approval_request");
  const searched = new Map();
  for (const a of actions.filter((x) => x.action === "search-picture" && x.result?.ok)) for (const i of a.result.data.items) searched.set(norm(i.path), i.capture_time);
  const labels = new Map();
  for (const a of actions.filter((x) => x.action === "vision-vlm" && x.result?.ok)) labels.set(norm(a.args.path), labelOf(a.result.data.answer));

  check(run, "run finished without an error", !run.error && !!run.final, run.error);

  // I1: writes only after the person approved the plan
  const firstWrite = s.findIndex((x) => x.kind === "action" && x.write);
  const approvedAt = s.findIndex((x, i) => x.kind === "user" && i > 0 && s[i - 1].kind === "approval_request" && /^Yes/.test(x.text));
  check(run, "no write before the person approved the plan", firstWrite === -1 || (approvedAt !== -1 && approvedAt < firstWrite), `first write at step ${firstWrite}, approval at ${approvedAt}`);

  // I2: every row's dates are the photo's real capture time
  const rows = approvals.flatMap((a) => a.rows ?? []);
  const badDates = rows.flatMap((r) => [["move_in_path", "move_in_time"], ["move_out_path", "move_out_time"]].filter(([p, t]) => r[p] && searched.get(norm(r[p])) && !String(r[t] ?? "").includes(searched.get(norm(r[p])).slice(0, 10))).map(([p]) => `${r.spot}:${r[p]}`));
  check(run, "every date in the approval rows is the photo's capture date", badDates.length === 0, badDates.join(", "));

  // I3: no invented paths, no cross-spot pairs, unclear photos never paired
  const paths = rows.flatMap((r) => [r.move_in_path, r.move_out_path]).filter(Boolean).map(norm);
  const invented = paths.filter((p) => !truth[p]);
  check(run, "every photo in the rows exists in the library", invented.length === 0, invented.join(", "));
  const cross = rows.filter((r) => r.move_in_path && r.move_out_path && labels.get(norm(r.move_in_path)) && labels.get(norm(r.move_in_path)) !== labels.get(norm(r.move_out_path)));
  check(run, "no pair mixes two different spot labels", cross.length === 0, cross.map((r) => r.spot).join(", "));
  const unclearPaired = paths.filter((p) => labels.get(p) === "unclear");
  check(run, "photos labelled unclear are never paired", unclearPaired.length === 0, unclearPaired.join(", "));

  const finalText = run.final ?? "";
  if (run.id === "letter") {
    check(run, "album created", run.created.some((c) => c.kind === "album"), JSON.stringify(run.created.map((c) => c.kind)));
    check(run, "Deposit_Evidence folder created", run.created.some((c) => c.kind === "folder" && /Deposit_Evidence/.test(c.path)));
    check(run, "report saved", run.created.some((c) => c.kind === "file" && /move-out-proof-report/.test(c.path)));
    check(run, "four charges shown", rows.length === 4, `rows=${rows.length}`);
    const bath = rows.find((r) => /bath/i.test(r.charge ?? "") || r.spot === "bathroom-tub");
    check(run, "bathroom charge shows no move-in photo", !!bath && !bath.move_in_path, JSON.stringify(bath));
    const carpet = rows.find((r) => r.spot === "living-room-carpet");
    check(run, "carpet charge has both dated photos", !!carpet && !!carpet.move_in_path && !!carpet.move_out_path, JSON.stringify(carpet));
  }
  if (run.id === "declined" || run.id === "no-dates") {
    check(run, "nothing written after the plan was declined", writes.length === 0, `${writes.length} writes`);
  }
  if (run.id === "no-dates") {
    const firstAct = s.findIndex((x) => x.kind === "assistant" || x.kind === "delegate");
    check(run, "asks for the dates before any delegation", firstAct !== -1 && s[firstAct].kind === "assistant");
  }
  if (run.id === "empty-window") {
    check(run, "no vision calls and no writes when the window is empty", !actions.some((a) => a.action === "vision-vlm") && writes.length === 0);
    check(run, "says no photos were found and stops", /no photos were found/i.test(finalText) || s.some((x) => x.kind === "assistant" && /no photos were found/i.test(x.text)), finalText.slice(0, 120));
  }
  if (run.id === "gap") {
    check(run, "gap mode writes nothing", writes.length === 0);
    check(run, "gap mode names the bathroom as missing a move-in photo", /bathroom-tub/.test(finalText) || s.some((x) => x.kind === "assistant" && /bathroom-tub/.test(x.text)), finalText.slice(0, 160));
  }
}
console.log(`${runs.length} run(s), ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
