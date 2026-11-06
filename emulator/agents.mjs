// The two kinds of agent in the emulator, mirroring the NAS assistant's design:
// a main agent that follows the Skill and can only delegate, and registered experts that act through their CLIs.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { toolsFor, invoke, EXPERTS } from "./actions.mjs";

export class Trace {
  constructor(meta) {
    this.meta = meta;
    this.t0 = Date.now();
    this.steps = [];
  }
  add(step) {
    const s = { t: Date.now() - this.t0, ...step };
    this.steps.push(s);
    return s;
  }
}

const STATES = ["completed", "failed", "cancelled", "waiting_user", "waiting_approval"];

function parseResult(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (STATES.includes(j.status)) return j;
    } catch { /* fall through */ }
  }
  return { status: "failed", result: null, message: "the expert returned no readable result" };
}

const EXPERT_SYSTEM = (agent) => `You are ${agent}, a registered expert of a home NAS assistant.
You receive one self-contained instruction from the main agent. Use only your tools; they are this NAS's public capabilities.
Rules: never invent files, dates, labels or results; report exactly what the tools return. Do only what the instruction asks.
If a write tool returns APPROVAL_DECLINED, stop and return status "cancelled". If a tool fails, return status "failed" with the error.
If you need information only the person can give, return status "waiting_user" with the question in message.
When finished, reply with ONLY a JSON object, no prose:
{"status":"completed|failed|cancelled|waiting_user","result":<the real data from your tools, complete but without repetition>,"message":"<one plain sentence>"}`;

export async function runExpert({ agent, instruction, model, nas, trace, gate, delegateId, maxCalls = 40 }) {
  if (!EXPERTS[agent]) return { status: "failed", result: null, message: `unknown expert ${agent}` };
  const tools = toolsFor(agent);
  const contents = [{ role: "user", parts: [{ text: instruction }] }];
  const ctx = { agent, model, nas, trace, gate, delegateId };
  let calls = 0;
  let nudged = false;
  for (;;) {
    const r = await model.generate({ agent, system: EXPERT_SYSTEM(agent), contents, tools });
    if (!r.calls.length && !r.text && !nudged) {
      nudged = true;
      contents.push({ role: "user", parts: [{ text: "Continue: call a tool, or return the JSON result." }] });
      continue;
    }
    contents.push(r.content);
    if (!r.calls.length) return parseResult(r.text);
    const responses = [];
    for (const c of r.calls) {
      calls += 1;
      const result = calls > maxCalls ? { ok: false, error: { code: "CALL_LIMIT", message: "too many actions for one instruction" } } : await invoke(c.name, c.args ?? {}, ctx);
      responses.push({ functionResponse: { name: c.name, response: result } });
    }
    contents.push({ role: "user", parts: responses });
    if (calls > maxCalls + 2) return { status: "failed", result: null, message: "action limit reached" };
  }
}

function loadSkill(skillDir) {
  const skill = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  const refDir = path.join(skillDir, "references");
  const refs = existsSync(refDir) ? readdirSync(refDir).filter((f) => f.endsWith(".md")).sort().map((f) => `---- references/${f} ----\n${readFileSync(path.join(refDir, f), "utf8")}`) : [];
  return `---- SKILL.md ----\n${skill}\n${refs.join("\n")}`;
}

const PARENT_TOOLS = [
  { name: "delegate", description: "Hand one self-contained instruction to one registered expert. Returns {status, result, message}.",
    parameters: { type: "OBJECT", properties: { target: { type: "STRING", description: "file-agent | photo-agent | document-agent | knowledge-agent" }, instruction: { type: "STRING" } }, required: ["target", "instruction"] } },
  { name: "ask_user", description: "Send the person a message and wait for the reply. For the approval step set approval=true and fill rows (one per charge, or one per spot in gap mode) and photos (exact paths that would be written). When a side has no photo, leave its path and time empty and put the gap sentence in its note.",
    parameters: { type: "OBJECT", properties: {
      message: { type: "STRING" }, approval: { type: "BOOLEAN" },
      rows: { type: "ARRAY", items: { type: "OBJECT", properties: {
        charge: { type: "STRING" }, amount: { type: "STRING" }, spot: { type: "STRING" },
        move_in_path: { type: "STRING" }, move_in_time: { type: "STRING" }, move_in_note: { type: "STRING" },
        move_out_path: { type: "STRING" }, move_out_time: { type: "STRING" }, move_out_note: { type: "STRING" } } } },
      photos: { type: "ARRAY", items: { type: "STRING" } } }, required: ["message"] } },
  { name: "finish", description: "End the run with the final message to the person.",
    parameters: { type: "OBJECT", properties: { message: { type: "STRING" } }, required: ["message"] } },
];

