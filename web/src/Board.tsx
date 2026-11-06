import { h } from "preact";
import { Md } from "./md";
import { Chip, Frame, GapFrame, Section, Stamp, type Open } from "./ui";
import { fileName, parseTime, photoUrl, spotName, type PhotoView, type Row, type View } from "./model";

function Empty({ w }: { w: { start?: string; end?: string }[] }) {
  return (
    <Section eyebrow="Photo-agent" title="No photos in this window" id="b-empty" cls="empty">
      {w.map((x, i) => <p class="lede strong" key={i}>Nothing in your library was taken between {parseTime(x.start)?.human ?? x.start} and {parseTime(x.end)?.human ?? x.end}. The Skill says so and stops; it does not pair photos from other dates.</p>)}
    </Section>
  );
}

function Library({ photos, ended }: { photos: PhotoView[]; ended: boolean }) {
  const sorted = [...photos].sort((a, b) => (a.capture_time ?? "").localeCompare(b.capture_time ?? ""));
  const labelled = photos.filter((p) => p.phase === "labelled").length;
  return (
    <Section eyebrow="Photo-agent" title="Your photo library" id="b-library" right={<span class="count">{labelled} of {photos.length} labelled</span>}>
      <p class="lede">The vision model names the spot in each photo. The date under each photo is read from the camera's own metadata, not from the model.</p>
      <ul class="tiles">
        {sorted.map((p) => (
          <li key={p.path} class={`tile ph-${ended && p.phase === "found" ? "idle" : p.phase} ${p.label === "unclear" ? "is-unclear" : ""}`}>
            <div class="print">
              <img src={photoUrl(p.path)} alt={p.label ? `${spotName(p.label)} photo ${fileName(p.path)}` : `Photo ${fileName(p.path)}`} loading="lazy" decoding="async" />
              <Stamp time={p.capture_time} />
              {p.phase === "looking" ? <span class="scan" aria-hidden="true" /> : null}
            </div>
            <div class="tcap">
              {p.phase === "labelled" ? <Chip label={p.label} /> : <span class="chip chip-wait">{p.phase === "looking" ? "Looking…" : ended ? "Not examined" : "Found"}</span>}
              {p.phase === "labelled" && p.note && !/^none( visible)?\.?$/i.test(p.note) ? <span class="note">{p.note}</span> : null}
              {p.phase === "labelled" && p.also.length ? <span class="also">Also visible: {p.also.map(spotName).join(", ")}</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const SPOTS = ["kitchen-oven", "kitchen-counter", "kitchen-sink", "fridge", "bathroom-tub", "bathroom-sink", "toilet", "living-room-wall", "living-room-carpet", "bedroom-wall", "bedroom-carpet", "window", "front-door"];
function Coverage({ photos, open }: { photos: PhotoView[]; open: Open }) {
  const by = new Map<string, PhotoView>();
  for (const p of photos) if (p.phase === "labelled" && p.label && !by.has(p.label)) by.set(p.label, p);
  const missing = SPOTS.filter((s) => !by.has(s)).length;
  return (
    <Section eyebrow="Before you hand back the keys" title="Which spots have a dated move-in photo" id="b-coverage" right={<span class="count">{SPOTS.length - missing} of {SPOTS.length} covered</span>}>
      <p class="lede">The spot list is fixed so a move-in and a move-out photo are always the same place. Amber spots are the ones to photograph, or to look for in older photos, before you move out.</p>
      <ul class="cover">
        {SPOTS.map((s) => { const p = by.get(s); return p ? (
          <li key={s} class="cv ok"><button class="print" onClick={() => open({ src: photoUrl(p.path), caption: `${fileName(p.path)}, ${parseTime(p.capture_time)?.human ?? ""}`, stamp: p.capture_time })} aria-label={`${parseTime(p.capture_time)?.stamp ?? ""} ${parseTime(p.capture_time)?.time ?? ""}, enlarge ${spotName(s)} photo`.trim()}><img src={photoUrl(p.path)} alt="" loading="lazy" /><Stamp time={p.capture_time} /></button><span class="cv-n">{spotName(s)}</span></li>
        ) : (
          <li key={s} class="cv gp"><div class="print gap-box" role="img" aria-label={`No dated move-in photo of ${spotName(s)}`}><strong>No dated move-in photo of this spot</strong></div><span class="cv-n">{spotName(s)}</span></li>
        ); })}
      </ul>
    </Section>
  );
}

function ChargesRead({ lines }: { lines: { description: string; amount: string }[] }) {
  return (
    <Section eyebrow="Document-agent" title="Charges read from the letter" id="b-charges">
      <ul class="lines">{lines.map((l, i) => <li key={i}><span>{l.description}</span><b>{l.amount}</b></li>)}</ul>
    </Section>
  );
}

const isPath = (v?: string) => !!v && /\.(jpe?g|png|heic)$/i.test(v.trim());
const isGapText = (r: Row, side: "in" | "out") => !isPath(side === "in" ? r.move_in_path : r.move_out_path);

function Case({ r, open, photos, inOnly }: { r: Row; open: Open; photos: Map<string, PhotoView>; inOnly: boolean }) {
  const gapIn = isGapText(r, "in"), gapOut = !inOnly && isGapText(r, "out");
  const gap = gapIn || gapOut;
  const timeOf = (p?: string, t?: string) => (parseTime(t) && /\d{4}-\d{2}-\d{2}/.test(t ?? "") ? t : p ? photos.get(p)?.capture_time ?? t : t);
  const title = r.charge || spotName(r.spot) || "Spot";
  return (
    <article class={`case ${gap ? "has-gap" : ""}`}>
      <header>
        <div><h3>{title}</h3>{r.spot ? <span class="spot">{r.spot}</span> : <span class="spot">No photo spot</span>}</div>
        <div class="amt">{r.amount ?? ""}{gap ? <span class="gap-tag">Gap</span> : null}</div>
      </header>
      <div class={`pair ${inOnly ? "one" : ""}`}>
        {gapIn ? <GapFrame side="Move-in" text="No dated move-in photo of this spot" sub="Nothing is paired in its place." /> : <Frame side="Move-in" path={r.move_in_path!} time={timeOf(r.move_in_path, r.move_in_time)} note={r.move_in_note} open={open} />}
        {inOnly ? null : gapOut ? <GapFrame side="Move-out" text="No dated move-out photo of this spot" sub="Nothing is paired in its place." /> : <Frame side="Move-out" path={r.move_out_path!} time={timeOf(r.move_out_path, r.move_out_time)} note={r.move_out_note} open={open} />}
      </div>
    </article>
  );
}

function Evidence({ view, open, finished }: { view: View; open: Open; finished: boolean }) {
  const a = view.approval!;
  const map = new Map(view.photos.map((p) => [p.path, p]));
  const unpaired = view.photos.filter((p) => p.phase === "labelled" && (p.label === "unclear" || p.label === "not-a-spot"));
  const inOnly = a.rows.length > 0 && a.rows.every((r) => !isPath(r.move_out_path));
  const gaps = a.rows.filter((r) => !isPath(r.move_in_path) || (!inOnly && !isPath(r.move_out_path))).length;
  const status = a.answer === "yes" ? "approved" : a.answer === "no" ? "declined" : "waiting";
  const hasWrites = view.writes.length > 0;
  return (
    <Section eyebrow="Charge by charge" title="Your evidence for the letter" id="b-evidence" cls={`ev ev-${status}`}
      right={<span class={`pill pill-${status}`}>{status === "waiting" ? "Waiting for your approval" : status === "approved" ? "You approved" : "You declined"}</span>}>
      <p class="lede">{a.rows.length} {a.rows.length === 1 ? "row" : "rows"}{gaps ? `, ${gaps} with a gap shown in amber` : ""}. No row says whether a charge is fair; that stays your call.</p>
      <div class="cases">{a.rows.map((r, i) => <Case key={i} r={r} open={open} photos={map} inOnly={inOnly} />)}</div>
      {unpaired.length ? (
        <div class="unpaired">
          <h3>Photos that were not paired</h3>
          <ul>{unpaired.map((p) => (
            <li key={p.path}>
              <img src={photoUrl(p.path)} alt={`Unpaired photo ${fileName(p.path)}`} loading="lazy" />
              <div><Chip label={p.label} /><span class="fn">{fileName(p.path)}{p.capture_time ? `, ${parseTime(p.capture_time)?.human}` : ""}</span><span class="note">{p.label === "unclear" ? "Too dark or blurred to name a spot. Listed with its date so you can check it by eye." : "Not a part of the home. Counted and left out."}</span></div>
            </li>
          ))}</ul>
        </div>
      ) : null}
      <div class={`gatebar gate-${status}`} role="group" aria-label="Approval, as recorded in the run">
        <p>{status === "waiting" ? "Nothing is written until you answer." : status === "approved" ? (hasWrites ? "Approved. The writes below happened after this answer." : "Approved. Writing…") : "Declined. Nothing was written."}</p>
        <div class="btns">{status === "waiting" ? <><span class="btn yes">Yes, create them</span><span class="btn no">No</span></> : <span class={`btn ${status === "approved" ? "yes" : "no"} sel`}>{status === "approved" ? "You answered: Yes" : "You answered: No"}</span>}</div>
      </div>
      {finished && status === "declined" ? <p class="calm">The run stopped here. Your library is unchanged.</p> : null}
    </Section>
  );
}

function Created({ view, open, onReport }: { view: View; open: Open; onReport: (c: string, t: string) => void }) {
  return (
    <Section eyebrow="After approval" title="Created on your NAS" id="b-created">
      <ul class="made">
        {view.writes.map((w) => (
          <li key={w.key} class={`mk mk-${w.kind}`}>
            <span class="mk-ico" aria-hidden="true">{w.kind === "album" ? "▦" : w.kind === "folder" ? "▭" : w.kind === "report" ? "☰" : "⧉"}</span>
            <div>
              <p class="mk-k">{w.kind === "album" ? "Album" : w.kind === "folder" ? "Folder" : w.kind === "report" ? "Report" : "Copies"}</p>
              <p class="mk-t">{w.title.replace(/\//g, "/\u200b")}</p>
              <p class="mk-d">{w.detail}</p>
              {w.items?.length ? <div class="mk-strip">{w.items.slice(0, 8).map((p) => <button key={p} onClick={() => open({ src: photoUrl(p), caption: fileName(p) })} aria-label={`Enlarge ${fileName(p)}`}><img src={photoUrl(p)} alt="" loading="lazy" /></button>)}</div> : null}
              {w.kind === "report" && w.content ? <button class="link" onClick={() => onReport(w.content!, w.title)}>Read the report</button> : null}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function Board({ view, open, onReport, finished, ended, runId }: { runId: string; view: View; open: Open; onReport: (c: string, t: string) => void; finished: boolean; ended: boolean }) {
  const nothingWritten = ended && view.writes.length === 0;
  return (
    <div class="board">
      {view.emptyWindows.length ? <Empty w={view.emptyWindows} /> : null}
      {view.photos.length ? <Library photos={view.photos} ended={ended} /> : null}
      {runId === "gap" && ended && view.photos.length ? <Coverage photos={view.photos} open={open} /> : null}
      {view.letterLines.length && !view.approval ? <ChargesRead lines={view.letterLines} /> : null}
      {view.approval ? <Evidence view={view} open={open} finished={finished} /> : null}
      {view.writes.length ? <Created view={view} open={open} onReport={onReport} /> : null}
      {nothingWritten ? <p class="outcome">Nothing was created on the NAS in this run.</p> : null}
      {view.final && !view.approval && !view.photos.length ? <div class="outcome-card"><Md src={view.final} /></div> : null}
    </div>
  );
}
