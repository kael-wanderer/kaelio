/**
 * One-time migration for saved custom shortcuts when default bindings change.
 * A saved custom binding always wins: any default (for an action the user has
 * not customised) whose key is already taken by a custom binding is unbound,
 * so one key never triggers two actions.
 */
export function migrateKeybindings(
  custom: Record<string, string>,
  defaults: { id: string; defaultKey: string }[],
): Record<string, string> {
  const result: Record<string, string> = { ...custom };
  for (const def of defaults) {
    if (Object.prototype.hasOwnProperty.call(custom, def.id)) continue;
    const key = def.defaultKey.toLowerCase();
    const taken = Object.entries(custom).some(
      ([id, k]) => id !== def.id && typeof k === "string" && k !== "" && k.toLowerCase() === key,
    );
    if (taken) result[def.id] = "";
  }
  return result;
}

/** CodeMirror key ("Mod-Shift-f") to a Tauri menu accelerator ("CmdOrCtrl+Shift+F"); null if unbound. */
export function cm6KeyToAccelerator(key: string): string | null {
  if (!key) return null;
  // A trailing "-" after a separator is the minus key itself ("Mod--").
  const minus = key.endsWith("--");
  const parts = (minus ? key.slice(0, -2) : key).split("-");
  const base = minus ? "-" : parts.pop() ?? "";
  if (!base) return null;
  const mods: Record<string, string> = { mod: "CmdOrCtrl", cmd: "Cmd", meta: "Cmd", ctrl: "Ctrl", shift: "Shift", alt: "Alt" };
  if (mods[base.toLowerCase()]) return null;
  const out: string[] = [];
  for (const p of parts) {
    const m = mods[p.toLowerCase()];
    if (!m) return null;
    out.push(m);
  }
  out.push(base.length === 1 ? base.toUpperCase() : base);
  return out.join("+");
}

/** Native menu item id → shortcut registry id, for every native item that shows an accelerator. */
export const NATIVE_MENU_BINDINGS: Record<string, string> = {
  "file.new": "file.new",
  "file.open": "file.open",
  "file.new-window": "file.new-window",
  "file.save": "file.save",
  "file.close-tab": "file.close-tab",
  "edit.copy-formatted": "edit.copy-formatted",
  "view.explorer": "view.toggle-sidebar",
  "view.preview": "view.toggle-preview",
  "view.reading": "view.read-mode",
  "view.zoom-in": "view.zoom-in",
  "view.zoom-out": "view.zoom-out",
  "view.zoom-reset": "view.zoom-reset",
  "search.command-palette": "search.command-palette",
  "search.file-search": "search.file-search",
  "search.content-search": "search.content-search",
  "help.shortcuts": "help.shortcuts",
};

/** Accelerators for the native menu from the effective bindings (null clears the accelerator). */
export function nativeMenuAccelerators(getBinding: (id: string) => string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [menuId, bindingId] of Object.entries(NATIVE_MENU_BINDINGS)) {
    out[menuId] = cm6KeyToAccelerator(getBinding(bindingId));
  }
  return out;
}
