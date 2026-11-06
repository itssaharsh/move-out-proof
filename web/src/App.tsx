import { h, Fragment } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Board } from "./Board";
import { Feed } from "./Feed";
import { Letter, type Charge } from "./Letter";
import { Md } from "./md";
import { Proof, type Checks, type Labels } from "./Proof";
import { compile, derive, fmtDur, type Run } from "./model";
import { Frame, GapFrame, Section, type Lightbox } from "./ui";

interface Idx { id: string; title: string; file: string; ok: boolean }
interface Manifest { photos: { file: string; window: string; datetime_original: string; spot_truth: string }[]; letter: { charges: (Charge & { spot_truth: string })[] } }

const SHORT: Record<string, { name: string; hint: string }> = {
  letter: { name: "The letter", hint: "Four charges, evidence pack approved" },
  gap: { name: "Before handing back keys", hint: "Which spots lack a move-in photo" },
  "empty-window": { name: "Empty window", hint: "No photos in the move-in window" },
  declined: { name: "You say no", hint: "Approval declined, nothing written" },
  "no-dates": { name: "Dates missing", hint: "The assistant asks first" },
};

const params = new URLSearchParams(location.search);
const get = <T,>(url: string): Promise<T> => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json() as Promise<T>; });

export function App() {
  const record = params.get("record") === "1";
  const [idx, setIdx] = useState<Idx[] | null>(null);
  const [runId, setRunId] = useState(params.get("run") ?? "letter");
  const [run, setRun] = useState<Run | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [labels, setLabels] = useState<Labels | null>(null);
  const [credits, setCredits] = useState("");
  const [speed, setSpeed] = useState(Number(params.get("speed")) || 1);
  const [playing, setPlaying] = useState(false);
  const [n, setN] = useState(0);
  const [t, setT] = useState(0);
  const [box, setBox] = useState<Lightbox | null>(null);
  const [report, setReport] = useState<{ title: string; content: string } | null>(null);
  const tRef = useRef(0);
  const follow = useRef(true);
  const stageRef = useRef<HTMLElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const forcedState = params.get("state");

  useEffect(() => {
    get<Idx[]>("data/runs/index.json").then(setIdx).catch((e) => setLoadErr(String(e.message)));
    get<Manifest>("data/manifest.json").then(setManifest).catch(() => {});
    get<Checks>("data/checks.json").then(setChecks).catch(() => {});
    get<Labels>("data/labels.json").then(setLabels).catch(() => {});
    fetch("data/CREDITS.md").then((r) => (r.ok ? r.text() : "")).then(setCredits).catch(() => {});
  }, []);

  useEffect(() => {
    if (forcedState === "loading") return;
    setRun(null); setLoadErr("");
    const file = idx?.find((i) => i.id === runId)?.file ?? (idx ? "" : null);
    if (file === null) return;
    if (file === "") { setLoadErr(`No saved run called "${runId}".`); return; }
    get<Run>(`data/${file}`).then(setRun).catch((e) => setLoadErr(String(e.message)));
  }, [idx, runId]);

  const tl = useMemo(() => (run ? compile(run) : { events: [], total: 0 }), [run]);
  const view = useMemo(() => (run ? derive(run, tl.events, n) : null), [run, tl, n]);

  const seek = useCallback((ms: number) => {
    tRef.current = ms; setT(ms);
    let c = 0; while (c < tl.events.length && tl.events[c].at <= ms) c++;
    setN(c);
  }, [tl]);

  // initial state from the URL, once the run is loaded
  const booted = useRef("");
  useEffect(() => {
    if (!run || booted.current === run.id) return;
    booted.current = run.id;
    tRef.current = 0; setN(0); setT(0); setPlaying(false);
    const s = forcedState;
    const apIdx = tl.events.findIndex((e) => e.kind === "step" && run.steps[e.i].kind === "approval_request");
    if (params.get("t")) seek(Math.min(Math.max(0, Number(params.get("t")) || 0), tl.total));
    else if (s === "result") seek(tl.total);
    else if (s === "approval" && apIdx >= 0) seek(tl.events[apIdx].at + 150);
    else if (s === "playing") seek(tl.total * 0.35);
    else if (params.get("autoplay") === "1") { setPlaying(true); }
  }, [run, tl]);

  // the clock
  useEffect(() => {
    if (!playing || !run) return;
    let raf = 0, last = performance.now(), lastUi = 0;
    const tick = (now: number) => {
      const dt = now - last; last = now;
      tRef.current = Math.min(tl.total, tRef.current + dt * speed);
      let c = 0; while (c < tl.events.length && tl.events[c].at <= tRef.current) c++;
      setN((p) => (p === c ? p : c));
      if (now - lastUi > 90) { lastUi = now; setT(tRef.current); }
      if (tRef.current >= tl.total) { setT(tl.total); setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, run, tl]);

  // follow the action: feed scrolls to its end; new board sections come into view
  useEffect(() => { const f = feedRef.current; if (f) f.scrollTo({ top: f.scrollHeight, behavior: "smooth" }); }, [view?.feed.length, view?.feed.at(-1)]);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!view) return;
    for (const id of ["b-evidence", "b-created"]) {
      const present = id === "b-evidence" ? !!view.approval : view.writes.length > 0;
      if (present && !seen.current.has(id + run!.id)) {
        seen.current.add(id + run!.id);
        if (follow.current && playing) setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: id === "b-evidence" ? "start" : "nearest" }), 60);
      }
      if (!present) seen.current.delete(id + run!.id);
    }
  }, [view?.approval, view?.writes.length]);
  useEffect(() => {
    const off = () => { follow.current = false; };
    window.addEventListener("wheel", off, { passive: true });
    window.addEventListener("touchmove", off, { passive: true });
    return () => { window.removeEventListener("wheel", off); window.removeEventListener("touchmove", off); };
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setBox(null); setReport(null); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);

  const goStage = () => stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const play = () => {
    if (!run) return;
    follow.current = true;
    if (tRef.current >= tl.total || n === 0) { seek(0); seen.current.clear(); }
    setPlaying(true); goStage();
  };
  const restart = () => { seek(0); seen.current.clear(); follow.current = true; setPlaying(true); goStage(); };
  const pick = (id: string) => { booted.current = ""; setPlaying(false); seen.current.clear(); setRunId(id); history.replaceState(null, "", `?${new URLSearchParams({ ...Object.fromEntries(params), run: id }).toString()}`); };

  const ended = !!run && t >= tl.total - 1 && n >= tl.events.length && tl.events.length > 0;
  const charges = manifest?.letter.charges ?? [];
  const mi = manifest?.photos.find((p) => p.spot_truth === "living-room-carpet" && p.window === "move-in");
  const mo = manifest?.photos.find((p) => p.spot_truth === "living-room-carpet" && p.window === "move-out");
  const state = forcedState === "error" ? "error" : forcedState === "loading" ? "loading" : loadErr ? "error" : !run ? "loading" : "ready";
  const durTxt = run ? (tl.total < 90000 ? `about ${Math.round(tl.total / 1000)} seconds` : `about ${Math.round(tl.total / 6000) / 10} minutes`) : "";
  const unfinished = run && (!run.final || run.error) && ended;

  return (
    <div class={record ? "record" : ""}>
      {!record ? (
        <header class="nav"><div class="wrap nav-in">
          <a class="brand" href="#top"><svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)" /><rect x="6" y="7" width="12" height="16" rx="2" fill="#fff" /><rect x="14" y="11" width="12" height="14" rx="2" fill="#fff" stroke="var(--accent)" stroke-width="1.5" /><rect x="16.5" y="21" width="7" height="2" rx="1" fill="var(--stamp)" /></svg><b>Move-out Proof</b><span>a Skill for UGREEN AI NAS</span></a>
          <nav aria-label="Sections"><a href="#replay">Replay</a><a href="#proof">How we know</a><a href="#credits">Credits</a></nav>
        </div></header>
      ) : null}

      <main id="top">
        <section class="hero wrap" aria-labelledby="h1">
          <div class="hero-letter"><Letter charges={charges} /></div>
          <div class="hero-copy">
            <p class="eyebrow">Replay of a recorded run</p>
            <h1 id="h1">Answer the letter with the photos you already took.</h1>
            <p class="sentence">Move-out Proof lines up every charge on a deposit deduction letter with your own dated move-in and move-out photos on your NAS, and writes nothing until you approve.</p>
            <div class="cta">
              <button class="play" onClick={play} disabled={!run} aria-label="Play the replay">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor" /></svg>
                <span>Play the replay</span>
              </button>
              <p class="cta-note">{run ? `${SHORT[run.id]?.name ?? run.title}, ${durTxt} at 1×` : "Loading the recorded run…"}</p>
            </div>
            <p class="trust"><span>The model looks.</span> <span>The camera dates decide.</span> <span>You approve.</span></p>
            <div class="preview" aria-label="What the result looks like">
              <p class="eyebrow">What you get</p>
              <div class="prev-row">
                {mi && mo ? <Fragment><Frame side="Move-in" path={mi.file} time={mi.datetime_original.replace("T", " ")} open={setBox} alt="Living-room carpet at move-in, stain already visible" /><Frame side="Move-out" path={mo.file} time={mo.datetime_original.replace("T", " ")} open={setBox} alt="Living-room carpet at move-out, same stain" /></Fragment> : null}
                <GapFrame side="Bathroom, move-in" text="No dated move-in photo of this spot" />
              </div>
              <p class="prev-cap">Carpet stain treatment, £120: the stain is already there in the move-in photo, dated by the camera. Bathroom deep clean, £30: no move-in photo, so the Skill says so instead of guessing.</p>
            </div>
            <p class="eyebrow scen-l">Saved runs</p>
            <div class="scen" role="group" aria-label="Saved runs">
              {(idx ?? []).map((i) => <button key={i.id} title={SHORT[i.id]?.hint} class={i.id === runId ? "sel" : ""} onClick={() => pick(i.id)} aria-pressed={i.id === runId}><b>{SHORT[i.id]?.name ?? i.title}</b></button>)}
            </div>
            <p class="honest">Emulator replay on a laptop, built from UGREEN's public capability catalog. Staged demo apartment: stock photos with assigned dates (see <a href="#credits">credits</a>). The real-device run comes in the finalist round.</p>
          </div>
        </section>

        <section class="stage" id="replay" ref={stageRef} aria-label="Replay">
          <div class="bar"><div class="wrap bar-in">
            <button class="pp" onClick={() => (playing ? setPlaying(false) : ended || n === 0 ? play() : (follow.current = true, setPlaying(true)))} disabled={!run} aria-label={playing ? "Pause" : ended ? "Replay" : "Play"}>
              {playing ? <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg> : ended ? <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5a7 7 0 1 1-6.9 8.2h2.1A5 5 0 1 0 12 7v3L7.5 6 12 2v3Z" fill="currentColor" /></svg> : <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor" /></svg>}
            </button>
            <button class="ghost" onClick={restart} disabled={!run}>Restart</button>
            <div class="speed" role="group" aria-label="Speed">{[1, 2, 4].map((s) => <button key={s} class={s === speed ? "sel" : ""} aria-pressed={s === speed} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
            <input class="scrub" type="range" min={0} max={Math.max(1, tl.total)} value={t} aria-label="Replay position" onInput={(e) => { setPlaying(false); seek(Number((e.target as HTMLInputElement).value)); }} style={{ "--p": `${tl.total ? (t / tl.total) * 100 : 0}%` } as any} />
            <span class="clock">{run ? `${Math.floor(t / 1000)} / ${Math.round(tl.total / 1000)} s` : ""}</span>
            <label class="pickrun"><span class="sr">Saved run</span><select value={runId} onChange={(e) => pick((e.target as HTMLSelectElement).value)}>{(idx ?? []).map((i) => <option key={i.id} value={i.id}>{SHORT[i.id]?.name ?? i.title}</option>)}</select></label>
          </div></div>

          {state === "loading" ? <div class="wrap stage-msg" role="status"><div class="skel" /><p>Loading the recorded run…</p></div> : null}
          {state === "error" ? <div class="wrap stage-msg err" role="alert"><h3>This recording could not be loaded</h3><p>{loadErr || "The trace file for this run is missing."} The page makes no model calls, so there is nothing to retry live; reload to read the saved file again.</p><button class="ghost" onClick={() => location.reload()}>Reload</button></div> : null}
          {state === "ready" && run && view ? (
            <div class="wrap stage-grid">
              <aside class="feedcol" aria-label="Conversation and expert trace">
                <div class="feed-h"><p class="eyebrow">Conversation and trace</p><p class="rec">Recorded {new Date(run.started_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, took {fmtDur(run.duration_ms)}; the replay skips the waiting.</p></div>
                <div class="feed-scroll" ref={feedRef} tabIndex={0}><Feed view={view} runTitle={run.title} /></div>
              </aside>
              <div class="boardcol" aria-live="polite">
                {n === 0 ? <div class="board-empty"><p class="eyebrow">Your evidence</p><h2>Press play to watch it fill in</h2><p>The photo library appears first, each photo labelled by the vision model with its camera date. Then the charge table, then the approval, then the writes.</p></div> : null}
                <Board runId={run.id} view={view} open={setBox} onReport={(c, tt) => setReport({ content: c, title: tt })} finished={ended} ended={ended && !!view.final} />
                {unfinished ? <p class="outcome warn">This saved run stopped before the assistant's final message{run.error ? `: ${run.error}` : ""}.</p> : null}
              </div>
            </div>
          ) : null}
        </section>
      </main>

      {!record ? <Proof checks={checks} labels={labels} run={run} /> : null}

      {!record ? (
        <section class="credits wrap" id="credits" aria-labelledby="credits-h">
          <header class="sec-h"><div><p class="eyebrow">Credits and staging</p><h2 id="credits-h">Where the photos come from</h2></div></header>
          <div class="md credits-md">{credits ? <Md src={credits.replace(/^# .*\n/, "")} /> : <p>Credits file not found.</p>}</div>
        </section>
      ) : null}
      {!record ? <footer class="foot"><div class="wrap"><p>Move-out Proof, a Skill for UGREEN AI NAS. This page replays saved emulator runs and makes no model calls. It does not say whether any charge is fair.</p></div></footer> : null}

      {box ? <div class="lb" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setBox(null)}><figure onClick={(e) => e.stopPropagation()}><img src={box.src} alt={box.caption} /><figcaption>{box.caption}</figcaption><button class="ghost" onClick={() => setBox(null)} autoFocus>Close</button></figure></div> : null}
      {report ? <div class="lb" role="dialog" aria-modal="true" aria-label={report.title} onClick={() => setReport(null)}><div class="paper" onClick={(e) => e.stopPropagation()}><header><b>{report.title}</b><button class="ghost" onClick={() => setReport(null)} autoFocus>Close</button></header><div class="md"><Md src={report.content} /></div></div></div> : null}
    </div>
  );
}
void Section;
