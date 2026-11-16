import { test } from "node:test";
import assert from "node:assert/strict";
import { changedLineRanges, blocksToMark, MAX_DIFF_LINES } from "./line-diff.ts";

test("identical text has no changes", () => { assert.deepEqual(changedLineRanges("a\nb", "a\nb"), []); });
test("one changed line", () => { assert.deepEqual(changedLineRanges("a\nb\nc", "a\nB\nc"), [[1, 2]]); });
test("inserted line", () => { assert.deepEqual(changedLineRanges("a\nc", "a\nb\nc"), [[1, 2]]); });
test("removed line marks the line after it", () => { assert.deepEqual(changedLineRanges("a\nb\nc", "a\nc"), [[1, 2]]); });
test("removed last line marks the new last line", () => { assert.deepEqual(changedLineRanges("a\nb", "a"), [[0, 1]]); });
test("two separate changes give two ranges", () => {
  assert.deepEqual(changedLineRanges("a\nb\nc\nd\ne", "a\nB\nc\nd\nE"), [[1, 2], [4, 5]]);
});
test("adjacent changed lines merge into one range", () => {
  assert.deepEqual(changedLineRanges("a\nb\nc\nd", "a\nB\nC\nd"), [[1, 3]]);
});
test("everything new", () => { assert.deepEqual(changedLineRanges("", "a\nb"), [[0, 2]]); });
test("too large returns null", () => {
  const big = "x\n".repeat(MAX_DIFF_LINES + 1);
  assert.equal(changedLineRanges(big, big + "y"), null);
});
test("a removal and an insertion in one middle give two ranges", () => {
  // removal of "2" marks line 2 ("3"), insertion of "X" marks line 4
  assert.deepEqual(changedLineRanges("h\n1\n2\n3\n4\nt", "h\n1\n3\n4\nX\nt"), [[2, 3], [4, 5]]);
});
test("20,000-line inputs finish under 2 s", () => {
  const n = 20000;
  const scattered = Array.from({ length: n }, (_, i) => `line ${i} of the document`);
  const edited = scattered.map((l, i) => (i % 500 === 0 ? l + " edited" : l));
  const different = Array.from({ length: n }, (_, i) => `other ${i * 7} text`);
  const t0 = performance.now();
  const a = changedLineRanges(scattered.join("\n"), edited.join("\n"));
  const b = changedLineRanges(scattered.join("\n"), different.join("\n"));
  const ms = performance.now() - t0;
  assert.equal(a!.length, n / 500);
  assert.deepEqual(b, [[0, n]]);
  assert.ok(ms < 2000, `took ${ms} ms`);
});
test("blocksToMark picks the block that contains the range", () => {
  assert.deepEqual(blocksToMark([0, 2, 5], [[3, 4]]), [1]);
  assert.deepEqual(blocksToMark([0, 2, 5], [[5, 6]]), [2]);
  assert.deepEqual(blocksToMark([0, 2, 5], [[0, 1], [2, 3]]), [0, 1]);
  assert.deepEqual(blocksToMark([0, 2, 5], [[1, 6]]), [0, 1, 2]);
});
test("a range above the first block marks nothing", () => {
  assert.deepEqual(blocksToMark([3, 5], [[0, 2]]), []);
});
// Found in dev: an appended paragraph after a list marked the list too,
// because the inserted blank line was aligned above the paragraph.
test("an appended paragraph marks only the new lines, not the block above", () => {
  const old = "# T\n\nPara\n\n- item\n";
  const now = "# T\n\nPara CHANGED\n\n- item\n\nA new paragraph.\n";
  assert.deepEqual(changedLineRanges(old, now), [[2, 3], [6, 8]]);
});
test("a paragraph inserted between two others is aligned to its own lines", () => {
  assert.deepEqual(changedLineRanges("A\n\nB\n\nC", "A\n\nNEW\n\nB\n\nC CHANGED"), [[2, 4], [6, 7]]);
});
test("a removed paragraph marks the block that follows it", () => {
  assert.deepEqual(changedLineRanges("A\n\nX\n\nB\n\nC", "A\n\nB\n\nC CHANGED"), [[2, 3], [4, 5]]);
});