const PARENT_SYSTEM = (skillText, today) => `You are the main agent of a home NAS assistant. A Skill is installed and the person's request matches it.
Follow the Skill exactly, step by step. You cannot read files or use NAS capabilities yourself. Your only tools:
- delegate: give one registered expert (file-agent, photo-agent, document-agent, knowledge-agent) a complete, self-contained instruction; put real values (dates, paths, charge lines, the full report text) inside the instruction.
- ask_user: talk to the person and wait for the reply (use approval=true with rows and photos for the approval step).
- finish: the final message.
Handle every delegate status as the Skill says. Never claim something was created unless an expert returned completed for it.
Today is ${today}.

${skillText}`;

export async function runParent({ skillDir, scenario, model, nas, trace, today, maxTurns = 40 }) {
  const replies = [...(scenario.replies ?? [])];
  const approvalsAsked = { n: 0 };
  // Platform approval gate: the gateway asks the person per write; the scenario decides.
  const gate = async (w) => {
    trace.add({ kind: "delegate_state", delegate: w.delegateId, status: "waiting_approval", write: `${w.cli} ${w.action}` });
    const approved = scenario.approve_writes !== false;
    trace.add({ kind: "approval_response", delegate: w.delegateId, approved, write: `${w.cli} ${w.action}` });
    return approved;
  };
  const contents = [{ role: "user", parts: [{ text: scenario.phrase }] }];
  trace.add({ kind: "user", text: scenario.phrase });
  let delegates = 0;
  let nudges = 0;
  for (let turn = 0; turn < maxTurns; turn++) {
    const r = await model.generate({ agent: "main", system: PARENT_SYSTEM(loadSkill(skillDir), today), contents, tools: PARENT_TOOLS });
    if (!r.calls.length && !r.text && nudges < 2) {
      // An empty reply (no tool call, no text) is a model hiccup, not a decision: ask once more.
      nudges += 1;
      trace.add({ kind: "note", text: `empty model reply (${r.finish ?? "no reason"}); asked the main agent to continue` });
      contents.push({ role: "user", parts: [{ text: "Continue with the next step of the Skill. Use a tool." }] });
      continue;
    }
    contents.push(r.content);
    if (!r.calls.length) {
      trace.add({ kind: "finish", text: r.text, implicit: true });
      return { final: r.text };
    }
    const responses = [];
    for (const c of r.calls) {
      const a = c.args ?? {};
      if (c.name === "finish") {
        trace.add({ kind: "finish", text: a.message });
        return { final: a.message };
      }
      if (c.name === "ask_user") {
        let reply;
        if (a.approval) {
          approvalsAsked.n += 1;
          trace.add({ kind: "approval_request", text: a.message, rows: a.rows ?? [], photos: a.photos ?? [] });
          reply = scenario.approve_plan === false ? "No, do not create anything." : (scenario.approve_reply ?? "Yes, create them.");
        } else {
          trace.add({ kind: "assistant", text: a.message });
          reply = replies.shift() ?? "I have nothing more to add.";
        }
        trace.add({ kind: "user", text: reply });
        responses.push({ functionResponse: { name: "ask_user", response: { reply } } });
        continue;
      }
      if (c.name === "delegate") {
        delegates += 1;
        const id = `d${delegates}`;
        trace.add({ kind: "delegate", id, target: a.target, instruction: a.instruction });
        const res = await runExpert({ agent: a.target, instruction: a.instruction, model, nas, trace, gate, delegateId: id });
        trace.add({ kind: "delegate_result", id, target: a.target, status: res.status, message: res.message, result: res.result });
        responses.push({ functionResponse: { name: "delegate", response: res } });
        continue;
      }
      responses.push({ functionResponse: { name: c.name, response: { error: "unknown tool" } } });
    }
    contents.push({ role: "user", parts: responses });
  }
  trace.add({ kind: "finish", text: "turn limit reached", error: true });
  return { final: "turn limit reached" };
}
