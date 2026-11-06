import { h } from "preact";
import { useState } from "preact/hooks";
import { fmtDur, type Run } from "./model";

export interface Checks { official: { status: string; errors: number; warnings: number; catalog: string; live: boolean } | null; invariants: { pass: boolean; run: string; name: string }[]; summary: string }
export interface Labels { model: string; rows: { file: string; truth: string; label: string; also?: string[]; correct: boolean; covered?: boolean }[] }

function Card({ k, big, sub, children, ok }: { k: string; big: string; sub: string; children?: any; ok?: boolean }) {
  return (
    <div class={`pcard ${ok === false ? "warn" : ""}`}>
      <p class="pk">{k}</p>
      <p class="pbig">{big}</p>
      <p class="psub">{sub}</p>
      {children}
    </div>
  );
}

export function Proof({ checks, labels, run }: { checks: Checks | null; labels: Labels | null; run: Run | null }) {
  const [open, setOpen] = useState<string>("");
  const inv = checks?.invariants ?? [];
  const pass = inv.filter((i) => i.pass).length;
  const lr = labels?.rows ?? [];
  const right = lr.filter((r) => r.correct).length;
  const u = run?.usage;
  const toggle = (k: string) => setOpen(open === k ? "" : k);
  return (
    <section class="proof" id="proof" aria-labelledby="proof-h">
      <div class="wrap">
        <header class="sec-h"><div><p class="eyebrow">How we know it works</p><h2 id="proof-h">Checked, measured, and honest about the rest</h2></div></header>
        <div class="pgrid">
          <Card k="UGREEN's official Skill checker" big={checks?.official ? `${checks.official.status}` : "not recorded"} sub={checks?.official ? `${checks.official.errors} errors, ${checks.official.warnings} warnings, catalog ${checks.official.catalog}` : "Run the checker from the repository."} ok={!checks?.official || (checks.official.errors + checks.official.warnings === 0)} />
          <Card k="Invariant checks on the saved runs" big={inv.length ? `${pass} of ${inv.length} pass` : "not recorded"} sub="Writes only after approval, dates equal the photo metadata, no cross-spot pairs." ok={!inv.length || pass === inv.length}>
            {inv.length ? <button class="link" aria-expanded={open === "inv"} onClick={() => toggle("inv")}>{open === "inv" ? "Hide checks" : "Show every check"}</button> : null}
            {open === "inv" ? <ul class="plist">{inv.map((i, k) => <li key={k} class={i.pass ? "p" : "f"}><b>{i.pass ? "PASS" : "FAIL"}</b> <span>{i.run}</span> {i.name}</li>)}</ul> : null}
          </Card>
          <Card k="Spot-label accuracy" big={lr.length ? `${right} of ${lr.length} photos` : "not recorded"} sub={labels ? `Vision model ${labels.model} against the staged ground truth.` : ""} ok>
            {lr.length ? <button class="link" aria-expanded={open === "lab"} onClick={() => toggle("lab")}>{open === "lab" ? "Hide photos" : "Show each photo"}</button> : null}
            {open === "lab" ? <ul class="plist">{lr.map((r, k) => <li key={k} class={r.correct ? "p" : "f"}><b>{r.correct ? "RIGHT" : "MISS"}</b> <span>{r.truth}</span> {r.correct ? "" : `labelled ${r.label}`}</li>)}</ul> : null}
          </Card>
          <Card k={run ? `Model use in "${run.id}"` : "Model use"} big={u ? `${u.calls} calls, ${fmtDur(run!.duration_ms)}` : "not recorded"} sub={u ? `${u.input.toLocaleString("en-GB")} tokens in, ${u.output.toLocaleString("en-GB")} out, on ${Object.keys(u.by_model).join(" and ")}. This page makes none.` : ""} ok />
        </div>
      </div>
    </section>
  );
}
