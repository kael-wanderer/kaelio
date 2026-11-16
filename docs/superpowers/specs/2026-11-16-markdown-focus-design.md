# Kaelio Markdown Focus — Design

Date: 2026-11-16
Status: approved by owner 2026-11-16, including every item under "Calls I made"
Mockup: `docs/design/2026-11-16-markdown-focus-mockup.html`
Plans: `docs/superpowers/plans/2026-11-16-markdown-focus-a-quick-wins.md`, `…-b-removals-and-export.md`, `…-c-new-features.md`

## Intent

Kaelio is a fast reader and light editor for Markdown, with the ability to view HTML files. Its tagline is "Friendly AI-generated, human-reading": the typical document is something an AI agent wrote and a person now reads, checks and lightly edits.

BugText (`/Users/cong.bui/Kael/19-AppBuild/bugtext`) is the larger workspace app: AI panel, PDF reader and editor with OCR, MCP server, settings screen. Anything that is not Markdown or HTML viewing, and that BugText already does better, leaves Kaelio. What stays gets better at the things people do every day in a Markdown file.

## Goals

1. Remove the features that are not Markdown or HTML viewing.
2. Fix the eight weak spots found in the feature review.
3. Add four features a Markdown user touches many times a day.

## Non-goals

- No AI features, no PDF handling, no settings screen. Those belong to BugText.
- No vault features (backlinks, graph, wikilink autocomplete).
- No refactor of `src/main.ts` beyond moving new pure logic into `src/lib/`.
- No change to Git sync, conflict resolution, staging or discard (see "Calls I made").
- No release or version bump. Changes land under "Unreleased" in `CHANGELOG.md`.

## Anti-goals

- A removal that leaves a dead menu item, a dead shortcut, a broken guide page or an unused dependency.
- Any path where HTML opened in Kaelio can call a Tauri command or read the parent window.
- A paste or table feature that rewrites text the user did not expect to change.

## Constraints

- Tauri 2, vanilla TypeScript, no framework. All file access goes through Rust commands.
- `withGlobalTauri` is on. Everything written to `innerHTML` passes `escapeHtml` or `sanitizeHtmlString`.
- The app CSP in `src-tauri/tauri.conf.json` is not loosened for `script-src`.
- New npm packages come from the npm registry, pinned to an exact version (no `^`).
- The repo has no frontend test framework. This work adds one: Node's built-in runner (`node --test`), which runs TypeScript directly on the installed Node 26. New pure logic lives in `src/lib/*.ts` with a `*.test.ts` beside it.
- Rust tests stay in the `tests` module at the bottom of `src-tauri/src/lib.rs`.
- `docs/guide/` is published to kael.io.vn and must pass `npm run guide:check`.

## Approaches

**A. One spec, three plans by risk (chosen).** Plan A is small daily-impact fixes, Plan B is removals and export, Plan C is new features. Each plan leaves a working app and can ship alone. Small wins land first; the riskiest item (scripts in HTML view) lands last and can be dropped without blocking anything.

**B. One plan in review order (remove, improve, add).** Simple to read, but removals touch the most code first, so every later task rebases over a large diff, and the high-value small fixes wait.

**C. One plan per feature (17 plans).** Maximum isolation, but too much overhead for changes that are mostly 20 to 100 lines each.

---

## Part 1 — Remove

### R1. PDF viewer, annotations, Extract to Markdown

Remove `renderPdfPreview`, the text layer, PDF search, `extractPdfToMarkdown`, the highlight annotation UI, the Rust commands `read_annotations` and `write_annotations`, the `pdfjs-dist` dependency and its worker setup, PDF CSS, and the "Extract PDF to Markdown" palette command.

Existing `<file>.kaelio-annot.json` sidecar files on disk are left untouched.

### R2. CSV and JSON preview

Remove `renderCsvPreview` and `renderJsonPreview`. `.json` and `.csv` files still open as plain text in the editor, with the existing plain-text preview.

### R3. Standalone image viewer

Remove `renderImagePreview` and its zoom controls. Images inside a Markdown preview keep the lightbox.

### R4. What happens when a removed type is opened

Clicking a PDF, image or SVG in the sidebar, or a link to one in the preview, opens it in the system default app (Tauri opener plugin, `open_path`). The status bar shows "Opened in default app". No tab is created.

File associations in `tauri.conf.json` shrink to: `md`, `markdown`, `yaml`, `yml`, `txt`, `html`, `htm`. The entries for `json`, `csv`, `svg` and images are removed.

`read_binary_file` is removed only if nothing else calls it after R1 and R3.

### R5. Export menu

One flat list replaces the two submenus, in the File menu, the toolbar Export menu, the native macOS menu and the command palette:

