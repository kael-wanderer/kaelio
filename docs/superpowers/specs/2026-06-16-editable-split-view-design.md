# Editable Split View — Design

Date: 2026-06-16
Status: Approved, pending implementation plan

## What problem does this solve?

The user wants to work with two documents at once inside a single window — read
or reference one while editing another, or actively edit two files — without
juggling separate OS windows. "New Window" (⇧⌘N) exists but is clunky for
side-by-side work. This adds an in-window split with a second, fully editable
pane, plus a right-click "Compare" workflow to populate it.

## What does success look like?

- A toggle splits the window into exactly two panes side by side.
- The left (main) pane keeps all existing behavior (edit / preview / both).
- The right (sub) pane is a full editor with its own tabs and an edit/preview
  toggle.
- Right-clicking a file can open it in the sub pane, including a two-step
  "Select for Compare → Compare with Selected" flow.

## Scope & constraints

- **Exactly 2 panes, never more.** No nesting, no N-pane grid.
- Because it is capped at 2, the implementation uses **two explicit editor
  instances** (`editorMain`, `editorSub`) with their own state — NOT a generic
  pane abstraction. (YAGNI: do not build for hypothetical extra panes.)
- Monolithic codebase: all frontend in `src/main.ts`, styles in
  `src/styles.css`, markup in `index.html`. No test framework — verification is
  `npm run build` plus manual smoke testing.

## Layout & modes

When split is **ON**, the window is two columns separated by a draggable divider:

```
[ MAIN (left) ]  |  [ SUB (right) ]
```

- **Main (left):** unchanged. Retains its two modes — the existing editor+preview
  split, editor-only, or preview-only — toggled by the existing sidebar view
  switch. (When the main pane is itself in editor+preview split, the screen can
  show three columns; the draggable dividers manage widths.)
- **Sub (right):** shows **one mode at a time** — edit OR preview — with:
  - its **own tab bar** at the top for switching between open sub files, and
  - a **mode-toggle icon** that flips edit ↔ preview; the icon reflects the
    current mode.

When split is **OFF**, the app is exactly as it is today (main pane only).

## Controls / icons

- **Split toggle icon:** placed **next to the zoom icon**. Turns the split
  on/off.
- **Sub mode-switch icon:** placed **in the sub pane's tab bar**. Toggles the
  sub pane between edit and preview; icon updates to show current state.

## Editing, focus & saving

- The **active (focused) pane** is the save target: Cmd+S saves whichever pane
  has focus. The status bar reflects the active pane's file (path, word count,
  cursor).
- Each pane tracks its **own dirty state** independently.
- The sub pane is a real CodeMirror editor (`editorSub`) reusing the same
  extensions/theme as the main editor.

## Right-click (explorer) menu additions

Two new sections in the file context menu:

1. **Open in Split Window** — opens the file in the sub pane:
   - if split is OFF, turn it on and load the file in the sub pane;
   - if the sub pane already has a file, open the file as a new sub tab (and
     switch to it).
2. **Compare area** — 1 or 2 lines depending on state:
   - With no file selected for compare: shows **"Select for Compare"** (marks
     the file).
   - After a file is selected: shows **"Select for Compare"** (re-select) and
     **"Compare with Selected"** → opens the second file into the sub pane (same
     placement rules as "Open in Split Window").

## Turning split off

Closing the split removes the sub pane and its tabs. If any sub tab has unsaved
changes, prompt with the existing unsaved-changes guard before closing.

## YAGNI decisions (out of scope for v1)

- No scroll-sync between panes (different files).
- Split/sub state does **not** persist across app restart.
- No diff highlighting in Compare (it is side-by-side, not a diff). A real diff
  view could be a later spec, reusing the existing version-history diff code.
- No more than 2 panes; no nested splits.
- Sub pane reuses the existing preview renderer for its preview mode.

## Architecture notes

- Introduce `editorSub` alongside the existing `editor` (rename to `editorMain`
  only if it clarifies; otherwise keep `editor` as the main and add `editorSub`).
- Per-pane state: each pane has its own current file path, dirty flag, tab list,
  and mode (sub only). A single `activePane` ("main" | "sub") tracks focus for
  save/status routing.
- Reuse existing infrastructure: the draggable divider pattern (`#divider`), the
  preview rendering pipeline, the file context menu (`#context-menu`,
  `contextMenuTarget`), and the tab rendering code.

## Phased build (each phase leaves the app working)

1. **Phase 1 — Sub pane scaffold (read-only):** add the right column + divider +
   split on/off icon (next to zoom); render a chosen file as a read-only preview
   in the sub pane. No second editor yet. De-risks the layout and toggle.
2. **Phase 2 — Editable sub pane:** add `editorSub`, the sub tab bar, the
   mode-toggle icon, and per-pane save/dirty/focus routing.
3. **Phase 3 — Right-click entries:** "Open in Split Window" and the two-step
   "Select for Compare → Compare with Selected" flow.

## Testing (manual, per phase)

- **Phase 1:** toggle split on/off (icon by zoom); a file renders read-only on
  the right; divider resizes both columns; main pane behavior unchanged.
- **Phase 2:** type in the sub editor; switch sub tabs; flip sub edit/preview via
  its icon; Cmd+S saves the focused pane's file; dirty indicators are per-pane.
- **Phase 3:** right-click → "Open in Split Window" opens in the sub pane (on and
  off split); "Select for Compare" then "Compare with Selected" opens the right
  file; menu shows 1 line vs 2 lines per selection state.
