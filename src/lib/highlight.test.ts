import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightCode } from "./highlight.ts";

test("known language is highlighted", () => {
  assert.match(highlightCode("const a = 1;", "js"), /hljs-keyword/);
});
test("language name is case-insensitive", () => {
  assert.match(highlightCode("const a = 1;", "JS"), /hljs-keyword/);
});
test("unknown language returns empty string", () => {
  assert.equal(highlightCode("whatever", "not-a-language"), "");
});
test("missing language returns empty string", () => {
  assert.equal(highlightCode("whatever", ""), "");
});
test("mermaid is never highlighted", () => {
  assert.equal(highlightCode("graph TD; A-->B", "mermaid"), "");
});
test("markup inside code is escaped", () => {
  const out = highlightCode("</code></pre><script>alert(1)</script>", "html");
  assert.ok(!out.includes("<script>"));
  assert.ok(!out.includes("</pre>"));
});
