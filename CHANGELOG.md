# Changelog

## 0.9.6

Highlights: updates now ask before installing, Help ▸ Kaelio Guide, math that spans lines, one-line tag lists, Markdown-only scope with a single export menu, smart paste, table editing, and security fixes for the preview.

### Changes

- **Updates ask first.** Kaelio checks for a new version at launch and once a day. When one is found, an **Update** button appears in the status bar; nothing is downloaded until you click **Install and Restart**. **Skip This Version** silences automatic checks for that version, and "Check automatically" can be turned off. Help ▸ Check for Updates still checks on demand.
- **Help ▸ Kaelio Guide** opens the online user guide; the shortcuts window links to the shortcuts page.
- **Run scripts in an HTML page, on request.** When an HTML file has scripts, a bar offers "Run scripts"; the page then runs in an isolated frame (no access to Kaelio, its storage or your other files; only the files in its folder for display and `https://` resources). Off by default and forgotten at restart. PNG export always captures the static page.
- **See what changed after a reload.** When an open file changes on disk and Kaelio reloads it, the changed blocks in the preview get a coloured bar, and a status-bar chip ("2 changes ↓") jumps to each one; × clears them, and typing clears them too. Files over 20,000 lines reload without marks.
- **Table editing.** In a Markdown pipe table, `Tab` and `Shift+Tab` move between cells and select their text, re-aligning the columns and keeping alignment colons; `Tab` in the last cell adds a row. Escaped pipes and pipes in inline code stay inside their cell. Outside a table `Tab` indents as before.
- **Smart paste.** Pasting formatted text (from a chat window or web page) inserts Markdown: headings, lists, tables, links, bold, italic, code and quotes. Pasting a URL over selected text makes a link. Google Docs and code copied as a bare `<pre>` paste cleanly. Code-editor text, anything pasted inside code, non-Markdown files and HTML over 2 MB stay plain; `Cmd+Shift+V` pastes plain text. One undo reverts a paste.
- **One history list.** File History shows Git commits and local snapshots in one list, newest first, each with a Commit or Snapshot badge; the two tabs are gone. History now opens for any saved file (command palette → File History), with snapshots only when there is no folder or Git repository.
- **Docs follow the Markdown focus.** README, the user guide (export, PDFs and other files, privacy, troubleshooting) and developer docs describe the single export menu, local diagram export and default-app opening; the PDF viewer guide page now redirects to "Images and other files".
- **Export no longer sends diagrams to mermaid.ink.** Mermaid diagrams in PDF and DOCX export are rendered locally on a light theme, so nothing leaves your machine and export works offline. A diagram with a syntax error stays in the document as a code block.
- **One export menu: PDF, DOCX, PNG.** The HTML ▸ and Markdown ▸ submenus are replaced by three items in the File menu, the toolbar, the macOS menu bar and the command palette. PDF and DOCX use Pandoc and are greyed out for HTML files ("Markdown only"). JPG export and the image-based PDF are removed.
- **PDFs and images open in your default app.** Clicking a PDF, image or SVG in the sidebar or a link in the preview hands it to the system default app instead of a Kaelio tab. The CSV table, JSON and standalone image viewers are gone; JSON and CSV open as plain text, and images inside a note keep their lightbox. File associations are now Markdown, YAML, TXT and HTML.
- **In-app PDF viewer removed.** PDF viewing, highlights and Extract to Markdown are gone (BugText has a full PDF reader). Existing `.kaelio-annot.json` files are left untouched.
- **Relative images show in the preview.** Images linked with a path relative to the note (such as `assets/pasted-….png`) are loaded from disk in the preview, the split pane and PNG export.
- **Menu shortcuts follow your bindings.** The macOS menu bar shows and uses the same keys as Customize Shortcuts; a shortcut you unbind or move no longer also triggers the old menu item.
- **Reading width.** View → Reading Width (Narrow, Medium, Wide, Full) sets a centred text column for Reading View; the default is Medium (75 characters). Split view is unchanged.
- **Split view survives a restart.** The second pane's tabs, active tab and edit/preview mode are saved with the session and restored on launch (when "Restore last session" is on). Files that no longer exist are skipped; if none remain, the split stays closed.
- **Outline works in Reading View.** `Cmd+Shift+O` toggles it; clicking a heading in Reading View scrolls the preview to it, the entry for the heading at the top of the view is highlighted as you scroll, and `#` lines inside code fences or front matter are no longer listed.
- **Code blocks are syntax-highlighted and have a Copy button.** Common languages are coloured to match the current theme; a fence with an unknown or no language stays plain. Hover a block and click **Copy** to copy its code. The button never appears in PNG export or Copy Formatted.
- **Pasted images are saved as files.** A pasted image goes to `assets/` beside the note and a relative link is inserted, instead of a base64 blob in the Markdown. PNG, JPEG, GIF and WebP up to 20 MB; files are never overwritten. Works in the split pane too.
- **Conventional shortcuts.** `Cmd+P` opens file search (quick open), `Cmd+Shift+F` searches in files, `Cmd+Alt+P` shows/hides the preview, and `Cmd+Shift+O` toggles the outline. Custom bindings you saved are kept; a new default that collides with one of them is left unbound.

