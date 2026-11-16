export interface Heading {
  level: number;
  text: string;
  /** 1-based line number in the source */
  line: number;
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;

/**
 * ATX headings of a Markdown document, skipping fenced code blocks
 * (backtick or tilde, closed only by the same marker at least as long)
 * and a leading YAML front matter block.
 */
export function extractHeadings(content: string): Heading[] {
  const lines = content.split("\n");
  const headings: Heading[] = [];
  let start = 0;
  if (lines[0]?.trimEnd() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
    if (end > 0) start = end + 1;
  }
  let fence: { ch: string; len: number } | null = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const f = line.match(FENCE_RE);
    if (fence) {
      if (f && f[1][0] === fence.ch && f[1].length >= fence.len && line.trim() === f[1]) fence = null;
      continue;
    }
    if (f) {
      fence = { ch: f[1][0], len: f[1].length };
      continue;
    }
    const m = line.match(HEADING_RE);
    if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: i + 1 });
  }
  return headings;
}

/** Index of the last heading at or above `topLine`, or -1 if none. `headingLines` is ascending. */
export function activeHeadingIndex(headingLines: number[], topLine: number): number {
  let idx = -1;
  for (let i = 0; i < headingLines.length; i++) {
    if (headingLines[i] <= topLine) idx = i;
    else break;
  }
  return idx;
}
