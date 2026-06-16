# Text Display — Design

Date: 2026-06-16
Status: Approved, pending implementation plan

## What problem does this solve?

In the raw editor pane, long lines run off the right edge and get clipped. The
user has to move the cursor into the pane and arrow to the end of the line to
read hidden content. This is worse with the sidebar open (three panes share the
width). The CodeMirror editor currently has no line wrapping configured.

## What does success look like?

- Long lines no longer clip; the user can read full lines without scrolling or
  moving the cursor.
- Display toggles (soft wrap, line numbers) live in one discoverable place in
  the View menu.
- The chosen wrap mode persists across restarts.

## Scope

This is **Spec A**. Split view (multiple documents side-by-side + unsplit) is a
separate, larger feature tracked as **Spec B** and is out of scope here.

## Feature: Text Display submenu

A new **"Text Display"** entry in the View menu group opens a submenu, matching
the existing `.toolbar-dropdown` / `.dropdown-menu` pattern in `src/main.ts`.

Contents:

1. **Soft Wrap** — three mutually exclusive choices:
   - **Off** — current behavior, horizontal scroll. Good for wide tables/code.
   - **Window Width** — wrap at the editor pane edge; responsive to resize.
   - **Column…** — wrap at a fixed column (default **80**), with a faint
     vertical guide line drawn at that column.
2. **Show Line Numbers** — checkbox surfacing the existing `showLineNumbers`
   toggle. Same action as the sidebar line-number icon; the two stay in sync.

## How it works

Editor-only. The preview pane already wraps HTML, so no preview changes.

- New `lineWrapCompartment` mirroring the existing `lineNumbersCompartment`:
  - **Off** → `[]`
  - **Window Width** → `EditorView.lineWrapping`
  - **Column** → `EditorView.lineWrapping` plus a CSS `max-width` on the editor
    content sized in `ch` units equal to `wrapColumn`.
- **Guide line**: a thin absolutely-positioned ruler (CSS) at `{wrapColumn}ch`,
  shown only in Column mode.

## State & persistence

Stored in localStorage alongside existing display settings:

- `wrapMode`: `"off" | "window" | "column"` (default `"window"`)
- `wrapColumn`: number (default `80`)
- `showLineNumbers`: existing setting, now also surfaced in this menu.

## Out of scope

- Split view and per-pane independent wrap settings. When split view is built,
  panes inherit the single global wrap setting.

## Testing (manual)

Open a file containing a very long line, sidebar open (three panes):

1. Cycle Off → Window Width → Column(80); confirm wrapping behaves per mode.
2. Confirm the guide line appears at column 80 only in Column mode.
3. Resize the sidebar/window in Window Width mode; wrapping reflows.
4. Restart the app; confirm the chosen mode and column persist.
5. Toggle line numbers from both the sidebar icon and the menu checkbox;
   confirm they stay in sync.