### Security

- **KaTeX 0.19.1** (also used for Mermaid labels) clears the remaining npm audit advisory.
- **Preview no longer runs scripts from a document.** The HTML sanitizer parsed markup inside the live page, so `<img onerror=…>` in a Markdown file ran before it could be stripped, with full access to Kaelio's file and Git commands. It now parses in an inert document, and also blocks `javascript:` URLs written with embedded whitespace, `<object>`, `<embed>`, `<base>` and `<meta>`.
- **File names are escaped** in the sidebar, the recent-files list and the history panel; a crafted file name could run script when its folder was opened.
- **Content Security Policy enabled** (it was off): inline scripts and event handlers are refused even if markup slips through.

### Fixes

- **Math over several lines renders.** Display math written across lines between `$$` fences (such as `aligned` blocks) keeps its line breaks and `\\`, instead of failing. Prices such as "$5 and $10" stay text, and dollars in code are never math.
- **One-line tag lists.** `tags: [work, planning]` in the frontmatter shows each tag as its own chip, and × removes just that tag from the frontmatter.
- **Developer notes match the app.** CLAUDE.md now says the split view is restored from the session and lists the current shortcuts (`Cmd+P` file search, `Alt+Cmd+P` preview, `Shift+Cmd+F` search in files, `Shift+Cmd+O` outline).
- **A pasted image's link no longer lands in another tab.** If you switch tabs while an image is being saved, the file is kept in `assets/` and the status bar says the link was not inserted.
- **Images paste into Markdown files only.** Pasting an image into an HTML, YAML or text file no longer saves it to `assets/` or inserts a Markdown link; the status bar says why.
- **Pasting a URL over a selection makes a valid link.** Brackets in the selected text are escaped and a URL with parentheses is wrapped in `<…>`; a selection spanning several lines pastes the URL as plain text.
- **Script mode never serves hidden files.** A page running scripts can no longer load `.env`, `.git/…` or anything in a folder whose name starts with a dot, including through a symlink.
- **Replaced images update in the preview.** An image changed on disk now shows its new content without a restart (the watcher drops it from the image cache); the cache is cleared when you open another folder and is capped at 64 MB.
- **A reload can no longer land in the wrong tab.** If you switched tabs while Kaelio was re-reading a file changed on disk, that file's text could replace the new tab's content.
- **PNG export of an HTML page with local images works.** An `<img>` with a relative path made the export fail; images are now read from disk for the capture.
- **Links with spaces open.** A preview link such as `[Q3](<Q3 report.pdf>)`, or any link from a note in a folder with a space in its name, now opens the file instead of "Cannot open this file".
- **PDF export shows images again.** Images, including diagrams, failed with "file not found" because Typst looked for Pandoc's temporary image files under the wrong folder. Raw ```` ```{=typst} ```` blocks in a note are now printed as text in PDF export, so a note cannot make the export read other files.
- **File History no longer redirects Save.** Right-click → File History on another file made the next save write the open document over that file; it now opens the file first.
- **Closing split view saves each tab's own content.** With two or more unsaved sub-pane tabs, one tab's text was written into every file. Closing a background sub tab no longer discards the visible tab's edits.
- **Pull no longer discards uncommitted edits.** A fast-forward pull force-checked-out the working tree; it now stops and asks you to commit or discard first.
- **Version history View / Restore work** with the abbreviated commit ids shown in the list.
- **Sync setup refuses to adopt a parent repository** when the folder sits inside another Git repository.
- Git authentication gives up after a few attempts instead of retrying a rejected credential forever.
- Saves are atomic (temporary file, then rename), so a crash mid-save cannot truncate a document; save failures are shown instead of being ignored, and "Auto-saved" only appears after a successful save.
- Crash-recovery Restore / Dismiss remove only the recovery file shown, not every pending one.
- New File stops with an error when the folder is not writable instead of looping.
- Character count counts characters, not bytes (accented and CJK text was over-counted).
- Two windows exporting PDF/DOCX at the same time no longer overwrite each other's temporary files.
- Zoom Out shortcut is displayed as `⌘-` instead of `⌘`.

