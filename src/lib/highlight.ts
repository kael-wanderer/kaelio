import hljs from "highlight.js/lib/common";

/**
 * markdown-it `highlight` callback. Returns highlighted HTML (highlight.js
 * escapes the code), or "" so markdown-it escapes the code itself. Never
 * auto-detects a language; mermaid fences stay untouched for the diagram step.
 */
export function highlightCode(code: string, lang: string): string {
  const name = (lang || "").trim().toLowerCase();
  if (!name || name === "mermaid" || !hljs.getLanguage(name)) return "";
  try {
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  } catch {
    return "";
  }
}
