// The emulated NAS: a read-only fixture library plus a sandbox where every write lands.
// Writes never touch the fixture; they go to <out>/nas/ and <out>/albums.json.
import { readdirSync, statSync, readFileSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import exifr from "exifr";

const IMAGE = /\.(jpe?g|png|heic)$/i;
const DOC = /\.(pdf|txt|md|docx?)$/i;

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

const pad = (n) => String(n).padStart(2, "0");
// EXIF times carry no zone; keep them as local wall-clock strings, exactly as the camera wrote them.
export function exifTime(d) {
  if (!(d instanceof Date)) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export class Nas {
  constructor({ fixture, out, captureTimes = null }) {
    this.captureTimes = captureTimes; // tests only: path -> time, instead of reading EXIF
    this.fixture = path.resolve(fixture);
    this.out = path.resolve(out);
    this.sandbox = path.join(this.out, "nas");
    mkdirSync(this.sandbox, { recursive: true });
    this.albums = [];
    this.created = []; // {kind, path}
    this._photos = null;
  }

  async photos() {
    if (this._photos) return this._photos;
    const files = walk(this.fixture).filter((f) => IMAGE.test(f));
    const list = [];
    for (const f of files) {
      // exifr returns EXIF local times as Dates built in the process zone; TZ=UTC is forced in run.mjs.
      if (this.captureTimes) { list.push({ path: f, capture_time: this.captureTimes[f] ?? null, software: null }); continue; }
      const tags = await exifr.parse(path.join(this.fixture, f), ["DateTimeOriginal", "Make", "Model", "Software"]).catch(() => null);
      list.push({ path: f, capture_time: exifTime(tags?.DateTimeOriginal), software: tags?.Software ?? null });
    }
    this._photos = list;
    return list;
  }

  documents() {
    return walk(this.fixture).filter((f) => DOC.test(f));
  }

  exists(p) {
    return existsSync(this.resolveRead(p)) || existsSync(path.join(this.sandbox, p));
  }

  resolveRead(p) {
    const full = path.resolve(this.fixture, p.replace(/^\/+/, ""));
    if (!full.startsWith(this.fixture)) throw new Error(`path escapes the library: ${p}`);
    return full;
  }

  readBytes(p) {
    const sandboxed = path.resolve(this.sandbox, p.replace(/^\/+/, ""));
    if (sandboxed.startsWith(this.sandbox) && existsSync(sandboxed)) return readFileSync(sandboxed);
    return readFileSync(this.resolveRead(p));
  }

  listDir(dir = "") {
    const roots = [this.resolveRead(dir), path.resolve(this.sandbox, dir.replace(/^\/+/, ""))];
    const names = new Set();
    for (const r of roots) if (existsSync(r) && statSync(r).isDirectory()) for (const n of readdirSync(r)) if (!n.startsWith(".")) names.add(n);
    return [...names].sort();
  }

  // ---- writes (sandbox only) ----
  mkdir(p) {
    const full = path.resolve(this.sandbox, p.replace(/^\/+/, ""));
    if (!full.startsWith(this.sandbox)) throw new Error(`path escapes the sandbox: ${p}`);
    mkdirSync(full, { recursive: true });
    this.created.push({ kind: "folder", path: p });
    return p;
  }

  copy(src, dstDir) {
    const dstFull = path.resolve(this.sandbox, dstDir.replace(/^\/+/, ""), path.basename(src));
    if (!dstFull.startsWith(this.sandbox)) throw new Error(`path escapes the sandbox: ${dstDir}`);
    if (existsSync(dstFull)) throw new Error(`exists, not overwritten: ${dstDir}/${path.basename(src)}`);
    mkdirSync(path.dirname(dstFull), { recursive: true });
    copyFileSync(this.resolveRead(src), dstFull);
    const rel = path.relative(this.sandbox, dstFull).split(path.sep).join("/");
    this.created.push({ kind: "copy", path: rel, from: src });
    return rel;
  }

  saveText(dir, name, content) {
    const file = name.endsWith(".md") ? name : `${name}.md`;
    const full = path.resolve(this.sandbox, dir.replace(/^\/+/, ""), file);
    if (!full.startsWith(this.sandbox)) throw new Error(`path escapes the sandbox: ${dir}`);
    mkdirSync(path.dirname(full), { recursive: true });
    if (existsSync(full)) throw new Error(`exists, not overwritten: ${dir}/${file}`);
    writeFileSync(full, content);
    const rel = path.relative(this.sandbox, full).split(path.sep).join("/");
    this.created.push({ kind: "file", path: rel, bytes: Buffer.byteLength(content) });
    return { path: rel, bytes: Buffer.byteLength(content) };
  }

  createAlbum(name, items) {
    const missing = items.filter((i) => !existsSync(this.resolveRead(i)));
    if (missing.length) throw new Error(`not in the library: ${missing.join(", ")}`);
    const album = { album_uuid: `album-${this.albums.length + 1}`, name, items };
    this.albums.push(album);
    this.created.push({ kind: "album", path: name, items });
    writeFileSync(path.join(this.out, "albums.json"), JSON.stringify(this.albums, null, 2));
    return album;
  }
}
