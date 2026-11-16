import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFrontmatter, parseYamlFrontmatter, parseFlowList, removeFrontmatterTag } from "./frontmatter.ts";

test("extractFrontmatter splits the block from the body", () => {
  assert.deepEqual(extractFrontmatter("---\na: 1\n---\nbody"), { frontmatter: "a: 1", body: "body" });
  assert.deepEqual(extractFrontmatter("no front"), { frontmatter: null, body: "no front" });
});

test("flow list: plain, quoted, spaces, empty", () => {
  assert.deepEqual(parseFlowList("[test, smoke]"), ["test", "smoke"]);
  assert.deepEqual(parseFlowList(`["a, b", 'c', d ]`), ["a, b", "c", "d"]);
  assert.deepEqual(parseFlowList("[]"), []);
  assert.equal(parseFlowList("test, smoke"), null);
  assert.equal(parseFlowList("[unclosed"), null);
});

test("tags in flow form become items", () => {
  const e = parseYamlFrontmatter("title: Preview smoke\ntags: [test, smoke]");
  assert.deepEqual(e, [
    { key: "title", value: "Preview smoke" },
    { key: "tags", value: "test, smoke", items: ["test", "smoke"] },
  ]);
});

test("tags in block form become items", () => {
  const e = parseYamlFrontmatter("tags:\n  - one\n  - two\ndate: 2026");
  assert.deepEqual(e, [
    { key: "tags", value: "one, two", items: ["one", "two"] },
    { key: "date", value: "2026" },
  ]);
});

test("folded scalars and quoted values are unchanged", () => {
  const e = parseYamlFrontmatter("desc: >\n  a\n  b\nname: \"Kael\"");
  assert.deepEqual(e, [{ key: "desc", value: "a b" }, { key: "name", value: "Kael" }]);
});

test("remove a tag from a flow list keeps the others", () => {
  const doc = "---\ntags: [test, smoke, x]\n---\nbody\n";
  const ch = removeFrontmatterTag(doc, "smoke");
  assert.ok(ch);
  const out = doc.slice(0, ch.from) + ch.insert + doc.slice(ch.to);
  assert.equal(out, "---\ntags: [test, x]\n---\nbody\n");
});

test("remove the last tag from a flow list leaves []", () => {
  const doc = "---\ntags: [only]\n---\n";
  const ch = removeFrontmatterTag(doc, "only")!;
  assert.equal(doc.slice(0, ch.from) + ch.insert + doc.slice(ch.to), "---\ntags: []\n---\n");
});

test("remove a quoted tag that contains a comma", () => {
  const doc = `---\ntags: ["a, b", c]\n---\n`;
  const ch = removeFrontmatterTag(doc, "a, b")!;
  assert.equal(doc.slice(0, ch.from) + ch.insert + doc.slice(ch.to), "---\ntags: [c]\n---\n");
});

test("remove a tag from a block list", () => {
  const doc = "---\ntags:\n  - one\n  - two\n---\n- two\n";
  const ch = removeFrontmatterTag(doc, "two")!;
  assert.equal(doc.slice(0, ch.from) + ch.insert + doc.slice(ch.to), "---\ntags:\n  - one\n---\n- two\n");
});

test("never touches the body, even when a body list item matches", () => {
  const doc = "---\ntitle: x\n---\n  - two\n";
  assert.equal(removeFrontmatterTag(doc, "two"), null);
});

test("no frontmatter or unknown tag gives null", () => {
  assert.equal(removeFrontmatterTag("plain", "a"), null);
  assert.equal(removeFrontmatterTag("---\ntags: [a]\n---\n", "zzz"), null);
});

test("regex characters in a tag are literal", () => {
  const doc = "---\ntags:\n  - c++\n  - a.b\n---\n";
  const ch = removeFrontmatterTag(doc, "a.b")!;
  assert.equal(doc.slice(0, ch.from) + ch.insert + doc.slice(ch.to), "---\ntags:\n  - c++\n---\n");
  assert.equal(removeFrontmatterTag("---\ntags:\n  - axb\n---\n", "a.b"), null);
});
