import { h, type ComponentChildren } from "preact";
import { fileName, parseTime, photoUrl, spotName } from "./model";

export interface Lightbox { src: string; caption: string; stamp?: string }
export type Open = (l: Lightbox) => void;

export function Stamp({ time }: { time?: string }) {
  const p = parseTime(time);
  if (!p) return null;
  return <span class="stamp">{p.stamp}{p.time ? ` ${p.time}` : ""}</span>;
}

export function Chip({ label, kind }: { label?: string; kind?: "spot" | "unclear" | "none" | "gap" }) {
  const k = kind ?? (label === "unclear" ? "unclear" : label === "not-a-spot" ? "none" : "spot");
  const text = label === "unclear" ? "Unclear" : label === "not-a-spot" ? "Not a spot" : spotName(label);
  return <span class={`chip chip-${k}`}>{text}</span>;
}

/** One dated photo as a print: the image, the camera date stamp printed on it, what the model saw. */
export function Frame({ side, path, time, note, open, alt }: { side: string; path: string; time?: string; note?: string; open: Open; alt?: string }) {
  const p = parseTime(time);
  return (
    <figure class="frame">
      <button class="print" onClick={() => open({ src: photoUrl(path), caption: `${side}: ${fileName(path)}${p ? ", " + p.human + (p.time ? " " + p.time : "") : ""}`, stamp: time })} aria-label={`${p ? (p.stamp + (p.time ? " " + p.time : "")) + ", " : ""}enlarge ${side.toLowerCase()} photo ${fileName(path)}`}>
        <img src={photoUrl(path)} alt={alt ?? `${side} photo ${fileName(path)}`} loading="lazy" decoding="async" />
        <Stamp time={time} />
      </button>
      <figcaption>
        <span class="side">{side}</span>
        <span class="fn">{fileName(path)}</span>
        {note && !/^none( visible)?\.?$/i.test(note.trim()) ? <span class="note">{note}</span> : null}
      </figcaption>
    </figure>
  );
}

export function GapFrame({ side, text, sub }: { side: string; text: string; sub?: string }) {
  return (
    <figure class="frame gap">
      <div class="print gap-box" role="img" aria-label={text}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 10v5M12 17.6v.1" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
        <strong>{text}</strong>
        {sub ? <span>{sub}</span> : null}
      </div>
      <figcaption><span class="side">{side}</span></figcaption>
    </figure>
  );
}

export function Section({ eyebrow, title, right, children, id, cls }: { eyebrow?: string; title: string; right?: ComponentChildren; children: ComponentChildren; id?: string; cls?: string }) {
  return (
    <section class={`sec ${cls ?? ""}`} id={id}>
      <header class="sec-h"><div>{eyebrow ? <p class="eyebrow">{eyebrow}</p> : null}<h2>{title}</h2></div>{right}</header>
      {children}
    </section>
  );
}
