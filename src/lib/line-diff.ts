// Which lines of a reloaded file changed (spec A3), and which preview blocks
// those lines fall in.

/** 0-based lines of the NEW text, end exclusive. */
export type LineRange = [start: number, end: number];

export const MAX_DIFF_LINES = 20000;

/** Above this many edits the middle is marked as one changed range instead
 *  of being diffed further (keeps the worst case near O((N+M)·D)). */
const MAX_EDITS = 1000;

type Op = "e" | "i" | "d"; // equal, inserted (new line), deleted (old line)

/** Myers diff over line ids: the edit script from a to b, in order. Null
 *  when the edit distance exceeds MAX_EDITS. */
function myers(a: Int32Array, b: Int32Array): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) found = d;
    }
    trace.push(v.slice(off - d, off + d + 1)); // k in [-d, d]
  }
  if (found < 0) return null;
  const rev: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1]; // index k + (d - 1)
    const k = x - y;
    const get = (kk: number) => prev[kk + d - 1];
    const down = k === -d || (k !== d && get(k - 1) < get(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = get(pk);
    const py = px - pk;
    const sx = down ? px : px + 1; // where the edit step ends, before the snake
    for (let e = x - sx; e > 0; e--) rev.push("e");
    rev.push(down ? "i" : "d");
    x = px;
    y = py;
  }
  for (let e = x; e > 0; e--) rev.push("e");
  return rev.reverse();
}

/** Moves each run of insertions (or deletions) as far down as an equivalent
 *  script allows, so an added paragraph claims "text, blank" rather than
 *  "blank, text" and is not drawn into the block above it. */
function slideDown(ops: Op[], a: Int32Array, b: Int32Array): void {
  let ox = 0;
  let ny = 0;
  let i = 0;
  while (i < ops.length) {
    const t = ops[i];
    if (t === "e") { ox++; ny++; i++; continue; }
    let j = i;
    while (j < ops.length && ops[j] === t) j++;
    const len = j - i;
    const lines = t === "i" ? b : a;
    while (j < ops.length && ops[j] === "e" && lines[t === "i" ? ny : ox] === lines[(t === "i" ? ny : ox) + len]) {
      ops[i] = "e";
      ops[j] = t;
      i++; j++; ox++; ny++;
    }
    if (t === "i") ny += len; else ox += len;
    i = j;
  }
}

export function changedLineRanges(oldText: string, newText: string): LineRange[] | null {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) return null;

  let pre = 0;
  while (pre < oldLines.length && pre < newLines.length && oldLines[pre] === newLines[pre]) pre++;
  let suf = 0;
  while (
    suf < oldLines.length - pre && suf < newLines.length - pre &&
    oldLines[oldLines.length - 1 - suf] === newLines[newLines.length - 1 - suf]
  ) suf++;
  const oldMid = oldLines.slice(pre, oldLines.length - suf);
  const newMid = newLines.slice(pre, newLines.length - suf);
  if (oldMid.length === 0 && newMid.length === 0) return [];

  const lastLine = newLines.length - 1;
  const marks: number[] = [];
  const ids = new Map<string, number>();
  const toIds = (lines: string[]) => Int32Array.from(lines, l => {
    let id = ids.get(l);
    if (id === undefined) { id = ids.size; ids.set(l, id); }
    return id;
  });
  const a = toIds(oldLines);
  const b = toIds(newLines);
  const mid = myers(a.subarray(pre, oldLines.length - suf), b.subarray(pre, newLines.length - suf));
  if (mid) {
    // Slide over the whole script, so a run can move into the trimmed suffix
    const ops: Op[] = [...Array<Op>(pre).fill("e"), ...mid, ...Array<Op>(suf).fill("e")];
    slideDown(ops, a, b);
    let ny = 0;
    for (const op of ops) {
      if (op === "e") ny++;
      else if (op === "i") marks.push(ny++);
      else marks.push(Math.min(ny, lastLine)); // removal: the line now after it
    }
  } else if (newMid.length > 0) {
    for (let i = 0; i < newMid.length; i++) marks.push(pre + i);
  } else {
    marks.push(Math.min(pre, lastLine));
  }

  marks.sort((p, q) => p - q);
  const ranges: LineRange[] = [];
  for (const line of marks) {
    const last = ranges[ranges.length - 1];
    if (last && line <= last[1]) last[1] = Math.max(last[1], line + 1);
    else ranges.push([line, line + 1]);
  }
  return ranges;
}

/** Indexes into blockLines (ascending source lines) of the blocks that
 *  overlap any range. Block i covers [blockLines[i], blockLines[i+1]); the
 *  last block runs to the end of the document. */
export function blocksToMark(blockLines: number[], ranges: LineRange[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < blockLines.length; i++) {
    const from = blockLines[i];
    const to = i + 1 < blockLines.length ? blockLines[i + 1] : Infinity;
    if (ranges.some(([s, e]) => s < to && e > from)) out.push(i);
  }
  return out;
}
