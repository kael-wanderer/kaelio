// Markdown pipe-table editing (spec A2): find the table around the cursor,
// re-align it, and move the cursor cell by cell with Tab / Shift+Tab.

/** Positions of the pipes that separate cells. A pipe escaped with "\" or
 *  inside an inline code span is part of the cell text. */
function separatorPositions(line: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") { i += 2; continue; }
    if (ch === "`") {
      let n = 0;
      while (line[i + n] === "`") n++;
      const fence = "`".repeat(n);
      // A code span closes at the next backtick run of the same length.
      let j = i + n;
      let close = -1;
      while (j < line.length) {
        const k = line.indexOf(fence, j);
        if (k < 0) break;
        let m = 0;
        while (line[k + m] === "`") m++;
        if (m === n) { close = k; break; }
        j = k + m;
      }
      i = close >= 0 ? close + n : i + n;
      continue;
    }
    if (ch === "|") out.push(i);
    i++;
  }
  return out;
}

interface RowParts { cells: string[]; /** raw [from, to) of each cell in the line */ spans: [number, number][] }

function rowParts(line: string): RowParts {
  const seps = separatorPositions(line);
  const bounds = [-1, ...seps, line.length];
  let spans: [number, number][] = [];
  for (let k = 0; k + 1 < bounds.length; k++) spans.push([bounds[k] + 1, bounds[k + 1]]);
  const trimmed = line.trim();
  const leadPipe = seps.length > 0 && trimmed.startsWith("|") && seps[0] === line.indexOf("|");
  const lastNonWs = line.trimEnd().length - 1;
  const trailPipe = seps.length > 0 && seps[seps.length - 1] === lastNonWs && !(leadPipe && seps.length === 1);
  if (leadPipe) spans = spans.slice(1);
  if (trailPipe) spans = spans.slice(0, -1);
  return { cells: spans.map(([a, b]) => line.slice(a, b).trim()), spans };
}

/** Trimmed cells; outer pipes optional; "\|" and pipes inside `code` are not separators. */
export function splitRow(line: string): string[] {
  return rowParts(line).cells;
}

function hasSeparator(line: string): boolean {
  return line.trim() !== "" && separatorPositions(line).length > 0;
}

/** Every cell matches /^:?-+:?$/ (and the line has a pipe, so "---" is not one). */
export function isDelimiterRow(line: string): boolean {
  if (!hasSeparator(line)) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));
}

/** The table containing lineIndex, inclusive; lines[start+1] is the delimiter row. */
export function findTable(lines: string[], lineIndex: number): { start: number; end: number } | null {
  if (lineIndex < 0 || lineIndex >= lines.length || !hasSeparator(lines[lineIndex])) return null;
  let start = lineIndex;
  while (start > 0 && hasSeparator(lines[start - 1])) start--;
  let end = lineIndex;
  while (end + 1 < lines.length && hasSeparator(lines[end + 1])) end++;
  // The header is the row right above the first delimiter row with the same
  // number of cells; a prose line with a pipe may sit above it.
  let header = -1;
  for (let h = start; h < end; h++) {
    if (isDelimiterRow(lines[h + 1]) && splitRow(lines[h]).length === splitRow(lines[h + 1]).length) {
      header = h;
      break;
    }
  }
  if (header < 0 || lineIndex < header) return null;
  return { start: header, end };
}

const width = (s: string) => [...s].length;

interface Layout {
  indent: string;
  widths: number[];
  rows: string[][];
  aligns: [boolean, boolean][];
  /** Cells beyond the header's count, kept as written (GFM ignores them). */
  extras: string[][];
}

function layout(rows: string[]): Layout {
  const indent = /^\s*/.exec(rows[0] ?? "")![0];
  const cells = rows.map(splitRow);
  const ncols = cells[0].length;
  const aligns = Array.from({ length: ncols }, (_, k): [boolean, boolean] => {
    const d = cells[1]?.[k] ?? "";
    return [d.startsWith(":"), d.length > 1 && d.endsWith(":")];
  });
  const padded = cells.map(r => Array.from({ length: ncols }, (_, k) => r[k] ?? ""));
  const extras = cells.map(r => r.slice(ncols));
  const widths = Array.from({ length: ncols }, (_, k) =>
    Math.max(3, ...padded.filter((_, r) => r !== 1).map(r => width(r[k]))));
  return { indent, widths, rows: padded, aligns, extras };
}

function renderRow(l: Layout, r: number): string {
  const parts = l.rows[r].map((cell, k) => {
    if (r === 1) {
      const [left, right] = l.aligns[k];
      const dashes = l.widths[k] - (left ? 1 : 0) - (right ? 1 : 0);
      return (left ? ":" : "") + "-".repeat(Math.max(1, dashes)) + (right ? ":" : "");
    }
    return cell + " ".repeat(l.widths[k] - width(cell));
  });
  const extra = (l.extras[r] ?? []).map(cell => ` ${cell} |`).join("");
  return `${l.indent}| ${parts.join(" | ")} |${extra}`;
}

export function formatTable(rows: string[]): string[] {
  const l = layout(rows);
  return l.rows.map((_, r) => renderRow(l, r));
}

export interface TabResult { start: number; end: number; newLines: string[]; selLine: number; selFrom: number; selTo: number }

function cellAt(line: string, column: number): number {
  const { spans } = rowParts(line);
  for (let k = 0; k < spans.length; k++) if (column <= spans[k][1]) return k;
  return Math.max(0, spans.length - 1);
}

export function tabInTable(lines: string[], lineIndex: number, column: number, dir: 1 | -1): TabResult | null {
  const t = findTable(lines, lineIndex);
  if (!t) return null;
  const rows = lines.slice(t.start, t.end + 1);
  const l = layout(rows);
  const ncols = l.widths.length;
  const lastRow = rows.length - 1;
  let r = lineIndex - t.start;
  let c = cellAt(lines[lineIndex], column);
  if (r === 1) { r = 0; c = ncols - 1; } // on the delimiter row: act as if on the last header cell
  const inExtra = c >= ncols; // a cell beyond the header's count
  c = Math.min(c, ncols - 1);

  let tr = r;
  let tc = inExtra && dir === -1 ? ncols - 1 : c + dir;
  if (dir === 1 && tc >= ncols) {
    tc = 0;
    tr = r + 1 === 1 ? 2 : r + 1;
  } else if (dir === -1 && tc < 0) {
    tc = ncols - 1;
    tr = r - 1 === 1 ? 0 : r - 1;
    if (tr < 0) { tr = 0; tc = 0; }
  }
  if (tr > lastRow) {
    l.rows.push(Array.from({ length: ncols }, () => ""));
    l.extras.push([]);
  }
  const newLines = l.rows.map((_, k) => renderRow(l, k));
  const before = `${l.indent}| ` + l.rows[tr].slice(0, tc).map((cell, k) => cell + " ".repeat(l.widths[k] - width(cell)) + " | ").join("");
  const selFrom = before.length;
  const selTo = selFrom + l.rows[tr][tc].length;
  return { start: t.start, end: t.end, newLines, selLine: t.start + tr, selFrom, selTo };
}
