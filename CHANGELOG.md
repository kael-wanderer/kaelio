# Changelog

## 0.9.2

### Split View & Compare

- **Split view** — toggle a second editable pane (⊟, next to zoom) beside the editor. It's a full editor with its own tabs and an edit/preview toggle (✎/👁); `Cmd+S` saves whichever pane has focus. Draggable divider.
- **Sub-pane control bar** — a control strip beside the sub pane with its own edit/preview, line-numbers, and zoom controls. **Per-pane zoom and line numbers** are independent of the main editor.
- **Unified tab bar** — main and sub tabs share the same styling, aligned over their panes.
- **File compare** — right-click a file → *Open in Split Window*, or *Select for Compare* → *Compare with Selected* to view two files side by side.

### Editor

- **Soft Wrap** modes (View → Soft Wrap): Off (horizontal scroll), Window Width, or Column (80) with a vertical guide line. Long lines no longer clip in the raw pane. Persists across restarts.

### Fixes

- Reworked the split-view layout (main panes now live in their own region) so opening the sub pane no longer overflows or overlaps the main editor, the divider resizes only the main side, the sub preview matches the main preview's styling, and clicking to place the cursor no longer resizes the panes.

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
