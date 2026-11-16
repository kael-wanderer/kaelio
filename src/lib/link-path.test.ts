import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLinkedPath } from "./link-path.ts";

test("plain relative link", () => {
  assert.equal(resolveLinkedPath("report.pdf", "/notes/a.md"), "/notes/report.pdf");
});
test("encoded space in the link becomes a real space", () => {
  assert.equal(resolveLinkedPath("Q3%20report.pdf", "/notes/a.md"), "/notes/Q3 report.pdf");
});
test("a folder with spaces or # in its name is kept as is", () => {
  assert.equal(resolveLinkedPath("x.pdf", "/My Notes/C# work/a.md"), "/My Notes/C# work/x.pdf");
});
test("parent folders resolve", () => {
  assert.equal(resolveLinkedPath("../img/p.png", "/notes/sub/a.md"), "/notes/img/p.png");
});
test("absolute path link", () => {
  assert.equal(resolveLinkedPath("/tmp/x.md", "/notes/a.md"), "/tmp/x.md");
});
test("encoded percent stays a percent", () => {
  assert.equal(resolveLinkedPath("100%25.md", "/notes/a.md"), "/notes/100%.md");
});
test("malformed encoding returns null", () => {
  assert.equal(resolveLinkedPath("bad%E0%A4%A.md", "/notes/a.md"), null);
});