| Item | How | Available for |
|---|---|---|
| PDF | Pandoc + Typst (real text) | Markdown |
| DOCX | Pandoc | Markdown |
| PNG | capture of the preview | Markdown, HTML |

Removed: JPG export, the image-based PDF (`exportHtmlPdf`), and the `jspdf` dependency. For an HTML file, PDF and DOCX are disabled (greyed) with the tooltip "Markdown only".

If Pandoc or Typst is missing, PDF export keeps the current install-hint error.

---

## Part 2 — Improve

### I1. Pasted images are saved as files

Today a pasted image is written into the Markdown as a base64 data URL. New behaviour: the image is saved to `assets/` beside the note and a relative link is inserted.

- New Rust command `save_pasted_image(note_path, data_base64, mime) -> relative_path`.
- Allowed types: `image/png`, `image/jpeg`, `image/gif`, `image/webp`. Anything else is rejected.
- Size limit: 20 MB decoded.
- File name is generated in Rust: `pasted-YYYYMMDD-HHMMSS.<ext>`, with `-2`, `-3`… on collision. The file is created with `create_new`, so nothing is ever overwritten.
- `assets/` is created if missing.
- Inserted text: `![](assets/pasted-20261116-073501.png)` followed by a newline.
- Untitled, unsaved note: keep today's message "Save file first to paste images".

### I2. Code blocks: syntax highlighting and a copy button

- `highlight.js` (common-languages build) through markdown-it's `highlight` option. A fence with an unknown or missing language is escaped and shown unhighlighted; no auto-detection.
- `mermaid` fences are untouched (they are converted to diagrams later in the pipeline).
- Each code block gets a "Copy" button in its top-right corner, visible on hover. Clicking copies the code text and shows "Copied" for 1.5 s.
- Token colours come from CSS variables so every theme (System, Light, Dark, Catppuccin, Everforest, Nord, Custom) stays readable.
- The copy button never appears in PNG export or in "Copy Formatted".
- Works in both the main preview and the split sub-pane preview.

### I3. Scripts in HTML view

Default is unchanged: scripts never run. When an HTML file contains a `<script` tag, a bar above the preview reads "Scripts are off for this page." with a "Run scripts" button. Choosing it reloads that file's preview with scripts enabled. The choice is remembered per file path for the current app session only; it is never persisted.

Isolation rules for script mode, all mandatory:

- The frame uses `sandbox="allow-scripts"` and never `allow-same-origin`.
- The page is served from a dedicated Tauri URI scheme, `kaelio-html`, not from `srcdoc` (a `srcdoc` frame inherits the app CSP, which blocks inline scripts, and the app CSP must not be loosened).
- The scheme handler serves only files inside the folder of the opened HTML file, behind a random per-open token. Paths are canonicalised and anything outside that folder gets 403.
- The scheme's response carries its own CSP allowing inline and `https:` scripts and styles.
- The frame must have no access to `window.__TAURI__`, to Tauri IPC, or to `window.parent.document`.

The plan starts this item with a short spike that proves those properties in the real webview. If any of them fails, the item stops there and is reported; nothing is weakened to make it pass.

PNG export of an HTML file always captures the static (scripts off) render.

### I4. Shortcuts follow convention

| Action | Old | New |
|---|---|---|
| File Search (quick open) | ⇧⌘F | ⌘P |
| Search in Files | ⌥⌘F | ⇧⌘F |
| Show/Hide Preview | ⌘P | ⌥⌘P |
| Toggle Outline | none | ⇧⌘O |
| Paste as plain text | none | ⇧⌘V |

Custom bindings the user already saved are kept. Where a saved custom binding collides with a new default, the custom one wins and the colliding action becomes unbound (visible in Customize Shortcuts). This migration runs once.

### I5. One history list

The History window shows one list, newest first, mixing Git commits and local snapshots. Each row has a "Commit" or "Snapshot" badge, the time, and View / Restore. The two tabs are removed.

History opens for any saved file. Without a folder or Git repo it shows snapshots only (today it refuses to open).

Crash recovery (the "Unsaved changes recovered" banner) is a different job and is unchanged.

### I6. Mermaid in PDF export renders locally

The frontend renders each Mermaid block to PNG (2× pixel ratio) with the same Mermaid instance the preview uses, and passes the images to `export_pdf` and `export_docx`. Rust writes them to its temp folder and replaces each block with an image reference. The `mermaid.ink` request and the `curl` call are removed. A diagram that fails to render stays in the document as a plain code block.

The privacy note in `README.md` and `docs/guide/reference/privacy.md` is updated: nothing leaves the machine during export.

### I7. Outline

- Shortcut ⇧⌘O.
- In Reading View, clicking an outline entry scrolls the preview to that heading (today it only moves the editor cursor).
- The entry for the heading currently at the top of the visible area is highlighted as you scroll.

