import { test } from "node:test";
import assert from "node:assert/strict";
import { splitRow, isDelimiterRow, findTable, formatTable, tabInTable } from "./table.ts";

const raw = ["| Name | Role |", "|---|:---:|", "| An | Lead engineer |", "| Binh|Designer"];
const pretty = ["| Name | Role          |", "| ---- | :-----------: |", "| An   | Lead engineer |", "| Binh | Designer      |"];

test("splitRow handles outer pipes, escapes and code", () => {
  assert.deepEqual(splitRow("| a | b |"), ["a", "b"]);
  assert.deepEqual(splitRow("a | b"), ["a", "b"]);
  assert.deepEqual(splitRow("| a \\| b | c |"), ["a \\| b", "c"]);
  assert.deepEqual(splitRow("| `x|y` | z |"), ["`x|y`", "z"]);
  assert.deepEqual(splitRow("| a |  |"), ["a", ""]);
});
test("isDelimiterRow", () => {
  assert.ok(isDelimiterRow("|---|:---:|---:|"));
  assert.ok(!isDelimiterRow("| a | b |"));
  assert.ok(!isDelimiterRow("---"));            // a thematic break, no pipe
});
test("findTable needs a header and a delimiter row", () => {
  assert.deepEqual(findTable(["x", ...raw, "", "y"], 3), { start: 1, end: 4 });
  assert.equal(findTable(["a | b", "c | d"], 0), null);
  assert.equal(findTable(["text with | pipe"], 0), null);
  assert.equal(findTable(["x", ...raw], 0), null);
});
test("formatTable aligns columns and keeps alignment colons", () => {
  assert.deepEqual(formatTable(raw), pretty);
});
test("formatTable pads short rows and keeps indentation", () => {
  assert.deepEqual(formatTable(["  | a | b |", "|---|---|", "| 1 |"]), ["  | a   | b   |", "  | --- | --- |", "  | 1   |     |"]);
});
test("Tab moves to the next cell and selects it", () => {
  const r = tabInTable(raw, 2, 3, 1)!;             // cursor in "An"
  assert.deepEqual(r.newLines, pretty);
  assert.deepEqual([r.selLine, r.selFrom, r.selTo], [2, 9, 22]);   // "Lead engineer"
});
test("Tab from the last header cell skips the delimiter row", () => {
  const r = tabInTable(raw, 0, 10, 1)!;            // cursor in "Role"
  assert.deepEqual([r.selLine, r.selFrom, r.selTo], [2, 2, 4]);    // "An"
});
test("Tab in the last cell adds a row", () => {
  const r = tabInTable(raw, 3, raw[3].length, 1)!;
  assert.deepEqual(r.newLines, [...pretty, "|      |               |"]);
  assert.deepEqual([r.selLine, r.selFrom, r.selTo], [4, 2, 2]);
});
test("Shift+Tab from the first body cell goes to the last header cell", () => {
  const r = tabInTable(raw, 2, 3, -1)!;
  assert.deepEqual([r.selLine, r.selFrom, r.selTo], [0, 9, 13]);   // "Role"
});
test("Shift+Tab in the first header cell stays there", () => {
  const r = tabInTable(raw, 0, 3, -1)!;
  assert.deepEqual([r.selLine, r.selFrom, r.selTo], [0, 2, 6]);    // "Name"
});
test("selLine is absolute when the table is not at the top", () => {
  const r = tabInTable(["intro", "", ...raw], 4, 3, 1)!;
  assert.deepEqual([r.start, r.end, r.selLine], [2, 5, 4]);
});
test("outside a table returns null", () => {
  assert.equal(tabInTable(["just | text"], 0, 3, 1), null);
  assert.equal(tabInTable(["- item"], 0, 2, 1), null);
});
// Review focus 3: escaped and code pipes never split a cell
test("Tab across a cell holding \\| or `a|b` keeps it one cell", () => {
  const t = ["| A | B |", "|---|---|", "| x \\| y | `a|b` |"];
  const r = tabInTable(t, 2, 3, 1)!;
  assert.deepEqual(r.newLines, ["| A      | B     |", "| ------ | ----- |", "| x \\| y | `a|b` |"]);
  assert.deepEqual([r.selLine, r.selFrom, r.selTo], [2, 11, 16]);
});
test("wide characters are counted as one and selection uses string offsets", () => {
  const t = ["| é | 😀 |", "|---|---|", "| a | b |"];
  const r = tabInTable(t, 0, 2, 1)!;
  assert.deepEqual(r.newLines, ["| é   | 😀   |", "| --- | --- |", "| a   | b   |"]);
  assert.deepEqual([r.selLine, r.selFrom, r.selTo], [0, 8, 10]);
});
test("header and delimiter with different column counts is not a table", () => {
  assert.equal(findTable(["| a | b |", "|---|", "| 1 | 2 |"], 0), null);
});