### Release

- Updater bundles and signatures are built again (the `latest.json` published with recent releases, 0.9.5 included, had empty signatures, so in-app update could not work). The release job now fails if any are missing. Copies already installed need one manual download.

### Cleanup

- Removed the unused `docx` and `@tauri-apps/plugin-opener` npm packages and the `wait-timeout` crate; declared the CodeMirror packages that were imported but not listed; removed Vite template assets and dead zen-mode CSS.

## 0.9.5

### New

- **In-app PDF viewer** — open `.pdf` files directly in Kaelio. Pages render via PDF.js (replacing the old native iframe) with continuous scroll, zoom in/out (remembered across opens), and a page indicator. Large PDFs render lazily so scrolling stays smooth; works fully offline.
- **Text selection & search in PDFs** — select and copy text, and use Cmd+F to search with match highlighting and next/previous navigation.
- **Extract PDF to Markdown** — pull a PDF's text into a new Markdown tab (best-effort; no tables or OCR).
- **PDF highlight annotations** — highlight text in a PDF; annotations are saved to a `<file>.kaelio-annot.json` sidecar and restored on reopen. The original PDF is never modified.

## 0.9.4

### New

- **Drag to copy** — drag files or folders from Finder/Explorer onto a folder in the sidebar to copy them into it (names auto-deduplicated on collision). Dragging onto the editor still opens the file.
- **Image viewer** — open PNG, JPG, GIF, WEBP, BMP, ICO, and AVIF images in the preview pane with zoom in/out.

## 0.9.3

### Export fixes

