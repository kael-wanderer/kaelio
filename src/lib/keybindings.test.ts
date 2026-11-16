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

import { cm6KeyToAccelerator, nativeMenuAccelerators } from "./keybindings.ts";

test("cm6 keys become Tauri accelerators", () => {
  assert.equal(cm6KeyToAccelerator("Mod-p"), "CmdOrCtrl+P");
  assert.equal(cm6KeyToAccelerator("Mod-Shift-f"), "CmdOrCtrl+Shift+F");
  assert.equal(cm6KeyToAccelerator("Mod-Alt-p"), "CmdOrCtrl+Alt+P");
  assert.equal(cm6KeyToAccelerator("Mod--"), "CmdOrCtrl+-");
  assert.equal(cm6KeyToAccelerator("Mod-="), "CmdOrCtrl+=");
  assert.equal(cm6KeyToAccelerator("Ctrl-Shift-N"), "Ctrl+Shift+N");
});
test("unbound or unparsable key gives null", () => {
  assert.equal(cm6KeyToAccelerator(""), null);
  assert.equal(cm6KeyToAccelerator("Mod-"), null);
  assert.equal(cm6KeyToAccelerator("Mod-Shift"), null);
});
test("native menu accelerators follow effective bindings, unbound clears", () => {
  const eff: Record<string, string> = {
    "search.file-search": "",           // unbound by migration
    "file.save": "Mod-p",               // user's custom
    "view.toggle-preview": "Mod-Alt-p",
    "view.toggle-sidebar": "Mod-b",
  };
  const out = nativeMenuAccelerators(id => eff[id] ?? "");
  assert.equal(out["search.file-search"], null);
  assert.equal(out["file.save"], "CmdOrCtrl+P");
  assert.equal(out["view.preview"], "CmdOrCtrl+Alt+P");
  assert.equal(out["view.explorer"], "CmdOrCtrl+B");
});
