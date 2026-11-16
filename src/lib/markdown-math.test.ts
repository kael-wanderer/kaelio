import { test } from "node:test";
import assert from "node:assert/strict";
import MarkdownIt from "markdown-it";
import { mathPlugin } from "./markdown-math.ts";

// Same options as the preview. The fake renderer shows what the parser handed
// to KaTeX, so these tests check parsing only.
function mdi() {
  return new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true })
    .use(mathPlugin, { render: (tex: string, display: boolean) => `[${display ? "D" : "I"}:${tex}]` });
}
const r = (s: string) => mdi().render(s);

test("multi-line block math keeps its source: no <br>, \\, kept", () => {
  const out = r("$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n");
  assert.equal(out, `<div class="math-block">[D:\\int_0^1 x^2\\,dx = \\frac{1}{3}]</div>\n`);
});

test("block math over several lines keeps the newlines", () => {
  assert.equal(r("$$\na\nb\n$$"), `<div class="math-block">[D:a\nb]</div>\n`);
});

test("single-line block math", () => {
  assert.equal(r("$$x^2$$"), `<div class="math-block">[D:x^2]</div>\n`);
});

test("opening and closing on content lines", () => {
  assert.equal(r("$$ a\nb $$"), `<div class="math-block">[D:a\nb]</div>\n`);
});

test("block math interrupts a paragraph", () => {
  assert.equal(r("text\n$$\nx\n$$"), `<p>text</p>\n<div class="math-block">[D:x]</div>\n`);
});

test("block math carries a source map for scroll sync", () => {
  const tokens = mdi().parse("para\n\n$$\nx\n$$\n", {});
  const t = tokens.find(t => t.type === "math_block")!;
  assert.deepEqual(t.map, [2, 5]);
});

test("unclosed $$ stays text", () => {
  assert.equal(r("$$\nx"), "<p>$$<br>\nx</p>\n");
});

test("inline math", () => {
  assert.equal(r("Inline $E = mc^2$ here"), "<p>Inline [I:E = mc^2] here</p>\n");
});

test("inline $$…$$ inside a paragraph is display math", () => {
  assert.equal(r("a $$x$$ b"), "<p>a [D:x] b</p>\n");
});

test("prices are not math", () => {
  assert.equal(r("costs $5 and $10 today"), "<p>costs $5 and $10 today</p>\n");
  assert.equal(r("$20,000 and $30,000"), "<p>$20,000 and $30,000</p>\n");
});

test("a price before real math does not swallow it", () => {
  assert.equal(r("costs $10 and then $x$ is"), "<p>costs $10 and then [I:x] is</p>\n");
  assert.equal(r("prices $5 and $10, then $y$"), "<p>prices $5 and $10, then [I:y]</p>\n");
});

test("space after the opening or before the closing $ is not math", () => {
  assert.equal(r("$ x$"), "<p>$ x$</p>\n");
  assert.equal(r("$x $"), "<p>$x $</p>\n");
});

test("escaped dollar is text", () => {
  assert.equal(r("\\$x$"), "<p>$x$</p>\n");
});

test("dollars in code are not math", () => {
  assert.equal(r("`$x$`"), "<p><code>$x$</code></p>\n");
  assert.equal(r("```\n$$\nx\n$$\n```"), "<pre><code>$$\nx\n$$\n</code></pre>\n");
});

test("escaped dollar inside math stays in the source", () => {
  assert.equal(r("$a\\$b$"), "<p>[I:a\\$b]</p>\n");
});

test("empty $$ $$ is not math", () => {
  assert.equal(r("$$$$"), "<p>$$$$</p>\n");
});
