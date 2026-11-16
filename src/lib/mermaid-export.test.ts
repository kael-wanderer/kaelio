import { test } from "node:test";
import assert from "node:assert/strict";
import { findMermaidBlocks, applyDiagramPlaceholders, diagramName } from "./mermaid-export.ts";

const doc = ["# T", "```mermaid", "graph TD", "A-->B", "```", "text", "```js", "x", "```"].join("\n");

test("finds a mermaid block with its lines and source", () => {
  assert.deepEqual(findMermaidBlocks(doc), [{ startLine: 1, endLine: 4, source: "graph TD\nA-->B" }]);
});
test("a mermaid fence shown inside another fence is not a block", () => {
  assert.deepEqual(findMermaidBlocks("````md\n```mermaid\ngraph TD\n```\n````"), []);
});
test("unterminated mermaid fence is not a block", () => {
  assert.deepEqual(findMermaidBlocks("```mermaid\ngraph TD"), []);
});
test("rendered block becomes one image line", () => {
  const blocks = findMermaidBlocks(doc);
  const out = applyDiagramPlaceholders(doc, blocks, [true], "0123456789abcdef");
  assert.equal(out.split("\n")[1], "![diagram](kaelio-diagram-0123456789abcdef-0.png)");
  assert.ok(!out.includes("graph TD"));
  assert.ok(out.includes("```js"));
});
test("failed block stays as a plain code block", () => {
  const out = applyDiagramPlaceholders(doc, findMermaidBlocks(doc), [false], "0123456789abcdef");
  assert.deepEqual(out.split("\n").slice(1, 5), ["```", "graph TD", "A-->B", "```"]);
});
test("two blocks keep their own indexes when the first fails", () => {
  const two = doc + "\n```mermaid\ngraph LR\n```";
  const out = applyDiagramPlaceholders(two, findMermaidBlocks(two), [false, true], "0123456789abcdef");
  assert.ok(out.includes("kaelio-diagram-0123456789abcdef-1.png"));
  assert.ok(!out.includes("-0.png"));
});
test("diagram name format", () => {
  assert.equal(diagramName("0123456789abcdef", 7), "kaelio-diagram-0123456789abcdef-7.png");
});
