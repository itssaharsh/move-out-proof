// Trace types, the compressed replay timeline, and the pure derivation of what is visible at event n.
export interface Step { t: number; kind: string; [k: string]: any }
export interface Run {
  id: string; title: string; phrase: string; today: string; started_at: string; duration_ms: number;
  final?: string; error?: string;
  usage?: { calls: number; input: number; output: number; thoughts: number; by_model: Record<string, number> };
  created: { kind: string; path: string; items?: any; from?: string; bytes?: number }[];
  albums: { album_uuid: string; name: string; items: string[] }[];
  steps: Step[];
}
export interface Row {
  charge?: string; amount?: string; spot?: string;
  move_in_path?: string; move_in_time?: string; move_in_note?: string;
  move_out_path?: string; move_out_time?: string; move_out_note?: string;
}
export interface Ev { at: number; kind: "step" | "result"; i: number }

const isVision = (s: Step) => s.action === "vision-vlm";

/** Compress the recorded run (model latency dominates it) into a watchable timeline. */
export function compile(run: Run): { events: Ev[]; total: number } {
  const ev: Ev[] = [];
  let v = 0;
  let prev: Step | undefined;
  const steps = run.steps;
  steps.forEach((s, i) => {
    switch (s.kind) {
      case "user": {
        const afterApproval = prev?.kind === "approval_request";
        v += i === 0 ? 700 : afterApproval ? 3600 : 1300;
        ev.push({ at: v, kind: "step", i });
        break;
      }
      case "assistant": v += 1000; ev.push({ at: v, kind: "step", i }); break;
      case "delegate": v += 800; ev.push({ at: v, kind: "step", i }); break;
      case "action": {
        const same = prev?.kind === "action" && prev.action === s.action && prev.delegate === s.delegate;
        const vision = isVision(s);
        v += same ? (vision ? 120 : 70) : 420;
        ev.push({ at: v, kind: "step", i });
        const dur = vision ? 950 : s.write ? 700 : Math.min(900, Math.max(260, (s.ms ?? 0) * 0.4 + 220));
        ev.push({ at: v + dur, kind: "result", i });
        if (vision || s.write || !same) v += dur; else v += 40;
        break;
      }
      case "delegate_state": v += 350; ev.push({ at: v, kind: "step", i }); break;
      case "approval_response": v += 600; ev.push({ at: v, kind: "step", i }); break;
      case "delegate_result": v += 650; ev.push({ at: v, kind: "step", i }); break;
      case "approval_request": v += 1100; ev.push({ at: v, kind: "step", i }); break;
      case "finish": case "error": v += 1000; ev.push({ at: v, kind: "step", i }); break;
      default: v += 300; ev.push({ at: v, kind: "step", i });
    }
    prev = s;
  });
  ev.sort((a, b) => a.at - b.at || a.i - b.i || (a.kind === "step" ? -1 : 1));
  return { events: ev, total: (ev.at(-1)?.at ?? 0) + 1800 };
}

export interface ActionView { step: Step; done: boolean; gate?: "waiting" | "approved" | "declined" }
export interface Group { cli: string; action: string; items: ActionView[] }
export interface PhotoView { path: string; capture_time?: string; phase: "found" | "looking" | "labelled"; label?: string; also: string[]; note?: string }
export interface DelegateView { id: string; target: string; instruction: string; status: string; message?: string; groups: Group[] }
export type FeedItem =
  | { type: "user"; text: string; key: string }
  | { type: "assistant"; text: string; key: string }
  | { type: "delegate"; d: DelegateView; key: string }
  | { type: "approval"; text: string; key: string }
  | { type: "final"; text: string; key: string }
  | { type: "error"; text: string; key: string };
export interface WriteView { kind: "album" | "folder" | "copies" | "report"; title: string; detail: string; items?: string[]; content?: string; key: string }
export interface View {
  feed: FeedItem[];
  photos: PhotoView[];
  letterLines: { description: string; amount: string }[];
  approval?: { text: string; rows: Row[]; answer: "yes" | "no" | null };
  writes: WriteView[];
  emptyWindows: { start?: string; end?: string }[];
  final?: string; error?: string; delegating?: string;
}

