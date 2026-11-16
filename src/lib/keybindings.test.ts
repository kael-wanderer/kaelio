import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateKeybindings } from "./keybindings.ts";

const defaults = [
  { id: "search.file-search", defaultKey: "Mod-p" },
  { id: "search.content-search", defaultKey: "Mod-Shift-f" },
  { id: "view.toggle-preview", defaultKey: "Mod-Alt-p" },
];

test("no custom bindings: nothing changes", () => {
  assert.deepEqual(migrateKeybindings({}, defaults), {});
});

test("custom binding that collides with a new default unbinds that default", () => {
  // user had put Save-as-something on Mod-p before the defaults moved
  const out = migrateKeybindings({ "file.save": "Mod-p" }, [...defaults, { id: "file.save", defaultKey: "Mod-s" }]);
  assert.equal(out["file.save"], "Mod-p");
  assert.equal(out["search.file-search"], "");
});

test("collision check ignores case", () => {
  const out = migrateKeybindings({ "file.save": "mod-shift-F" }, [...defaults, { id: "file.save", defaultKey: "Mod-s" }]);
  assert.equal(out["search.content-search"], "");
});

test("an action the user customised itself is left alone", () => {
  const out = migrateKeybindings({ "search.file-search": "Mod-p" }, defaults);
  assert.deepEqual(out, { "search.file-search": "Mod-p" });
});

test("does not mutate its input", () => {
  const custom = { "file.save": "Mod-p" };
  migrateKeybindings(custom, [...defaults, { id: "file.save", defaultKey: "Mod-s" }]);
  assert.deepEqual(custom, { "file.save": "Mod-p" });
});
