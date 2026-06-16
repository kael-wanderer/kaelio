# Page Guide + activity-bar fixes (Codex prompt)

Date: 2026-06-16
Status: Ready for implementation. **Task prompt for Codex.** Branch `main`.

Kaelio = Tauri 2 + Rust + vanilla TS Markdown editor. Frontend monolith: `src/main.ts`, `src/styles.css`, `index.html`; native menu in `src-tauri/src/lib.rs`. No test framework — verify with `npm run build` and, if Rust changes, `cd src-tauri && cargo check`, plus a manual `npm run tauri dev` pass. Match existing style; small commits; don't refactor unrelated code.

---

## Part A — "Page Guide" soft-wrap (rename + configurable column)

**Context:** Soft Wrap has three modes via `setWrapMode("off"|"window"|"column")`. The `"column"` mode wraps at a fixed column (`const wrapColumn = 80` in `src/main.ts`) and draws a vertical guide line (`applyWrapColumnStyle` sets the `--wrap-col` CSS var and toggles `.wrap-column` on `#editor-wrapper`; CSS uses `var(--wrap-col, 80ch)`). It's labeled **"Column (80)"** in the in-app View dropdown (`#wrap-mode-select` `<option value="column">`) and in the native menu (`view.soft-wrap.column` in `lib.rs`).

This *is* the BBEdit "Page Guide" concept (wrap at the guide-line column). Rename it and make the column configurable.

**Do:**
1. **Rename** the user-facing label from "Column (80)" to **"Page Guide"** in both places — the in-app `#wrap-mode-select` option and the native menu item (`lib.rs` "view.soft-wrap.column" title). **Keep the internal value/id `"column"`** and `setWrapMode("column")` unchanged.
2. **Make the column configurable:**
   - Replace `const wrapColumn = 80` with `let wrapColumn = parseInt(localStorage.getItem("kaelio-wrap-column") || "80", 10) || 80;`.
   - Add a small numeric input in the View dropdown beside the Soft Wrap select — e.g. a "Page guide column" number input (`#wrap-column-input`, min 20, max 200, default 80), shown only when the wrap mode is `"column"` (hide it for off/window). On change: clamp, set `wrapColumn`, persist to `localStorage["kaelio-wrap-column"]`, then re-run `applyWrapColumnStyle()` and reconfigure the wrap compartments so the guide line + `max-width` update live (main editor, and `editorSub` if present).
   - Ensure `applyWrapColumnStyle()` writes `--wrap-col: ${wrapColumn}ch` (it likely hardcodes 80 today — make it use the variable).
3. Optional (nice): a native menu item "Set Page Guide Column…" under View → Soft Wrap that opens an input dialog (reuse `showInputDialog`) to set the column. Only if low-risk; the in-app input is the must-have.

**Accept:** The wrap option reads "Page Guide" in both the in-app dropdown and the macOS menu; choosing it shows a column input; changing the column moves the guide line and wrap width live and persists across restart; internal `"column"` value still works. `npm run build` (+ `cargo check` if Rust touched) passes.

---

## Part B — Fix the relocated activity-bar controls

**Context:** Zoom (`#btn-zoom-out`, `#status-zoom`, `#btn-zoom-in`), split (`#btn-split`), and sync (`#btn-sync-scroll`) were moved into the left `#activity-bar`. Two problems:

1. **The "100%" zoom label (`#status-zoom`, `class="toolbar-zoom"`) is still in the bar.** Zoom should be just the `−` and `+` buttons.
   - **Remove the `#status-zoom` element** from the activity bar in `index.html`. In `src/main.ts`, in `applyZoom()` (and anywhere that sets `#status-zoom` text), guard the lookup so it no-ops when the element is absent (don't crash; keep `zoomLevel` logic intact). Don't reintroduce a percentage label in the bar.
2. **The sync icon (`⇆`, `#btn-sync-scroll`) is the wrong size / sits oddly ("out of the side bar").** Make every relocated button render identically to the existing activity icons (e.g. `#activity-explorer`, the Show/Hide Explorer button).
   - Ensure `#btn-split`, `#btn-sync-scroll`, `#btn-zoom-out`, `#btn-zoom-in` use the **same `.activity-btn` sizing** (36×36, the shared `font-size`, `display:grid; place-items:center`) with **no leftover toolbar-specific styling** (e.g. remove any `.toolbar-zoom`/toolbar rules still applying to them). The `⇆` glyph in particular must match the others in box size and visual weight — same as the hide/show-sidebar icon.
   - The activity bar must hold all icons cleanly stacked, none overflowing or escaping the 44px-wide bar.

**Accept:** Activity bar shows the icons (explorer, preview, reading, line-numbers, split, sync, zoom-out, zoom-in, … settings pinned bottom) all at the same size as the Show/Hide Explorer icon; the sync icon no longer looks oversized or out of the bar; there is **no "100%" label**; zoom −/+ still work and `zoomLevel` still functions.

---

## Done criteria
- `npm run build` passes; `cargo check` passes if `lib.rs` changed; manual `npm run tauri dev` confirms both Accept sections.
- Update `CHANGELOG.md` under `## 0.9.2`: renamed Column→Page Guide with configurable column; activity-bar zoom/sync cleanup.
- Small, descriptive commits on `main`.
