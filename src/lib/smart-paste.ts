// Smart paste (spec A1): decide whether a paste goes in as plain text, as a
// Markdown link over the selection, or as Markdown converted from rich HTML.
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export const MAX_PASTE_HTML = 2 * 1024 * 1024;

export type PasteDecision =
  | { kind: "plain" }
  | { kind: "link"; text: string }
  | { kind: "markdown"; text: string };

/** One http(s) URL with nothing else in it; surrounding whitespace is fine. */
export function isSingleUrl(text: string): boolean {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return false;
  try {
    const u = new URL(t);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

// Tags that make clipboard HTML worth converting. A code editor copies only
// styled div/span, which has none of these, so it stays plain text.
const STRUCTURE_TAG = /<(h[1-6]|ul|ol|li|table|strong|b|em|i|pre|code|blockquote|img)(?=[\s/>])/i;
const LINK_WITH_HREF = /<a\s[^>]*\bhref\s*=/i;

export function hasStructure(html: string): boolean {
  return STRUCTURE_TAG.test(html) || LINK_WITH_HREF.test(html);
}

let service: TurndownService | null = null;

function turndown(): TurndownService {
  if (service) return service;
  const s = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  s.use(gfm);
  s.remove(["script", "style", "meta", "link"]);
  s.addRule("dropDataImages", {
    filter: (node) =>
      node.nodeName === "IMG" && /^\s*data:/i.test((node as HTMLElement).getAttribute("src") || ""),
    replacement: () => "",
  });
  service = s;
  return s;
}

export function htmlToMarkdown(html: string): string {
  return turndown().turndown(html).trim();
}

export function decidePaste(input: {
  html: string | null;
  text: string;
  selection: string;
  inCode: boolean;
  forcePlain: boolean;
}): PasteDecision {
  const { html, text, selection, inCode, forcePlain } = input;
  if (forcePlain || inCode) return { kind: "plain" };
  if (selection.length > 0 && isSingleUrl(text) && !isSingleUrl(selection)) {
    return { kind: "link", text: `[${selection}](${text.trim()})` };
  }
  if (html !== null && html.length <= MAX_PASTE_HTML && hasStructure(html)) {
    const md = htmlToMarkdown(html);
    return md ? { kind: "markdown", text: md } : { kind: "plain" };
  }
  return { kind: "plain" };
}
