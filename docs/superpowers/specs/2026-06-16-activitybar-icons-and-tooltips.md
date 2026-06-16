# Move toolbar controls to the activity bar + hover tooltips (Codex prompt)

Date: 2026-06-16
Status: Ready for implementation. **Task prompt for Codex.** Branch `main`.

Kaelio = Tauri 2 + Rust + vanilla TS Markdown editor. Frontend monolith: `src/main.ts`, `src/styles.css`, `index.html`. No test framework — verify with `npm run build` + a manual `npm run tauri dev` pass. Match existing style; don't refactor unrelated code; small commits.

## Goal

1. **Move three controls from the top toolbar into the left activity bar** (`#activity-bar`), so the main pane's controls live in the vertical icon bar — consistent with the sub pane's `#sub-activity-bar` (which already holds mode/line-numbers/zoom). Controls to move: **Zoom (out/in + %)**, **Split view toggle**, **Sync scroll**.
2. **Add a styled hover tooltip** (appears on mouse-over, not click) describing every icon in both activity bars.

## Current state (locate by id; line numbers may drift)

Top toolbar (`index.html`, in `#toolbar-actions`):
- `#btn-sync-scroll` (⇆), `#btn-zoom-out` (−), `#status-zoom` (100%), `#btn-zoom-in` (+), `#btn-split` (⊟)

Left activity bar `#activity-bar`: `#activity-explorer` ☰, `#activity-preview` ◧, `#activity-reading` ◨, `#activity-linenumbers` #, `#activity-settings` ⚙ (`.activity-bottom`). Buttons use class `.activity-btn` (36×36, `font-size:17px`).

Right sub control bar `#sub-activity-bar`: `#btn-sub-mode`, `#btn-sub-linenumbers`, `#btn-sub-zoom-out`, `#btn-sub-zoom-in`.

All five buttons are wired in `main.ts` by id (`getElementById("btn-split")` etc.) — **keep the ids unchanged so wiring keeps working.**

## Part 1 — Relocate controls into `#activity-bar`

- Move `#btn-split`, `#btn-sync-scroll`, `#btn-zoom-out`, `#btn-zoom-in` out of `#toolbar-actions` and into `#activity-bar`. Give each `class="activity-btn"` so they match the existing icons. Suggested order in the bar: explorer, preview, reading, line-numbers, **split, sync, zoom-out, zoom-in**, … then `#activity-settings` stays pinned at the bottom (`.activity-bottom`).
- `#status-zoom` (the "100%" label): keep it but make it fit the vertical bar — render it as a small centered label between the zoom buttons (e.g. tiny `font-size`, no fixed toolbar width). Keep its id so `applyZoom()` still updates it.
- Remove the now-empty toolbar separators (`.toolbar-sep`) left behind, so the top toolbar doesn't have dangling dividers.
- Keep the icon glyphs (⊟, ⇆, −, +). Their click handlers are unchanged (same ids).
- Do **not** move the sub bar's zoom — `#sub-activity-bar` already has its own; this is about the main controls. The two bars are now visually consistent (left = main controls, right = sub controls when split on).

**Accept:** Split, sync, and zoom controls appear in the left activity bar, styled like the other activity icons; they still work (toggle split, toggle sync, zoom main pane); the `100%` label updates on zoom; the top toolbar no longer shows these buttons or leftover separators.

## Part 2 — Styled hover tooltips for activity-bar icons

Add a lightweight CSS tooltip that shows a short description when the cursor hovers an icon (no click), for every button in `#activity-bar` and `#sub-activity-bar`.

- Drive it from a `data-tooltip="…"` attribute on each button. Implement the visual tooltip in CSS via `:hover` (e.g. a `::after` bubble) — styled to match the app (Catppuccin surface/border, small radius, `var(--surface)`/`var(--border)`/`var(--text)`), with a short transition and a small delay.
- Positioning: left-bar tooltips appear to the **right** of the icon; right (`#sub-activity-bar`) tooltips appear to the **left**. Use a class or attribute to flip the side. Ensure they aren't clipped by `overflow` on the bars (the tooltip may need `position: fixed`/high `z-index` or the bar's overflow set to visible).
- Keep `aria-label` on every button for accessibility. **Remove the native `title`** attribute on these buttons so the OS tooltip doesn't duplicate the custom one (the `aria-label` covers screen readers).

Descriptions (use these):
| Button | Tooltip |
|--------|---------|
| `#activity-explorer` | Show / Hide Explorer (⌘B) |
| `#activity-preview` | Show / Hide Preview (⌘P) |
| `#activity-reading` | Reading View (⌘E) |
| `#activity-linenumbers` | Show / Hide Line Numbers |
| `#btn-split` | Toggle Split View |
| `#btn-sync-scroll` | Sync Editor & Preview Scroll |
| `#btn-zoom-out` | Zoom Out (⌘−) |
| `#btn-zoom-in` | Zoom In (⌘=) |
| `#activity-settings` | Appearance Settings |
| `#btn-sub-mode` | Toggle Sub Pane Edit / Preview |
| `#btn-sub-linenumbers` | Sub Pane Line Numbers |
| `#btn-sub-zoom-out` | Sub Pane Zoom Out |
| `#btn-sub-zoom-in` | Sub Pane Zoom In |

**Accept:** Hovering any activity-bar / sub-activity-bar icon shows a readable, app-styled tooltip with the right text; left-bar tooltips open to the right, sub-bar tooltips to the left; no duplicate native OS tooltip; screen-reader labels preserved.

## Done criteria
- `npm run build` passes; manual `npm run tauri dev` confirms both Accept sections.
- Update `CHANGELOG.md` under `## 0.9.2` (Fixes or a new "UI" line): controls moved to the activity bar + hover tooltips.
- Small, descriptive commits on `main`.
