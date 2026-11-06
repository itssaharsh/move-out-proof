import { h, Fragment, type ComponentChildren } from "preact";

function inline(text: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:[^()]|\([^)]*\))+\))/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else {
      const mm = t.match(/^\[([^\]]+)\]\(((?:[^()]|\([^)]*\))+)\)$/)!;
      out.push(<a key={k++} href={mm[2]} target="_blank" rel="noreferrer noopener">{mm[1]}</a>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Tiny Markdown renderer for the report, the final message and CREDITS.md. */
export function Md({ src }: { src: string }) {
  const lines = src.replace(/\r/g, "").split("\n");
  const blocks: ComponentChildren[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const hd = l.match(/^(#{1,4})\s+(.*)$/);
    if (hd) { blocks.push(<p class="md-h" key={k++}>{inline(hd[2])}</p>); i++; continue; }
    if (l.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      const body = rows.filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
      blocks.push(<div class="md-table" key={k++}><table><thead><tr>{body[0].map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{body.slice(1).map((r, a) => <tr key={a}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "")); i++; }
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={k++}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</L>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\||\s*([-*]|\d+\.)\s+)/.test(lines[i])) { para.push(lines[i]); i++; }
    blocks.push(<p key={k++}>{inline(para.join(" "))}</p>);
  }
  return <Fragment>{blocks}</Fragment>;
}
