// Math for markdown-it: `$…$` inline, `$$…$$` display, parsed from the
// Markdown source so line breaks and backslash escapes reach KaTeX intact.
//
// Rules follow Pandoc's tex_math_dollars: an opening `$` must be followed by a
// non-space, a closing `$` must follow a non-space and must not be followed by
// a digit. Stricter than Pandoc, the first `$` after the opener must be that
// closer, so "costs $5 and $10" stays text. Dollars in code spans and fences
// are never math, because those rules consume the code first.
//
// The plugin only parses; `render(tex, display)` turns TeX into HTML and is
// responsible for escaping (KaTeX does, and so must any fallback).

/* eslint-disable @typescript-eslint/no-explicit-any */
type Md = any;

export interface MathOptions {
  render: (tex: string, display: boolean) => string;
}

const DOLLAR = 0x24;
const BACKSLASH = 0x5c;

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** Index of the next unescaped `$$` at or after `from`, or -1. */
function findDoubleClose(src: string, from: number, max: number): number {
  for (let i = from; i + 1 < max; i++) {
    const c = src.charCodeAt(i);
    if (c === BACKSLASH) { i++; continue; }
    if (c === DOLLAR && src.charCodeAt(i + 1) === DOLLAR) return i;
  }
  return -1;
}

function mathInline(state: any, silent: boolean): boolean {
  const src: string = state.src;
  const start: number = state.pos;
  const max: number = state.posMax;
  if (src.charCodeAt(start) !== DOLLAR) return false;

  if (src.charCodeAt(start + 1) === DOLLAR) {
    const end = findDoubleClose(src, start + 2, max);
    if (end < 0) return false;
    const tex = src.slice(start + 2, end);
    if (!tex.trim()) return false;
    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = tex.trim();
      token.markup = "$$";
      token.meta = { display: true };
    }
    state.pos = end + 2;
    return true;
  }

  if (start + 1 >= max || isSpace(src.charCodeAt(start + 1))) return false;
  // The first unescaped `$` after the opener decides: if it cannot close,
  // this is not math. Searching on past it would pair "$5 and $10 … $x$".
  let i = start + 1;
  for (; i < max; i++) {
    const c = src.charCodeAt(i);
    if (c === BACKSLASH) { i++; continue; }
    if (c === DOLLAR) break;
  }
  if (i >= max) return false;
  if (isSpace(src.charCodeAt(i - 1)) || isDigit(src.charCodeAt(i + 1))) return false;
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = src.slice(start + 1, i);
    token.markup = "$";
    token.meta = { display: false };
  }
  state.pos = i + 1;
  return true;
}

function lineText(state: any, line: number): string {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
}

function mathBlock(state: any, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const first = lineText(state, startLine);
  if (!first.startsWith("$$")) return false;

  const rest = first.slice(2);
  const restTrim = rest.trim();
  let content: string;
  let next = startLine;

  if (restTrim.endsWith("$$")) {
    content = restTrim.slice(0, -2);
  } else {
    // Text after the opening `$$` that holds another `$$` is inline math.
    if (rest.includes("$$")) return false;
    const lines = [rest];
    let closed = false;
    for (next = startLine + 1; next < endLine; next++) {
      if (state.sCount[next] < state.blkIndent) break; // left the container
      const text = lineText(state, next);
      if (!text.trim()) break; // a blank line ends the search
      const trimmed = text.trimEnd();
      if (trimmed.endsWith("$$")) {
        lines.push(trimmed.slice(0, -2));
        closed = true;
        break;
      }
      lines.push(text);
    }
    if (!closed) return false;
    content = lines.join("\n");
  }

  content = content.trim();
  if (!content) return false;
  if (silent) return true;

  state.line = next + 1;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = content;
  token.markup = "$$";
  token.map = [startLine, state.line];
  return true;
}

export function mathPlugin(md: Md, options: MathOptions): void {
  md.inline.ruler.before("escape", "math_inline", mathInline);
  md.block.ruler.before("fence", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  md.renderer.rules.math_inline = (tokens: any[], idx: number) =>
    options.render(tokens[idx].content, Boolean(tokens[idx].meta?.display));
  md.renderer.rules.math_block = (tokens: any[], idx: number, _opts: any, _env: any, self: any) =>
    `<div class="math-block"${self.renderAttrs(tokens[idx])}>${options.render(tokens[idx].content, true)}</div>\n`;
}
