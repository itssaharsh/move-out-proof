// Emulated NAS capabilities, named after UGREEN's public capability catalog (catalog 2.0.0).
// Each expert sees only its own CLIs. Writes go through the approval gate, as the catalog's
// "gateway" and "workflow" approval values require.
import path from "node:path";

const S = (description) => ({ type: "STRING", description });
const ok = (data) => ({ ok: true, data });
const fail = (code, message) => ({ ok: false, error: { code, message } });

function inWindow(t, start, end) {
  if (!t) return false;
  const d = t.slice(0, 10);
  return d >= start.slice(0, 10) && d <= end.slice(0, 10);
}

function asList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  const s = v.trim();
  if (s.startsWith("[")) try { return JSON.parse(s); } catch { /* fall through */ }
  return s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
}

async function askModel(ctx, parts, system) {
  const r = await ctx.model.generate({ agent: ctx.agent + ":model", system, contents: [{ role: "user", parts }] });
  return r.text;
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// name -> { cli, action, approval, decl, run(args, ctx) }
const ACTIONS = {
  // ---------------- ug-photo (photo-agent) ----------------
  search_picture: {
    cli: "ug-photo", action: "search-picture", approval: "none",
    decl: { description: "Search the photo library. Filters: capture time window (start_time, end_time as YYYY-MM-DD), file_type, location. Returns file paths and capture times from photo metadata.",
      parameters: { type: "OBJECT", properties: { start_time: S("YYYY-MM-DD"), end_time: S("YYYY-MM-DD"), file_type: S("all | image | video"), location: S("optional place name") } } },
    async run(a, ctx) {
      const photos = await ctx.nas.photos();
      let items = photos;
      if (a.start_time || a.end_time) items = items.filter((p) => inWindow(p.capture_time, a.start_time ?? "0000", a.end_time ?? "9999"));
      const undated = photos.filter((p) => !p.capture_time).length;
      return ok({ total: items.length, items: items.map((p) => ({ path: p.path, capture_time: p.capture_time })), photos_without_capture_time: undated, location_filter: a.location ? "no location metadata in this library; filter not applied" : undefined });
    },
  },
  meta: {
    cli: "ug-photo", action: "meta", approval: "none",
    decl: { description: "Read EXIF metadata of one photo (capture time, software).", parameters: { type: "OBJECT", properties: { path: S("photo path") }, required: ["path"] } },
    async run(a, ctx) {
      const p = (await ctx.nas.photos()).find((x) => x.path === a.path);
      return p ? ok({ path: p.path, capture_time: p.capture_time, software: p.software }) : fail("NOT_FOUND", `no photo at ${a.path}`);
    },
  },
  vision_vlm: {
    cli: "ug-photo", action: "vision-vlm", approval: "none",
    decl: { description: "Run the on-device vision-language model on ONE photo with a text prompt; returns the model's answer.", parameters: { type: "OBJECT", properties: { path: S("photo path"), prompt: S("question about the photo") }, required: ["path", "prompt"] } },
    async run(a, ctx) {
      if (!ctx.nas.exists(a.path)) return fail("NOT_FOUND", `no photo at ${a.path}`);
      const data = ctx.nas.readBytes(a.path).toString("base64");
      const text = await askModel(ctx, [{ inlineData: { mimeType: "image/jpeg", data } }, { text: a.prompt }], "You are an image description model. Answer only what the image shows.");
      return ok({ path: a.path, answer: text });
    },
  },
  create_album: {
    cli: "ug-photo", action: "create-album", approval: "workflow",
    decl: { description: "Create a photo album with the given photo paths (needs the person's approval).", parameters: { type: "OBJECT", properties: { album_name: S("album name"), add_item: { type: "ARRAY", items: { type: "STRING" }, description: "photo paths to add, in order" } }, required: ["album_name", "add_item"] } },
    async run(a, ctx) {
      const items = asList(a.add_item);
      return ok(ctx.nas.createAlbum(a.album_name, items));
    },
  },
  // ---------------- ug-document (document-agent) ----------------
  qa: {
    cli: "ug-document", action: "qa", approval: "none",
    decl: { description: "Answer a question over documents. With file: read those files. Without file: look across the documents the person can access.", parameters: { type: "OBJECT", properties: { query: S("question"), file: { type: "ARRAY", items: { type: "STRING" } }, intent: S("qa | semantic_lookup | extraction | summary") }, required: ["query"] } },
    async run(a, ctx) {
      const files = asList(a.file).length ? asList(a.file) : ctx.nas.documents().slice(0, 12);
      if (!files.length) return ok({ answer: "no documents found", evidence: [] });
      const parts = [];
      for (const f of files) {
        if (!ctx.nas.exists(f)) return fail("NOT_FOUND", `no document at ${f}`);
        parts.push({ text: `File: ${f}` }, { inlineData: { mimeType: f.endsWith(".pdf") ? "application/pdf" : "text/plain", data: ctx.nas.readBytes(f).toString("base64") } });
      }
      parts.push({ text: `${a.query}\nAnswer briefly. Name the file path for each fact. If nothing matches, say no match.` });
      return ok({ answer: await askModel(ctx, parts, "You are a document question-answering model."), evidence: files });
    },
  },
  extract: {
    cli: "ug-document", action: "extract", approval: "none",
    decl: { description: "Structured extraction from documents with a schema (auto, invoice, contract, expense, receipt, mixed). Returns data, coverage and failures.", parameters: { type: "OBJECT", properties: { query: S("what to extract"), file: { type: "ARRAY", items: { type: "STRING" } }, schema: S("auto | contract | invoice | receipt | mixed"), content_scope: S("auto | preview | full") }, required: ["query", "file"] } },
    async run(a, ctx) {
      const files = asList(a.file);
      const data = [], failures = [];
      for (const f of files) {
        if (!ctx.nas.exists(f)) { failures.push({ file: f, reason: "not found" }); continue; }
        const text = await askModel(ctx, [
          { inlineData: { mimeType: f.endsWith(".pdf") ? "application/pdf" : "text/plain", data: ctx.nas.readBytes(f).toString("base64") } },
          { text: `${a.query}\nSchema: ${a.schema ?? "auto"}. Return ONLY JSON: {"sender":"","letter_date":"","deposit":"","total_deductions":"","response_deadline":"","lines":[{"description":"exactly as written","amount":"with currency","room_or_item":""}]}. Use empty strings for fields the document does not state. Never invent lines.` },
        ], "You are a document extraction model. Copy values exactly as printed.");
        const json = parseJson(text);
        if (json) data.push({ file: f, ...json }); else failures.push({ file: f, reason: "unreadable" });
      }
      return ok({ data, coverage: { files: files.length, extracted: data.length }, failures });
    },
  },
  // ---------------- ug-filesystem (file-agent) ----------------
  ls: {
    cli: "ug-filesystem", action: "ls", approval: "none",
    decl: { description: "List a directory.", parameters: { type: "OBJECT", properties: { path: S("directory, '' for the root") } } },
    async run(a, ctx) { return ok({ path: a.path ?? "", entries: ctx.nas.listDir(a.path ?? "") }); },
  },
  stat: {
    cli: "ug-filesystem", action: "stat", approval: "none",
    decl: { description: "Check that a path exists.", parameters: { type: "OBJECT", properties: { path: S("path") }, required: ["path"] } },
    async run(a, ctx) { return ctx.nas.exists(a.path) ? ok({ path: a.path, exists: true }) : fail("NOT_FOUND", `no such path ${a.path}`); },
  },
  mkdir: {
    cli: "ug-filesystem", action: "mkdir", approval: "gateway",
    decl: { description: "Create a directory (needs approval).", parameters: { type: "OBJECT", properties: { path: S("directory to create"), parents: { type: "BOOLEAN" } }, required: ["path"] } },
    async run(a, ctx) { return ok({ path: ctx.nas.mkdir(a.path) }); },
  },
  cpmv: {
    cli: "ug-filesystem", action: "cpmv", approval: "gateway",
    decl: { description: "Copy or move a file into a directory (needs approval). Never overwrites.", parameters: { type: "OBJECT", properties: { src: S("source file"), dst: S("destination directory"), type: S("copy | move") }, required: ["src", "dst"] } },
    async run(a, ctx) {
      if ((a.type ?? "copy") !== "copy") return fail("UNSUPPORTED_IN_EMULATOR", "the emulator only copies; originals are never moved");
      try { return ok({ src: a.src, dst: ctx.nas.copy(a.src, a.dst) }); } catch (e) { return fail("WRITE_FAILED", e.message); }
    },
  },
  // ---------------- ug-knowledge (knowledge-agent) ----------------
  save_text: {
    cli: "ug-knowledge", action: "save-text", approval: "workflow",
    decl: { description: "Save text or Markdown as a file in a folder (needs approval). Returns verified output file and bytes.", parameters: { type: "OBJECT", properties: { path: S("folder"), content: S("text to save"), filename_hint: S("file name") }, required: ["path", "content"] } },
    async run(a, ctx) {
      try {
        const r = ctx.nas.saveText(a.path, a.filename_hint ?? "note", a.content);
        return ok({ verified: true, outputFile: r.path, contentBytes: r.bytes });
      } catch (e) { return fail("WRITE_FAILED", e.message); }
    },
  },
};

export const EXPERTS = {
  "photo-agent": ["search_picture", "meta", "vision_vlm", "create_album"],
  "document-agent": ["qa", "extract"],
  "file-agent": ["ls", "stat", "mkdir", "cpmv"],
  "knowledge-agent": ["save_text"],
};

export function toolsFor(agent) {
  return (EXPERTS[agent] ?? []).map((name) => ({ name, ...ACTIONS[name].decl }));
}

export async function invoke(name, args, ctx) {
  const spec = ACTIONS[name];
  if (!spec || !EXPERTS[ctx.agent]?.includes(name)) return fail("UNKNOWN_ACTION", `${ctx.agent} has no action ${name}`);
  const t0 = Date.now();
  const step = ctx.trace.add({ kind: "action", delegate: ctx.delegateId, agent: ctx.agent, cli: spec.cli, action: spec.action, args });
  let result;
  if (spec.approval !== "none") {
    const approved = await ctx.gate({ agent: ctx.agent, cli: spec.cli, action: spec.action, args, delegateId: ctx.delegateId });
    if (!approved) result = fail("APPROVAL_DECLINED", "the person declined this write");
  }
  if (!result) {
    try { result = await spec.run(args, ctx); } catch (e) { result = fail("ACTION_FAILED", e.message); }
  }
  step.result = result;
  step.ms = Date.now() - t0;
  step.write = spec.approval !== "none";
  return result;
}

export const _test = { inWindow, asList, parseJson, ACTIONS, base: path.basename };
