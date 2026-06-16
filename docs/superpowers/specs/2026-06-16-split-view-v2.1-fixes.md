# Split View v2.1 — Fixes (Codex prompt)

Date: 2026-06-16
Status: Ready for implementation. **This is a task prompt for Codex.**

You are fixing 4 issues in Kaelio (Tauri 2 + Rust + vanilla TypeScript Markdown editor). All on branch `main`. Frontend is monolithic: `src/main.ts` (~6000 lines), `src/styles.css`, `index.html`. Backend (native menu) in `src-tauri/src/lib.rs`. No test framework — verify with `npm run build` (frontend) AND `cd src-tauri && cargo check` (if you touch Rust), plus a manual `npm run tauri dev` pass. Match existing code style. Do not refactor unrelated code. Keep commits small and descriptive.

Background already in place: split view has two explicit editors (`editor` main, `editorSub` sub), `#main-region` wraps the main panes, `#sub-divider` separates `#main-region` from `#sub-pane-wrapper`, and a unified `#tab-bar` contains two strips `#main-tabs` and `#sub-tabs`. Soft Wrap exists in the in-app View dropdown (`#wrap-mode-select`) and via `setWrapMode("off"|"window"|"column")`.

---

## Issue 1 — Separate the right-click sections

**Current** (`index.html` ~274-278): "Open in Split Window", "Select for Compare", "Compare with Selected" sit together under one divider `#ctx-split-divider`.

**Want:** two distinct sections —
1. *Open in Split Window* (its own section)
2. *Select for Compare* + *Compare with Selected* (one section together)

**Do:**
- In `index.html`, add a second divider between `#ctx-open-split` and `#ctx-select-compare`. Give it an id, e.g. `#ctx-compare-divider`:
  ```html
  <div class="ctx-divider" id="ctx-split-divider"></div>
  <div id="ctx-open-split" class="ctx-item">Open in Split Window</div>
  <div class="ctx-divider" id="ctx-compare-divider"></div>
  <div id="ctx-select-compare" class="ctx-item">Select for Compare</div>
  <div id="ctx-compare-with" class="ctx-item">Compare with Selected</div>
  ```
- In `src/main.ts` `showContextMenu` (~3289-3292), toggle the new divider's visibility too. The compare divider should be visible only when the compare section is shown (i.e. on files):
  ```ts
  document.getElementById("ctx-compare-divider")?.classList.toggle("hidden", !isFile);
  ```
  (Keep the existing toggles for `#ctx-split-divider`, `#ctx-open-split`, `#ctx-select-compare`, and `#ctx-compare-with`.)

**Accept:** Right-click a file → "Open in Split Window" is visually in its own section; "Select for Compare" and "Compare with Selected" share the next section; dividers don't appear for folders.

---

## Issue 2 — Add "Soft Wrap" to the native macOS menu bar

**Current:** Soft Wrap is only in the in-app View dropdown. The **native** macOS menu bar (top of screen) View menu (`src-tauri/src/lib.rs` `view_menu`, ~1971) has no Soft Wrap entry, so users browsing the OS menu can't find it.

**Do:**
- In `lib.rs`, add a **Soft Wrap submenu** to `view_menu` (place it near `view.line-numbers`, before the zoom separator). Mirror the existing submenu pattern (e.g. `theme_menu`):
  ```rust
  let soft_wrap_menu = Submenu::with_items(handle, "Soft Wrap", true, &[
      &MenuItem::with_id(handle, "view.soft-wrap.off", "Off", true, None::<&str>)?,
      &MenuItem::with_id(handle, "view.soft-wrap.window", "Window Width", true, None::<&str>)?,
      &MenuItem::with_id(handle, "view.soft-wrap.column", "Column (80)", true, None::<&str>)?,
  ])?;
  ```
  and add `&soft_wrap_menu,` to the `view_menu` items list.
