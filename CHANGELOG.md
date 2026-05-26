# Changelog

## 0.9.1

### Editor and Preview

- Editor ↔ preview scroll sync: new toolbar toggle (⇅) keeps both panes aligned to the same source line when scrolling either side.
- Click-to-cursor: clicking any heading, paragraph, list item, code block, callout, or table in the preview moves the editor cursor to the matching source line and scrolls it into view.
- Preview search: Cmd+F in reading view (preview-only mode) opens a search bar with match highlighting, match count, and next/prev navigation (Enter / Shift+Enter).

### Session Restore

- Scroll position and cursor offset are now preserved across app restarts for all open tabs.
- Session data (open tabs, active tab, scroll, cursor, folder) is persisted to `~/.kaelio/session.json` on disk, surviving app reinstalls and WebView storage resets. localStorage is used as a synchronous backup for reliability on close.

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
