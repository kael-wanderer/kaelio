import { test } from "node:test";
import assert from "node:assert/strict";
import { isSingleUrl, hasStructure, htmlToMarkdown, decidePaste, MAX_PASTE_HTML } from "./smart-paste.ts";

const base = { html: null, text: "", selection: "", inCode: false, forcePlain: false };

test("isSingleUrl", () => {
  assert.ok(isSingleUrl("https://example.com/a?b=1"));
  assert.ok(isSingleUrl("  http://example.com \n"));
  for (const no of ["example.com", "see https://example.com", "https://a.com https://b.com", "javascript:alert(1)", ""]) assert.ok(!isSingleUrl(no));
});
test("hasStructure", () => {
  assert.ok(hasStructure("<p>a <a href='x'>b</a></p>"));
  assert.ok(hasStructure("<UL><li>a</li></UL>"));
  assert.ok(!hasStructure("<div><span>x</span></div>"));
  assert.ok(!hasStructure("<a name='x'>anchor</a>"));
  assert.ok(!hasStructure("<p>para</p><br>"));
});
test("url over a selection becomes a link", () => {
  assert.deepEqual(decidePaste({ ...base, text: "https://example.com/doc", selection: "the doc" }),
    { kind: "link", text: "[the doc](https://example.com/doc)" });
});
test("url over a selected url is plain", () => {
  assert.deepEqual(decidePaste({ ...base, text: "https://b.com", selection: "https://a.com" }), { kind: "plain" });
});
test("url with no selection is plain", () => {
  assert.deepEqual(decidePaste({ ...base, text: "https://example.com" }), { kind: "plain" });
});
test("structured html becomes markdown", () => {
  const d = decidePaste({ ...base, text: "Plan", html: "<h2>Plan</h2><ol><li><strong>Measure</strong> it</li><li>Ship</li></ol>" });
  assert.equal(d.kind, "markdown");
  assert.equal((d as any).text, "## Plan\n\n1.  **Measure** it\n2.  Ship");
});
test("code-editor html (div/span only) is plain", () => {
  const html = '<meta charset="utf-8"><div style="color:#ccc"><div><span style="color:#89b4fa">const</span><span> a = 1;</span></div></div>';
  assert.deepEqual(decidePaste({ ...base, text: "const a = 1;", html }), { kind: "plain" });
});
test("inside code is always plain", () => {
  assert.deepEqual(decidePaste({ ...base, text: "x", html: "<h1>x</h1>", inCode: true }), { kind: "plain" });
  assert.deepEqual(decidePaste({ ...base, text: "https://a.com", selection: "s", inCode: true }), { kind: "plain" });
});
test("forcePlain wins", () => {
  assert.deepEqual(decidePaste({ ...base, text: "x", html: "<h1>x</h1>", forcePlain: true }), { kind: "plain" });
});
test("oversize html is plain", () => {
  const html = "<h1>x</h1>" + "a".repeat(MAX_PASTE_HTML);
  assert.deepEqual(decidePaste({ ...base, text: "x", html }), { kind: "plain" });
});
test("structured html that converts to nothing is plain", () => {
  assert.deepEqual(decidePaste({ ...base, text: "", html: "<b></b><script>x</script>" }), { kind: "plain" });
});
test("table converts to a pipe table", () => {
  const md = htmlToMarkdown("<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>");
  assert.match(md, /\| A \| B \|/);
  assert.match(md, /\| 1 \| 2 \|/);
});
test("scripts, styles and data-url images are dropped", () => {
  const md = htmlToMarkdown('<p>hi</p><script>alert(1)</script><style>p{}</style><img src="data:image/png;base64,AAAA"><img src="https://e.com/a.png" alt="a">');
  assert.ok(!md.includes("alert"));
  assert.ok(!md.includes("data:"));
  assert.ok(md.includes("![a](https://e.com/a.png)"));
});
