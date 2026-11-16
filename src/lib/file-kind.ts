export type FileKind = "markdown" | "html" | "text" | "external";

const MARKDOWN = new Set(["md", "markdown"]);
const HTML = new Set(["html", "htm"]);
/** Opened in the system default app, never in a Kaelio tab. Mirrors DEFAULT_APP_EXTENSIONS in lib.rs. */
const EXTERNAL = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg"]);

function extensionOf(path: string): string {
  const name = path.split("/").pop() || "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** How Kaelio handles a file. `null` is an untitled note, which is Markdown. */
export function fileKind(path: string | null): FileKind {
  if (path === null) return "markdown";
  const ext = extensionOf(path);
  if (MARKDOWN.has(ext)) return "markdown";
  if (HTML.has(ext)) return "html";
  if (EXTERNAL.has(ext)) return "external";
  return "text";
}