- **Markdown → PDF/DOCX now works reliably.** Fixed a file-descriptor exhaustion that broke launching Pandoc: the folder watcher used the kqueue backend (one descriptor per watched file), which ran the process out of descriptors when a folder containing `node_modules` was open, causing "Bad file descriptor"/"too many open files" on export. Switched to the macOS FSEvents backend (a single descriptor for the whole tree).
- **Pandoc is no longer bundled** — it's resolved from the system (Homebrew/PATH). Install once with `brew install pandoc` and `brew install typst` (Typst is the PDF engine; MacTeX is not required).
- **PDF tables now render with borders** (Pandoc's Typst template defaults to borderless; Kaelio now injects a table-stroke override).
- **Markdown PDF uses Typst explicitly** and no longer falls back to LaTeX; runs in a writable temp directory so export works from a packaged app.
- **HTML/preview image export** captures the full content — detects the real artboard size (e.g. fixed-size HTML diagrams) and slices/stitches tall captures, then auto-crops blank margins.

### File operations

- **Delete no longer needs Full Disk Access.** Moves to the system Trash when possible and otherwise falls back to a recoverable `~/.kaelio/trash/` folder; the sidebar shows where the file went. Replaced the y/n prompt with a Confirm/Cancel dialog.

## 0.9.2

### Split View & Compare

- **Split view** — toggle a second editable pane (⊟, next to zoom) beside the editor. It's a full editor with its own tabs and an edit/preview toggle (✎/👁); `Cmd+S` saves whichever pane has focus. Draggable divider.
- **Sub-pane control bar** — a control strip beside the sub pane with its own edit/preview, line-numbers, and zoom controls. **Per-pane zoom and line numbers** are independent of the main editor.
- **Unified tab bar** — main and sub tabs share the same styling, aligned over their panes.
- **File compare** — right-click a file → *Open in Split Window*, or *Select for Compare* → *Compare with Selected* to view two files side by side.

### Editor

- **Soft Wrap** modes (View → Soft Wrap): Off (horizontal scroll), Window Width, or Page Guide with a configurable guide column. Long lines no longer clip in the raw pane. Persists across restarts.

### Fixes

- Restructured Export into HTML capture and Markdown document groups; HTML PNG/JPG/PDF now capture full-width documents, while Markdown PDF/DOCX use Pandoc for real editable output.
- Moved split, sync-scroll, and main zoom controls into the activity bar and added styled hover tooltips for main and sub activity icons.
- Renamed Column wrap to Page Guide, added a persistent guide-column control, and cleaned up relocated activity-bar zoom/sync controls.
- Polished split-view menus and tab strips: native Soft Wrap menu, separated compare context sections, divider-aligned tab strips with overflow menus, and larger split controls.
- Reworked the split-view layout (main panes now live in their own region) so opening the sub pane no longer overflows or overlaps the main editor, the divider resizes only the main side, the sub preview matches the main preview's styling, and clicking to place the cursor no longer resizes the panes.
- **Export** — image/PDF exports now render on a light print theme so output is no longer dark/unreadable, and exported HTML is sanitized. Removed the broken standalone HTML-export path (and its unused Rust command).

## 0.9.1

### Editor and Preview

- Editor ↔ preview scroll sync: new toolbar toggle (⇅) keeps both panes aligned to the same source line when scrolling either side.
- Click-to-cursor: clicking any heading, paragraph, list item, code block, callout, or table in the preview moves the editor cursor to the matching source line and scrolls it into view.
- Preview search: Cmd+F in reading view (preview-only mode) opens a search bar with match highlighting, match count, and next/prev navigation (Enter / Shift+Enter).
- Tables in the preview now size their columns to fit content instead of stretching to full width. Wide tables scroll horizontally within their own container rather than breaking the page layout.

### Session Restore

- Scroll position and cursor offset are now preserved across app restarts for all open tabs.
- Session data (open tabs, active tab, scroll, cursor, folder) is persisted to `~/.kaelio/session.json` on disk, surviving app reinstalls and WebView storage resets. localStorage is used as a synchronous backup for reliability on close.

### Project Explorer

- Sidebar search now combines filename and content results in one flow, with filename matches shown first.
- Folder changes made outside Kaelio, such as adding, deleting, or renaming files in VSCode, now refresh the explorer automatically.
- Folder and file names in the explorer now use natural numeric-aware sorting, so `2.gws` appears before `10.salesforce`.

### External File Changes

- Open files changed outside Kaelio now reload automatically when the editor has no unsaved changes.
- If the open file changed on disk while Kaelio has unsaved edits, the existing reload/keep-current-content banner is shown.
- Kaelio also checks for disk changes when the app regains focus, covering cases where the OS file watcher misses an event.

## 0.9.0

Initial Kaelio release after forking and rebranding mx.

### App Identity

- Renamed the app to Kaelio.
- Updated product name, bundle identifier, updater endpoint, and app icon.
- Migrated local app data paths and localStorage keys from legacy mx names to Kaelio names where needed.

### Editor and Preview

- CodeMirror 6 Markdown editor with live split preview.
- Mermaid, KaTeX, YAML frontmatter, footnotes, wikilinks, callouts, tags, and interactive checklists.
- Multiple tabs, session restore, scroll sync, search/replace, command palette, and custom shortcuts.
- Theme, font, editor size, preview size, explorer size, and custom preview CSS support.

### Project Explorer

- Folder explorer for project-style navigation.
- File search and content search.
- Context menu actions for creating, renaming, duplicating, deleting, revealing, and copying paths.
- Preview support for Markdown, text, HTML, JSON, CSV, images, SVG, and PDF files.

### Export

- Preview export to PNG, JPG, PDF, and DOCX.
- HTML export with Kaelio preview styling.
- Bundled Pandoc/Typst sidecars kept for the Rust backend export pipeline.

### Git and History

- Git status, commit, push, pull, auto-sync, setup, and discard actions.
- Conflict resolver for sync conflicts.
- File history from Git commits plus local snapshots.

### Upstream Credit

- Preserves GPL-3.0 licensing and credits the original mx project by Vibery Studio.