- In `src/main.ts` `handleNativeMenuCommand` (~5316), add cases:
  ```ts
  case "view.soft-wrap.off": return setWrapMode("off");
  case "view.soft-wrap.window": return setWrapMode("window");
  case "view.soft-wrap.column": return setWrapMode("column");
  ```

**Accept:** macOS menu bar → View → Soft Wrap → Off / Window Width / Column (80) changes the editor wrap mode and stays in sync with the in-app `#wrap-mode-select`. `cargo check` passes.

---

## Issue 3 — Tab-bar boundary must track the split divider + overflow dropdown

**Current bug:** `#main-tabs` and `#sub-tabs` are each `flex: 1 1 0` when split (CSS ~419-422), so the tab boundary is always at 50%, regardless of where the `#sub-divider` actually sits. When main tabs are closed, sub tabs appear to drift into the main area. There's also no overflow handling — many tabs overflow-scroll.

**Want:**
1. The **boundary between `#main-tabs` and `#sub-tabs` aligns exactly with `#sub-divider`** (the line separating `#main-region` and `#sub-pane-wrapper`), and **stays in sync when the divider is dragged or the window resized**.
2. **Overflow dropdown:** when a strip has more tabs than fit, show the tabs that fit plus a trailing **down-arrow button**; clicking it opens a menu listing *all* open tabs for that pane, selecting one activates it. Applies to both main and sub strips independently.

**Approach (suggested):**
- Width sync: make the tab strips mirror their panes. Simplest reliable method — in JS, after layout changes (split toggle, `#sub-divider` drag in `initSubDividerDrag`, and a `window` resize listener), set `#main-tabs` width to `#main-region.offsetWidth` and `#sub-tabs` width to `#sub-pane-wrapper.offsetWidth` (account for the 4px `#sub-divider` so the tab seam lines up with the pane divider). Add a matching 1px/4px separator in the tab bar at the seam. Prefer width/flex-basis in px synced from the panes over fixed 50/50.
- Overflow menu: after rendering a strip, measure whether tabs overflow its width; if so, render a `▾` button at the end. Clicking it builds a dropdown (reuse the existing dropdown/context-menu styling) listing every tab in that pane (`tabs` for main, `subTabs` for sub) with the active one marked; selecting calls `switchToTab(id)` / `switchSubTab(id)`. Keep it simple; ~4–5 visible tabs before overflow is fine.
- Relevant code: `renderTabs` (renders into `#main-tabs`), `renderSubTabs` (`#sub-tabs`), `updateTabBarVisibility`, `initSubDividerDrag` (sets `#sub-pane-wrapper` flex-basis), CSS `#tab-bar`/`.tab-strip`/`.split-tabs` (~385-422).

**Accept:** With split on, the tab seam sits exactly under the pane divider and follows it when dragged/resized; closing main tabs never pushes sub tabs leftward past the divider; when tabs overflow, a `▾` lists all of that pane's tabs and selecting one switches to it.

---

## Issue 4 — Bigger split-toggle icon

**Current:** `#btn-split` glyph is `font-size: 18px` (`src/styles.css` ~2830) but reads small in its toolbar button. The left activity-bar icons are `font-size: 17px` in 36px buttons (`.activity-btn`, ~668).

**Do:** Increase the `#btn-split` glyph (and `#btn-sub-mode` for consistency) `font-size` to ~`22px` so it visually matches the activity-bar icon weight. **Keep the button footprint/padding unchanged** — only the glyph grows.

**Accept:** The `⊟` split icon next to zoom looks as prominent as the sidebar icons; toolbar layout/button size unchanged.

---

## Done criteria
- `npm run build` passes; `cd src-tauri && cargo check` passes (Issue 2).
- Manual `npm run tauri dev`: all four accept-criteria hold.
- Update `CHANGELOG.md` under `## 0.9.2` (Fixes) with a one-line summary of these polish fixes.
- Small, descriptive commits on `main`.
