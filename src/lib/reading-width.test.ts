import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReadingWidth, readingWidthCss, nextReadingWidth, type ReadingWidth } from "./reading-width.ts";

test("stored values round-trip", () => {
  for (const w of ["narrow", "medium", "wide", "full"]) assert.equal(parseReadingWidth(w), w);
});
test("missing or unknown value is medium", () => {
  assert.equal(parseReadingWidth(null), "medium");
  assert.equal(parseReadingWidth("huge"), "medium");
});
test("css values", () => {
  assert.deepEqual(["narrow", "medium", "wide", "full"].map(w => readingWidthCss(w as ReadingWidth)),
    ["60ch", "75ch", "90ch", "none"]);
});
test("cycle goes narrow, medium, wide, full and wraps", () => {
  assert.deepEqual(["narrow", "medium", "wide", "full"].map(w => nextReadingWidth(w as ReadingWidth)),
    ["medium", "wide", "full", "narrow"]);
});
