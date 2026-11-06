// Checks on the Skill text that the official checker does not make.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const skill = readFileSync("skill/move-out-proof/SKILL.md", "utf8");
const spots = readFileSync("skill/move-out-proof/references/spots.md", "utf8");
const delegates = [...skill.matchAll(/`(delegate --target (\S+) --instruction '([^`]*)')`/g)].map((m) => ({ line: m[1], target: m[2], text: m[3] }));

test("every delegate goes to a registered expert, with no apostrophes inside the instruction", () => {
  const allowed = new Set(["file-agent", "photo-agent", "document-agent", "knowledge-agent", "security-monitor-agent", "media-agent"]);
  assert.ok(delegates.length >= 6, `expected at least 6 delegates, got ${delegates.length}`);
  for (const d of delegates) {
    assert.ok(allowed.has(d.target), d.target);
    assert.ok(!d.text.slice(0, -1).includes("'"), `apostrophe in: ${d.line.slice(0, 60)}`);
  }
});

test("all five delegation states are handled", () => {
  for (const s of ["completed", "failed", "cancelled", "waiting_user", "waiting_approval"]) assert.match(skill, new RegExp("`" + s + "`"));
});

test("the approval step comes before every write, and every write delegate is after it", () => {
  const approval = skill.indexOf("**Step 6. Ask for approval before any write.**");
  assert.ok(approval > 0);
  const writeDelegates = delegates.filter((d) => /Create an album|Create a folder|Copy each photo|Save the report/.test(d.text));
  assert.equal(writeDelegates.length, 4);
  for (const d of writeDelegates) assert.ok(skill.indexOf(d.line) > approval, d.line.slice(0, 50));
  assert.match(skill, /copy mode, leaving every original file in place/);
  assert.match(skill, /Ask whether they also want copies/);
});

test("empty results stop the run with a plain sentence instead of widening the search", () => {
  assert.match(skill, /No photos were found between/);
  assert.match(skill, /Do not search the move-out window, widen the window/);
});

test("the vision prompt uses exactly the labels in references/spots.md", () => {
  const prompt = delegates.find((d) => d.text.includes("Which part of a rented home"));
  const promptLabels = prompt.text.match(/from this list: ([a-z\-, ]+)\./)[1].split(", ").sort();
  const refLabels = [...spots.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]).concat(["not-a-spot", "unclear"]).sort();
  assert.deepEqual(promptLabels, refLabels);
});

test("dates come from metadata and the Skill gives no verdicts", () => {
  assert.match(skill, /Dates are copied from the capture times of Step 1, never from the vision answer/);
  assert.match(skill, /No verdicts/);
  assert.match(skill, /never says whether a charge is fair/);
});
