/**
 * Resolves a relative link from a note's preview to a file-system path.
 * The note's folder is percent-encoded before it becomes a URL base (so spaces and
 * `#` in folder names survive), and the result is decoded back to a real path.
 * Returns null when the link's encoding is malformed.
 */
export function resolveLinkedPath(linkPath: string, notePath: string): string | null {
  const dir = notePath.substring(0, notePath.lastIndexOf("/"));
  const base = "file://" + dir.split("/").map(encodeURIComponent).join("/") + "/";
  try {
    const url = new URL(linkPath, base);
    if (url.protocol !== "file:") return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}
