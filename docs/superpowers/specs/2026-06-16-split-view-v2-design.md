# Split View v2 (Polish) — Design

Date: 2026-06-16
Status: Approved direction, pending implementation plan. **Handoff doc for the next agent (Codex).**

## Context

Split View Phases 1–3 shipped (toggle, editable sub pane `editorSub` with its own tabs + mode toggle, per-pane `Cmd+S` via `activePane`, right-click "Open in Split Window" + "Select for Compare → Compare with Selected"). A layout restructure then fixed four bugs by wrapping the main panes in **`#main-region`** so `#editor-container` is now `[#main-region] [#sub-divider] [#sub-pane-wrapper]` — two real flex halves. v2 builds on that boundary.

All frontend is in `src/main.ts` (~5600 lines), styles in `src/styles.css`, markup in `index.html`. Two explicit editors (`editor` = main, `editorSub` = sub), capped at 2 panes — no generic pane system. No test framework; verify with `npm run build` + manual.

## Goals (from user testing feedback, 2026-06-16)

1. **Right control bar for the sub pane** — a thin vertical bar mirroring the left `#activity-bar`, shown only when split is on, hosting the sub pane's own controls: edit/preview mode toggle, line-numbers toggle, zoom in/out. (Replaces the cramped `#btn-sub-mode` in the tab bar.)
2. **Bigger icons** — increase the glyph size inside the split toggle (`#btn-split`) and the sub mode button, without enlarging the button footprint (font-size, not padding).
3. **Unified tab bar** — when split is on, the single top `#tab-bar` visually splits into two aligned halves (main tabs over the main region, sub tabs over the sub pane), same styling/size as the main tabs — instead of the current small separate `#sub-tabs` bar.
4. **Per-pane zoom** — separate zoom level for main and sub (`Cmd+=`/`Cmd+-` and the toolbar buttons act on the focused pane; the sub control bar has its own zoom buttons).
5. **Per-pane line numbers** — sub pane gets its own line-numbers toggle (independent of main's).

## Design

### Right control bar
- New element `#sub-activity-bar` inside `#sub-pane-wrapper` (or as a sibling between `#sub-divider` and `#sub-pane-wrapper`), `class="hidden"` toggled by `setSplit()`. Mirror `#activity-bar` styling (44px, vertical flex).
- Buttons: mode toggle (✎/👁, big), line numbers (#), zoom out (−), zoom in (+). Move the existing `#btn-sub-mode` logic here; remove it from `#sub-tab-bar`.

### Per-pane state
- `subZoomLevel: number` (mirror the existing `zoomLevel`); apply via the same CSS-variable/transform mechanism the main zoom uses, scoped to `#sub-pane-wrapper`.
- `subShowLineNumbers: boolean`; the sub editor uses a `Compartment` so it can reconfigure independently (note: Phase 2 built `editorSub` with *static* extensions — v2 must convert sub line-numbers/wrap to a compartment to toggle live).
- Zoom routing: extend `zoomIn`/`zoomOut`/`zoomReset` to check `activePane` and act on the focused pane (main → existing path; sub → `subZoomLevel`).

### Unified tab bar
- When split on: render main tabs into a left region and sub tabs into a right region of one bar (or two adjacent bars styled identically, widths tracking `#main-region` / `#sub-pane-wrapper`). Reuse the `renderTabs` / `renderSubTabs` styling so both look the same. The current `#sub-tabs` small bar is replaced.
- Keep it simple: two equal-styled tab strips, the sub one aligned above the sub pane. Do not over-engineer a single DOM bar if two aligned strips are simpler.

### Icon sizing
- `#btn-split`, sub mode button: bump `font-size` (e.g. 16–18px) without changing padding/box.

## Out of scope / constraints
- Still max 2 panes; no nesting.
- Don't persist split across restart (unchanged).
- Keep the `#main-region` boundary intact — all main view-mode/divider logic stays scoped to it.

## Known-good foundation to build on
- `#main-region` wraps editor+divider+preview (see `index.html`, `src/styles.css` `#main-region`).
- `#sub-pane` shares `#preview-pane` styling via `:is(#preview-pane, #sub-pane)` selectors in `styles.css`.
- Sub editor: `editorSub`, `subTabs`, `subActiveTabId`, `subMode`, `activePane`, `saveActivePane`, `setSubMode`, `openInSubPane`, `renderSubTabs` in `src/main.ts`.

## Testing (manual, per goal)
- Right bar appears only when split on; its mode/line-number/zoom buttons affect only the sub pane.
- Main zoom and sub zoom are independent.
- Tab bars look identical for main and sub and align with their panes.
- Icons visibly larger; layout unchanged.
- Re-verify the four bugs fixed by the restructure stay fixed (sub preview styling, main→preview no overlap, mode toggle doesn't collapse main, click doesn't resize).
