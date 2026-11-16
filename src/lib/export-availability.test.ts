import { test } from "node:test";
import assert from "node:assert/strict";
import { exportAvailability } from "./export-availability.ts";

test("markdown and untitled can export everything", () => {
  for (const p of ["/a.md", null]) assert.deepEqual(exportAvailability(p), { pdf: true, docx: true, png: true });
});
test("html exports PNG only", () => {
  assert.deepEqual(exportAvailability("/a.html"), { pdf: false, docx: false, png: true });
});
test("plain text exports everything", () => {
  assert.deepEqual(exportAvailability("/a.txt"), { pdf: true, docx: true, png: true });
});