### I8. Split view survives restart

The session file gains the split state: whether the second pane is open, its tabs, its active tab and its edit/preview mode. On restore, files that no longer exist are skipped; if none remain, the split stays closed.

---

## Part 3 — Add

### A1. Smart paste

**Rich text becomes Markdown.** When the clipboard holds HTML with real structure (headings, lists, tables, links, bold, italic, code, quotes, images), paste inserts the Markdown equivalent. Conversion uses `turndown` with the GFM plugin.

Plain paste is used instead when any of these is true:

- the clipboard HTML has no structural tags (for example text copied from a code editor, which is only styled `div` and `span`);
- the cursor is inside a fenced code block or inline code;
- the clipboard HTML is larger than 2 MB;
- the user pressed ⇧⌘V.

**URL over a selection becomes a link.** When text is selected and the clipboard is a single `http://` or `https://` URL, paste produces `[selected text](url)`. If the selection is itself a URL, or the cursor is inside code, paste is plain.

Undo (⌘Z) after a smart paste restores the state before the paste in one step.

### A2. Table editing

Active only when the cursor is on a line of a Markdown pipe table (a block with a header row and a `|---|` delimiter row).

- **Tab** moves to the next cell and selects its content. In the last cell of the last row, it adds a new empty row.
- **Shift+Tab** moves to the previous cell.
- On each Tab or Shift+Tab, the table is re-aligned: columns padded to equal width, delimiter row rebuilt, alignment colons (`:---`, `:---:`, `---:`) kept.
- `\|` and pipes inside inline code are not treated as column separators.

Outside a table, Tab and Shift+Tab behave as today. Width is counted in characters; wide CJK characters may look slightly off in a proportional editor font, which is accepted.

### A3. Changed-since-reload highlight

When an open, unmodified file changes on disk and Kaelio reloads it, the blocks in the preview that differ from the previous content get a coloured bar on their left edge. The status bar shows "3 changes" as a clickable chip that scrolls to the next changed block. The marks clear on the first keystroke in the editor, on the next reload, or when the chip's "×" is clicked.

If a reload removes text without adding any, the block after the removal point is marked.

Files larger than 20,000 lines skip the highlight (reload still happens).

### A4. Reading width

View → Reading Width: Narrow (60ch), Medium (75ch), Wide (90ch), Full. Applies in Reading View only (preview-only mode); split view always uses the full pane. The preview content is centred. Tables and diagrams wider than the column scroll horizontally inside it. Stored in localStorage as `kaelio-reading-width`.

---

## Documentation in scope

- `README.md`: feature list, shortcuts table, privacy note, export section.
- `CLAUDE.md`: remove PDF/CSV/JSON/image-viewer descriptions; add `src/lib/`, the test command, new commands.
- `CHANGELOG.md`: entries under "Unreleased".
- `docs/guide/`: `files/pdf-viewer`, `files/images-and-other-files`, `export/export`, `recipes/note-to-pdf`, `reference/keyboard-shortcuts`, `reference/privacy`, `reference/appearance`, `writing/markdown-features`, `writing/editor-and-preview`, `git/history-and-snapshots`. Both `npm run guide:check` and `npm run guide:test` must pass. If the checker forbids deleting a published slug, the page stays as a short note saying the feature moved to BugText.
- `docs/08-pdf-viewing.md` is deleted; `docs/04-pdf-export.md` is updated.

## Calls I made (proposed by the spec author, accepted by the owner on 2026-11-16)

1. **Git extras stay.** The review suggested dropping the conflict resolver, setup wizard, stage and discard. With auto-sync kept, a conflict with no resolver strands the user, so nothing in Git changes.
2. **PDF export means Pandoc + Typst only.** The image-based PDF needed no install but produced unselectable, blurry-when-zoomed pages. After I6 the Pandoc path has no privacy cost.
3. **JPG export is dropped.** PNG covers it.
4. **Removed file types open in the system default app** rather than showing an error.
5. **Preview toggle moves to ⌥⌘P**, because ⇧⌘V is taken by "Paste as plain text".
6. **Reading width defaults to Medium (75ch)** in Reading View. This changes how Reading View looks on a wide window for existing users.
7. **Script permission for HTML is per session**, never stored.
8. **Pasted images go to `assets/`** beside the note, not a configurable folder.
9. **History merge leaves crash recovery alone.**

## Left to the builder

- Exact CSS for the copy button, change bar, status chip and script bar, within the existing theme variables and the mockup's layout.
- Where inside `main.ts` new wiring sits.
- The line-diff algorithm for A3, as long as the tests in the plan pass.
- Exact pinned versions of new packages (resolve with `npm view <pkg> version` at install time).
