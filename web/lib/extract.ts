import JSZip from "jszip";

// Turns an uploaded file into plain text / Markdown sections. One section per document,
// except spreadsheets, where every sheet is its own section (and becomes its own note).

export type Extracted =
  | { kind: "text"; sections: { name: string; text: string }[] }
  | { kind: "skip"; reason: string };

const MAX_SHEET_ROWS = 2000;

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function ext(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

const TEXT_EXT = new Set(["md", "markdown", "txt", "text", "json", "yaml", "yml", "xml", "html", "htm", "log", "rtf", "tex", "srt", "vtt", "ini", "toml"]);

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 4096);
  if (sample.length === 0) return false;
  let bad = 0;
  for (const b of sample) if (b === 0 || (b < 7) || (b > 13 && b < 32 && b !== 27)) bad++;
  return bad / sample.length < 0.02;
}

function single(filename: string, text: string): Extracted {
  const t = text.replace(/\r\n?/g, "\n").trim();
  if (t.length < 10) return { kind: "skip", reason: "no readable text in file" };
  return { kind: "text", sections: [{ name: baseName(filename), text: t }] };
}

async function fromPdf(buf: Buffer, filename: string): Promise<Extracted> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  const merged = (Array.isArray(text) ? text.join("\n\n") : text).trim();
  if (merged.replace(/\s/g, "").length < 50) return { kind: "skip", reason: "scanned PDF, no text layer" };
  return single(filename, merged);
}

async function fromDocx(buf: Buffer, filename: string): Promise<Extracted> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return single(filename, value);
}

function numericKey(name: string): number {
  const m = name.match(/(\d+)\.xml$/);
  return m ? parseInt(m[1], 10) : 0;
}

async function fromPptx(buf: Buffer, filename: string): Promise<Extracted> {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => numericKey(a) - numericKey(b));
  const parts: string[] = [];
  let i = 0;
  for (const name of slides) {
    i++;
    const xml = await zip.files[name].async("string");
    const paragraphs: string[] = [];
    for (const p of xml.match(/<a:p[ >][\s\S]*?<\/a:p>/g) ?? []) {
      const line = [...p.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1])).join("");
      if (line.trim()) paragraphs.push(line.trim());
    }
    if (paragraphs.length) parts.push(`## Slide ${i}\n\n${paragraphs.join("\n")}`);
  }
  return single(filename, parts.join("\n\n"));
}

async function fromOdt(buf: Buffer, filename: string): Promise<Extracted> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("content.xml");
  if (!file) return { kind: "skip", reason: "invalid ODT file" };
  const xml = await file.async("string");
  const out: string[] = [];
  for (const m of xml.matchAll(/<text:(h|p)\b[^>]*?(?:\/>|>([\s\S]*?)<\/text:\1>)/g)) {
    const inner = (m[2] ?? "")
      .replace(/<text:tab\s*\/>/g, "\t")
      .replace(/<text:line-break\s*\/>/g, "\n")
      .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, c) => " ".repeat(c ? parseInt(c, 10) : 1))
      .replace(/<[^>]+>/g, "");
    const text = decodeXml(inner).trim();
    if (!text) continue;
    out.push(m[1] === "h" ? `## ${text}` : text);
  }
  return single(filename, out.join("\n\n"));
}

function cell(v: unknown): string {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

async function fromSheet(buf: Buffer, filename: string): Promise<Extracted> {
  const XLSX = await import("xlsx");
  // CSV/TSV values stay as written (no "2026-01-02" → "1/2/26"); real spreadsheet dates come out as ISO dates.
  const plainText = /\.(csv|tsv)$/i.test(filename);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true, dateNF: "yyyy-mm-dd", raw: plainText });
  const sections: { name: string; text: string }[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "", blankrows: false, dateNF: "yyyy-mm-dd" });
    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
    if (nonEmpty.length === 0) continue;
    const width = Math.max(...nonEmpty.map((r) => r.length));
    const pad = (r: unknown[]) => Array.from({ length: width }, (_, i) => cell(r[i]));
    const shown = nonEmpty.slice(0, MAX_SHEET_ROWS + 1);
    const [head, ...body] = shown.map(pad);
    const lines = [
      `| ${head.join(" | ")} |`,
      `| ${head.map(() => "---").join(" | ")} |`,
      ...body.map((r) => `| ${r.join(" | ")} |`),
    ];
    let text = lines.join("\n");
    if (nonEmpty.length > shown.length) text += `\n\n(Truncated: showing ${MAX_SHEET_ROWS} of ${nonEmpty.length - 1} data rows.)`;
    const single1 = wb.SheetNames.length === 1;
    sections.push({ name: single1 ? baseName(filename) : `${baseName(filename)} - ${sheetName}`, text });
  }
  if (sections.length === 0) return { kind: "skip", reason: "spreadsheet is empty" };
  return { kind: "text", sections };
}

export async function extractText(buf: Buffer, filename: string, mime: string): Promise<Extracted> {
  const e = ext(filename);
  const m = (mime || "").toLowerCase();
  try {
    if (e === "pdf" || m === "application/pdf") return await fromPdf(buf, filename);
    if (e === "docx" || m.includes("wordprocessingml")) return await fromDocx(buf, filename);
    if (e === "pptx" || m.includes("presentationml")) return await fromPptx(buf, filename);
    if (["xlsx", "xls", "ods", "csv", "tsv"].includes(e) || m.includes("spreadsheet") || m === "text/csv" || m === "application/vnd.ms-excel")
      return await fromSheet(buf, filename);
    if (e === "odt" || m === "application/vnd.oasis.opendocument.text") return await fromOdt(buf, filename);
    if (TEXT_EXT.has(e) || m.startsWith("text/") || looksLikeText(buf)) return single(filename, buf.toString("utf-8"));
  } catch (err) {
    return { kind: "skip", reason: `could not read file: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { kind: "skip", reason: `unsupported file type (${e || m || "unknown"})` };
}
