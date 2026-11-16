import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHeadings, activeHeadingIndex } from "./outline.ts";

test("ATX headings with level, text and 1-based line", () => {
  assert.deepEqual(extractHeadings("# A\n\ntext\n## B"), [
    { level: 1, text: "A", line: 1 }, { level: 2, text: "B", line: 4 },
  ]);
});
test("headings inside fenced code are ignored", () => {
  assert.deepEqual(extractHeadings("```sh\n# not a heading\n```\n# Real"), [{ level: 1, text: "Real", line: 4 }]);
});
test("tilde fences are fences too", () => {
  assert.deepEqual(extractHeadings("~~~\n# no\n~~~"), []);
});
test("a fence closes only with the same marker", () => {
  assert.deepEqual(extractHeadings("````\n```\n# no\n````\n# yes"), [{ level: 1, text: "yes", line: 5 }]);
});
test("YAML front matter comments are not headings, lines still count", () => {
  assert.deepEqual(extractHeadings("---\n# comment: x\ntitle: t\n---\n# Real"), [{ level: 1, text: "Real", line: 5 }]);
});
test("hash without a space is not a heading", () => {
  assert.deepEqual(extractHeadings("#tag"), []);
});
test("trailing closing hashes are dropped", () => {
  assert.deepEqual(extractHeadings("## Title ##"), [{ level: 2, text: "Title", line: 1 }]);
});
test("active heading is the last one at or above the top line", () => {
  assert.equal(activeHeadingIndex([1, 10, 30], 12), 1);
  assert.equal(activeHeadingIndex([1, 10, 30], 10), 1);
});
test("no heading above the top line gives -1", () => {
  assert.equal(activeHeadingIndex([5, 10], 2), -1);
  assert.equal(activeHeadingIndex([], 2), -1);
});