export function labelOf(answer?: string): { label: string; also: string[]; note: string } {
  const lines = (answer ?? "").trim().split("\n");
  const clean = (x: string) => x.replace(/[`*.]/g, "").trim();
  const label = clean(lines[0] ?? "").toLowerCase();
  const also = (lines[1] ?? "").split(/[,\s]+/).map((x) => clean(x).toLowerCase()).filter((x) => x && x !== "none");
  return { label, also, note: lines.slice(2).join(" ").trim() };
}

export function derive(run: Run, events: Ev[], n: number): View {
  const view: View = { feed: [], photos: [], letterLines: [], writes: [], emptyWindows: [] };
  const photos = new Map<string, PhotoView>();
  const delegates = new Map<string, DelegateView>();
  const actionViews = new Map<number, ActionView>();
  const upsert = (path: string, patch: Partial<PhotoView>) => {
    const p = photos.get(path) ?? { path, phase: "found", also: [] };
    Object.assign(p, patch);
    photos.set(path, p);
  };
  for (let k = 0; k < n && k < events.length; k++) {
    const { kind, i } = events[k];
    const s = run.steps[i];
    if (kind === "result") {
      const av = actionViews.get(i)!;
      av.done = true;
      const r = s.result;
      if (s.action === "search-picture" && r?.ok && (r.data.items ?? []).length === 0) view.emptyWindows.push({ start: s.args?.start_time, end: s.args?.end_time });
      if (s.action === "search-picture" && r?.ok) for (const it of r.data.items ?? []) upsert(it.path, { capture_time: it.capture_time });
      if (s.action === "meta" && r?.ok) upsert(r.data.path, { capture_time: r.data.capture_time });
      if (isVision(s) && r?.ok) {
        const l = labelOf(r.data.answer);
        upsert(r.data.path, { phase: "labelled", label: l.label, also: l.also, note: l.note });
      }
      if (s.action === "extract" && r?.ok) {
        const lines = r.data?.data?.[0]?.lines ?? [];
        if (lines.length) view.letterLines = lines.map((x: any) => ({ description: x.description, amount: x.amount }));
      }
      if (s.write && r?.ok) {
        const a = s.args ?? {};
        if (s.action === "create-album") {
          const items = run.albums.find((x) => x.name === a.album_name)?.items ?? (Array.isArray(a.add_item) ? a.add_item : []);
          view.writes.push({ kind: "album", title: a.album_name, detail: `${items.length} photos`, items, key: `w${i}` });
        } else if (s.action === "mkdir") view.writes.push({ kind: "folder", title: r.data?.path ?? a.path, detail: "folder", key: `w${i}` });
        else if (s.action === "cpmv") {
          const last = view.writes.find((w) => w.kind === "copies");
          const name = String(r.data?.dst ?? "").split("/").pop() ?? "";
          if (last) last.items!.push(a.src);
          else view.writes.push({ kind: "copies", title: "Copies of the evidence photos", detail: "", items: [a.src], key: `w${i}` });
          const cur = last ?? view.writes[view.writes.length - 1];
          const photos = cur.items!.filter((x) => /\.(jpe?g|png|heic)$/i.test(x)).length, other = cur.items!.length - photos;
          cur.detail = `${photos} ${photos === 1 ? "photo" : "photos"}${other ? ` and ${other} other ${other === 1 ? "file" : "files"}` : ""} copied, originals untouched`;
          void name;
        } else if (s.action === "save-text") view.writes.push({ kind: "report", title: String(r.data?.outputFile ?? a.filename_hint ?? "report").split("/").pop()!, detail: `${r.data?.outputFile ?? ""}${r.data?.contentBytes ? ` · ${r.data.contentBytes} bytes` : ""}`, content: a.content, key: `w${i}` });
      }
      continue;
    }
    switch (s.kind) {
      case "user": view.feed.push({ type: "user", text: s.text, key: `s${i}` });
        if (view.approval && view.approval.answer === null) view.approval.answer = /^\s*(yes|y\b|ok|sure|approve)/i.test(s.text) ? "yes" : "no";
        break;
      case "assistant": view.feed.push({ type: "assistant", text: s.text, key: `s${i}` }); break;
      case "delegate": {
        const d: DelegateView = { id: s.id, target: s.target, instruction: s.instruction, status: "running", groups: [] };
        delegates.set(s.id, d); view.feed.push({ type: "delegate", d, key: `s${i}` }); break;
      }
      case "action": {
        const d = delegates.get(s.delegate); if (!d) break;
        const av: ActionView = { step: s, done: false }; actionViews.set(i, av);
        const g = d.groups.at(-1);
        if (g && g.cli === s.cli && g.action === s.action) g.items.push(av); else d.groups.push({ cli: s.cli, action: s.action, items: [av] });
        if (isVision(s) && s.args?.path) upsert(s.args.path, { phase: "looking" });
        break;
      }
      case "delegate_state": {
        const d = delegates.get(s.delegate); if (d) { d.status = s.status; const last = [...d.groups.flatMap((g) => g.items)].at(-1); if (last) last.gate = "waiting"; }
        break;
      }
      case "approval_response": {
        const d = delegates.get(s.delegate); if (d) { d.status = "running"; const last = [...d.groups.flatMap((g) => g.items)].at(-1); if (last) last.gate = s.approved ? "approved" : "declined"; }
        break;
      }
      case "delegate_result": {
        const d = delegates.get(s.id); if (d) { d.status = s.status; d.message = s.message; }
        break;
      }
      case "approval_request":
        view.approval = { text: s.text, rows: s.rows ?? [], answer: null };
        view.feed.push({ type: "approval", text: s.text, key: `s${i}` }); break;
      case "finish": if (s.text) { view.feed.push({ type: "final", text: s.text, key: `s${i}` }); view.final = s.text; } break;
      case "error": view.feed.push({ type: "error", text: s.text, key: `s${i}` }); view.error = s.text; break;
    }
  }
  view.photos = [...photos.values()];
  return view;
}

export const spotName = (s?: string) => {
  if (!s) return "";
  const t = s.replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Camera date stamp (e.g. 2024 03 12) and a readable date from a capture time string. */
export function parseTime(t?: string): { stamp: string; human: string; time: string } | null {
  const m = (t ?? "").match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/) ?? (t ?? "").match(/(\d{4})-(\d{2})-(\d{2})()()/);
  if (m) return { stamp: `${m[3]} ${MONTHS[+m[2] - 1].toUpperCase()} ${m[1]}`, human: `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`, time: m[4] ? `${m[4]}:${m[5]}` : "" };
  return t ? { stamp: t, human: t, time: "" } : null;
}
export const photoUrl = (p: string) => `data/${p.replace(/^\/+/, "")}`;
export const fileName = (p: string) => p.split("/").pop() ?? p;
export const fmtDur = (ms: number) => (ms >= 60000 ? `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);
