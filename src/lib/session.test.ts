import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSplitSession } from "./session.ts";

test("valid split session is returned", () => {
  const raw = { open: true, mode: "edit", tabs: [{ filePath: "/a.md", isActive: true }] };
  assert.deepEqual(parseSplitSession(raw), raw);
});
test("missing or wrong-typed input gives null", () => {
  for (const bad of [undefined, null, 7, "x", [], { open: "yes" }, { open: true, mode: "edit", tabs: "no" }])
    assert.equal(parseSplitSession(bad), null);
});
test("unknown mode falls back to preview", () => {
  assert.equal(parseSplitSession({ open: true, mode: "weird", tabs: [] })?.mode, "preview");
});
test("tabs without a string filePath are dropped", () => {
  const out = parseSplitSession({ open: true, mode: "edit", tabs: [{ filePath: 5 }, { filePath: "/a.md" }] });
  assert.deepEqual(out?.tabs, [{ filePath: "/a.md", isActive: false }]);
});
test("at most one tab is active; the first active wins", () => {
  const out = parseSplitSession({ open: true, mode: "edit",
    tabs: [{ filePath: "/a.md", isActive: true }, { filePath: "/b.md", isActive: true }] });
  assert.deepEqual(out?.tabs.map(t => t.isActive), [true, false]);
});
test("non-object tab entries are dropped", () => {
  const out = parseSplitSession({ open: true, mode: "edit", tabs: [null, "x", { filePath: "" }, { filePath: "/a.md" }] });
  assert.deepEqual(out?.tabs, [{ filePath: "/a.md", isActive: false }]);
});
