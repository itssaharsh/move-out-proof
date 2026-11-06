import { h } from "preact";
import { useState } from "preact/hooks";
import { Md } from "./md";
import { fileName, labelOf, spotName, type ActionView, type DelegateView, type FeedItem, type Group, type View, parseTime } from "./model";

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

function argsLine(a: any = {}, action: string): string {
  if (action === "search-picture") return [a.start_time, a.end_time].filter(Boolean).join(" to ") + (a.file_type ? ` · ${a.file_type}` : "");
  if (action === "vision-vlm" || action === "meta") return fileName(a.path ?? "");
  if (action === "cpmv") return `${fileName(a.src ?? "")} → ${a.dst ?? ""}`;
  if (action === "create-album") return `"${a.album_name}" · ${Array.isArray(a.add_item) ? a.add_item.length : "?"} photos`;
  if (action === "save-text") return `${a.path ?? ""}/${a.filename_hint ?? ""}`;
  if (action === "mkdir") return a.path ?? "";
  if (action === "extract") return `${(Array.isArray(a.file) ? a.file : [a.file]).map(fileName).join(", ")} · schema ${a.schema ?? "auto"}`;
  if (action === "qa") return short(String(a.query ?? ""), 90);
  return short(Object.entries(a).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" "), 90);
}
function resultLine(s: any): string {
  const r = s.result;
  if (!r) return "";
  if (!r.ok) return `${r.error?.code ?? "error"}: ${short(r.error?.message ?? "", 80)}`;
  const d = r.data ?? {};
  switch (s.action) {
    case "search-picture": return `${d.total ?? d.items?.length ?? 0} photos found`;
    case "meta": return parseTime(d.capture_time)?.human ? `taken ${parseTime(d.capture_time)!.human}` : "no capture time";
    case "vision-vlm": { const l = labelOf(d.answer); return l.label; }
    case "qa": return short(String(d.answer ?? "").replace(/[*`\n]+/g, " "), 100);
    case "extract": return `${d.data?.[0]?.lines?.length ?? 0} charge lines read`;
    case "create-album": return `album created · ${d.items?.length ?? ""}`.replace(/ · $/, "");
    case "mkdir": return `folder ${d.path ?? ""}`;
    case "cpmv": return `copied to ${fileName(d.dst ?? "")}`;
    case "save-text": return `saved ${fileName(d.outputFile ?? "")}${d.contentBytes ? ` · ${d.contentBytes} bytes` : ""}`;
    default: return "ok";
  }
}

function Row({ a }: { a: ActionView }) {
  const s = a.step;
  const bad = a.done && s.result && !s.result.ok;
  return (
    <div class={`act ${a.done ? "done" : "run"} ${bad ? "bad" : ""}`}>
      <span class="act-dot" aria-hidden="true" />
      <span class="act-name"><em>{s.cli}</em> {s.action}</span>
      <span class="act-args">{argsLine(s.args, s.action)}</span>
      <span class="act-res">{a.done ? resultLine(s) : "running…"}</span>
      <span class="act-ms">{a.done && s.ms != null ? `${s.ms} ms` : ""}</span>
      {a.gate ? <span class={`gate gate-${a.gate}`}>{a.gate === "waiting" ? "Waiting for approval" : a.gate === "approved" ? "Approved" : "Declined"}</span> : null}
    </div>
  );
}

function GroupView({ g }: { g: Group }) {
  if (g.items.length === 1) return <Row a={g.items[0]} />;
  const done = g.items.filter((i) => i.done).length;
  const vision = g.action === "vision-vlm";
  return (
    <div class={`act grp ${done === g.items.length ? "done" : "run"}`}>
      <span class="act-dot" aria-hidden="true" />
      <span class="act-name"><em>{g.cli}</em> {g.action} <b>×{g.items.length}</b></span>
      <span class="act-args">{vision ? "one photo at a time" : "one call per photo"}</span>
      <span class="act-res">{done}/{g.items.length} done</span>
      <span class="act-ms">{g.items.reduce((a, i) => a + (i.done ? i.step.ms ?? 0 : 0), 0)} ms</span>
      {vision ? <span class="act-chips">{g.items.filter((i) => i.done && i.step.result?.ok).map((i, k) => <span class="mini" key={k}>{labelOf(i.step.result.data.answer).label}</span>)}</span> : null}
    </div>
  );
}

const STATUS: Record<string, string> = { running: "Working", completed: "Completed", failed: "Failed", cancelled: "Cancelled", waiting_user: "Waiting for you", waiting_approval: "Waiting for approval" };
function Delegate({ d }: { d: DelegateView }) {
  const [full, setFull] = useState(false);
  const long = d.instruction.length > 230;
  return (
    <div class="dcard">
      <div class="dhead">
        <span class="route"><i>Main agent</i><svg viewBox="0 0 20 10" width="20" height="10" aria-hidden="true"><path d="M0 5h17M13 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><b>{d.target}</b></span>
        <span class={`status st-${d.status}`}>{STATUS[d.status] ?? d.status}</span>
      </div>
      <p class={`instr ${full ? "full" : ""}`}>{full || !long ? d.instruction : short(d.instruction, 230)}</p>
      {long ? <button class="link" onClick={() => setFull(!full)}>{full ? "Show less" : "Show full instruction"}</button> : null}
      {d.groups.length ? <div class="acts">{d.groups.map((g, i) => <GroupView key={i} g={g} />)}</div> : null}
      {d.message ? <p class="dmsg">{d.message}</p> : null}
    </div>
  );
}

function Ask({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  return (
    <div class="bubble bot ask"><span class="who">NAS assistant asks for approval</span>
      <div class={`md clampy ${full ? "full" : ""}`}><Md src={text} /></div>
      <button class="link" onClick={() => setFull(!full)}>{full ? "Show less" : "Show the whole request"}</button>
    </div>
  );
}

export function Feed({ view, runTitle }: { view: View; runTitle: string }) {
  if (!view.feed.length) return <div class="feed-empty"><p class="eyebrow">Recorded run</p><p>{runTitle}</p><p class="muted">The replay starts with the person's message to their NAS assistant.</p></div>;
  return (
    <ol class="feed">
      {view.feed.map((f: FeedItem) => (
        <li key={f.key} class={`fi fi-${f.type}`}>
          {f.type === "user" ? <div class="bubble you"><span class="who">You</span><p>{f.text}</p></div> : null}
          {f.type === "assistant" ? <div class="bubble bot"><span class="who">NAS assistant</span><p>{f.text}</p></div> : null}
          {f.type === "delegate" ? <Delegate d={f.d} /> : null}
          {f.type === "approval" ? <Ask text={f.text} /> : null}
          {f.type === "final" ? <div class="bubble bot final"><span class="who">NAS assistant</span><div class="md"><Md src={f.text} /></div></div> : null}
          {f.type === "error" ? <div class="bubble err"><span class="who">Run stopped</span><p>{f.text}</p></div> : null}
        </li>
      ))}
    </ol>
  );
}
void spotName;
