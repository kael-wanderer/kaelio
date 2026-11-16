const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i;

/**
 * Local file path for an `<img src>` written in a Markdown note, resolved
 * against the note's folder. Returns null for URLs with a scheme (http, data,
 * blob, asset…), protocol-relative URLs, non-image files or bad encoding.
 */
export function resolveLocalImagePath(src: string, noteDir: string): string | null {
  if (!src || !noteDir) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) return null;
  let path = src.replace(/[?#].*$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (!IMAGE_EXT.test(path)) return null;
  const joined = path.startsWith("/") ? path : `${noteDir.replace(/\/+$/, "")}/${path}`;
  const out: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return "/" + out.join("/");
}
