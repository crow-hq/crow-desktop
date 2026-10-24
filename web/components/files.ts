// Picking, filtering and costing the files a person adds.

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const JUNK_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini", "icon\r"]);
const BLOCKED_EXT = new Set([
  // images, video, audio
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "svg", "ico", "raw", "psd",
  "mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "flv",
  "mp3", "wav", "flac", "aac", "m4a", "ogg", "aiff", "wma",
  // executables and bundles
  "exe", "dll", "msi", "dmg", "pkg", "app", "apk", "bin", "so", "dylib", "iso", "img", "bat", "cmd", "com", "jar", "class", "o", "a", "lib",
  "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz",
]);
const BINARY_DOC_EXT = new Set(["pdf", "docx", "pptx", "xlsx", "doc", "ppt", "xls", "odt", "ods", "odp"]);

export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

export type Skipped = { name: string; reason: string };

export function junkReason(file: File): string | null {
  const name = file.name;
  const lower = name.toLowerCase();
  if (JUNK_NAMES.has(lower) || name.startsWith(".") || name.startsWith("~$")) return "hidden or system file";
  const ext = extOf(name);
  if (BLOCKED_EXT.has(ext) || /^(image|video|audio)\//.test(file.type)) return "image, media, archive or executable";
  if (file.size > MAX_FILE_BYTES) return "over 50 MB";
  if (file.size === 0) return "empty";
  return null;
}

export function filterFiles(files: File[]): { accepted: File[]; skipped: Skipped[] } {
  const accepted: File[] = [];
  const skipped: Skipped[] = [];
  for (const f of files) {
    const r = junkReason(f);
    if (r) skipped.push({ name: f.name, reason: r });
    else accepted.push(f);
  }
  return { accepted, skipped };
}

export const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  rtf: "application/rtf",
};
export const mimeOf = (f: File) => f.type || MIME[extOf(f.name)] || "application/octet-stream";

export function estimatedTokens(f: { name: string; size: number }): number {
  return f.size / (BINARY_DOC_EXT.has(extOf(f.name)) ? 12 : 4);
}

export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Reads files (and whole folders) out of a drop.
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .filter((i) => i.kind === "file")
    .map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() ?? null);
  if (!entries.length || entries.some((e) => !e)) return Array.from(dt.files);
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((res) => (entry as FileSystemFileEntry).file(res, () => res(null)));
      if (file) out.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res) => reader.readEntries(res, () => res([])));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  for (const e of entries) await walk(e!);
  return out;
}

export const hasFiles = (dt: DataTransfer | null) => !!dt && Array.from(dt.types ?? []).includes("Files");
