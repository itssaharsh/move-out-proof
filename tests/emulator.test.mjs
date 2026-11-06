// Emulator behaviour with a scripted model and a temporary library: no network, no cost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ScriptedModel } from "../emulator/model.mjs";
import { Nas } from "../emulator/nas.mjs";
import { Trace, runParent, runExpert } from "../emulator/agents.mjs";
import { _test } from "../emulator/actions.mjs";

function library() {
  const dir = mkdtempSync(path.join(tmpdir(), "mop-"));
  for (const f of ["Photos/2024/03/IMG_1.jpg", "Photos/2026/10/IMG_2.jpg", "Photos/2025/07/IMG_3.jpg", "Documents/Tenancy/letter.txt"]) {
    mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    writeFileSync(path.join(dir, f), "x");
  }
  const captureTimes = { "Photos/2024/03/IMG_1.jpg": "2024-03-12 10:04:12", "Photos/2026/10/IMG_2.jpg": "2026-10-30 14:08:00", "Photos/2025/07/IMG_3.jpg": "2025-07-19 16:20:00" };
  const out = mkdtempSync(path.join(tmpdir(), "mop-out-"));
  return { nas: new Nas({ fixture: dir, out, captureTimes }), out };
}

const done = (result) => ({ text: JSON.stringify({ status: "completed", result, message: "ok" }) });

test("search-picture filters by capture date and never returns photos outside the window", async () => {
  const { nas } = library();
  const model = new ScriptedModel({ "photo-agent": [{ calls: [{ name: "search_picture", args: { start_time: "2024-02-27", end_time: "2024-04-11" } }] }, done({})] });
  const trace = new Trace({});
  await runExpert({ agent: "photo-agent", instruction: "find move-in photos", model, nas, trace, gate: async () => true, delegateId: "d1" });
  const action = trace.steps.find((s) => s.kind === "action");
  assert.deepEqual(action.result.data.items.map((i) => i.path), ["Photos/2024/03/IMG_1.jpg"]);
});

test("an empty window returns an empty list, not a nearby photo", async () => {
  const { nas } = library();
  const model = new ScriptedModel({ "photo-agent": [{ calls: [{ name: "search_picture", args: { start_time: "2023-01-01", end_time: "2023-02-01" } }] }, done({})] });
  const trace = new Trace({});
  await runExpert({ agent: "photo-agent", instruction: "x", model, nas, trace, gate: async () => true, delegateId: "d1" });
  assert.equal(trace.steps.find((s) => s.kind === "action").result.data.total, 0);
});

test("a declined write is not executed and the expert reports cancelled", async () => {
  const { nas, out } = library();
  const model = new ScriptedModel({ "file-agent": [{ calls: [{ name: "mkdir", args: { path: "Documents/Tenancy/Deposit_Evidence" } }] }, { text: JSON.stringify({ status: "cancelled", result: null, message: "declined" }) }] });
  const trace = new Trace({});
  const r = await runExpert({ agent: "file-agent", instruction: "make folder", model, nas, trace, gate: async () => false, delegateId: "d1" });
  assert.equal(r.status, "cancelled");
  assert.equal(trace.steps.find((s) => s.kind === "action").result.error.code, "APPROVAL_DECLINED");
  assert.equal(existsSync(path.join(out, "nas/Documents/Tenancy/Deposit_Evidence")), false);
  assert.equal(nas.created.length, 0);
});

test("copies land in the sandbox, originals stay, and nothing is overwritten", async () => {
  const { nas, out } = library();
  nas.mkdir("Documents/Tenancy/Deposit_Evidence");
  nas.copy("Photos/2024/03/IMG_1.jpg", "Documents/Tenancy/Deposit_Evidence");
  assert.ok(existsSync(path.join(out, "nas/Documents/Tenancy/Deposit_Evidence/IMG_1.jpg")));
  assert.throws(() => nas.copy("Photos/2024/03/IMG_1.jpg", "Documents/Tenancy/Deposit_Evidence"), /not overwritten/);
  assert.throws(() => nas.copy("../../etc/passwd", "x"), /escapes/);
});

test("an album refuses paths that are not in the library", () => {
  const { nas } = library();
  assert.throws(() => nas.createAlbum("A", ["Photos/2024/03/IMG_1.jpg", "Photos/invented.jpg"]), /not in the library/);
});

test("an expert cannot call another expert's action", async () => {
  const { nas } = library();
  const model = new ScriptedModel({ "knowledge-agent": [{ calls: [{ name: "mkdir", args: { path: "x" } }] }, done({})] });
  const trace = new Trace({});
  await runExpert({ agent: "knowledge-agent", instruction: "x", model, nas, trace, gate: async () => true, delegateId: "d1" });
  assert.equal(nas.created.length, 0);
});

test("the main agent delegates, asks for approval with rows, and records the trace in order", async () => {
  const { nas } = library();
  const model = new ScriptedModel({
    main: [
      { calls: [{ name: "delegate", args: { target: "photo-agent", instruction: "find photos 2024-02-27 to 2024-04-11" } }] },
      { calls: [{ name: "ask_user", args: { message: "Create the album?", approval: true, rows: [{ charge: "Oven deep clean", spot: "kitchen-oven" }], photos: ["Photos/2024/03/IMG_1.jpg"] } }] },
      { calls: [{ name: "finish", args: { message: "Nothing created." } }] },
    ],
    "photo-agent": [{ calls: [{ name: "search_picture", args: { start_time: "2024-02-27", end_time: "2024-04-11" } }] }, done({ total: 1 })],
  });
  const trace = new Trace({});
  const r = await runParent({ skillDir: "skill/move-out-proof", scenario: { phrase: "help with my deposit letter", approve_plan: false }, model, nas, trace, today: "2026-11-06" });
  assert.equal(r.final, "Nothing created.");
  assert.deepEqual(trace.steps.map((s) => s.kind), ["user", "delegate", "action", "delegate_result", "approval_request", "user", "finish"]);
  assert.equal(trace.steps[5].text, "No, do not create anything.");
});

test("list and JSON helpers tolerate the shapes models send", () => {
  assert.deepEqual(_test.asList('["a","b"]'), ["a", "b"]);
  assert.deepEqual(_test.asList("a, b"), ["a", "b"]);
  assert.equal(_test.parseJson('```json\n{"a":1}\n```').a, 1);
  assert.equal(_test.inWindow("2024-03-12 10:00:00", "2024-02-27", "2024-04-11"), true);
  assert.equal(_test.inWindow(null, "2024-02-27", "2024-04-11"), false);
});
