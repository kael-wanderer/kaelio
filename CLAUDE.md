# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Kaelio

A fast, lightweight markdown editor built with Tauri 2 + Rust. Forked from [vibery-studio/mx](https://github.com/vibery-studio/mx) (GPL-3.0). Features: live split preview, Mermaid diagrams, KaTeX math, YAML frontmatter, PDF export via Pandoc, in-app PDF viewing (pdfjs: view/select/search/extract/annotate), auto-update, native Apple Silicon support, git sync (auto-commit/push on save), Obsidian-style callouts & interactive checklists, conflict resolution, version history with snapshots. Current version: 0.9.5. License: GPL-3.0.

## Commands

```bash
npm install              # Install dependencies
npm run tauri dev        # Dev server (Vite :1420) + Rust backend in watch mode
npm run build            # TS compile + Vite bundle → dist/
npm run tauri build      # Full app bundle (per platform)
```

No test framework or linter configured.

Release: push a `v*` tag to trigger `.github/workflows/release.yml` (builds macOS/Windows/Linux, signs, creates GitHub Release with `latest.json` for auto-updater).

## Architecture

**Tauri 2 IPC-first**: all file/system ops go through Rust commands, no direct Node.js access from frontend.

### Frontend (`src/`)
- **Monolithic**: entire app in `src/main.ts` (~5000 lines) + `src/styles.css` + `index.html`
- Vanilla TypeScript, no framework (CodeMirror 6 for editor, markdown-it for preview)
- Rendering pipeline: markdown-it → callouts → checklists → KaTeX (math) → Mermaid (diagrams) → YAML frontmatter extraction
- PDF viewing: `.pdf` files render via `pdfjs-dist` (canvas + lazy IntersectionObserver, persisted zoom under `kaelio-pdf-zoom`) in `renderPdfPreview`; replaced the old native `<iframe>`. Adds a transparent text layer for selection + Cmd+F search, "Extract to Markdown" (`extractPdfToMarkdown`, heuristic/lossy — no tables/OCR), and highlight annotations persisted to a `<file>.kaelio-annot.json` sidecar (original PDF never mutated)
- Git integration: state management (gitStatusMap, gitRepoInfo, autoSyncEnabled), non-blocking sync via fire-and-forget promises
- 300ms debounce on content change before re-rendering preview
- State: `currentFilePath`, `editor` (CM6 instance), `zoomLevel` — persisted in localStorage; session data (tabs, scroll, cursor) persisted to `~/.kaelio/session.json` via Rust with localStorage as sync backup
- Theme: Catppuccin Mocha dark palette via CSS variables (`--bg: #1e1e2e`, `--accent: #89b4fa`, etc.)
- View modes: split | editor-only | preview-only
- Editor soft-wrap: off | window | column (80, with guide line) — View → Soft Wrap, persisted in localStorage as `kaelio-wrap-mode` (default `window`) via a `lineWrapCompartment`
- Split view: second pane (⊟ toolbar toggle) with its own editor (`editorSub`), tabs, and edit/preview toggle — capped at 2 panes (explicit `editor`/`editorSub`, no generic pane system). `activePane` routes Cmd+S (`saveActivePane`). Opened via right-click "Open in Split Window" or "Select for Compare → Compare with Selected". Not persisted across restart.
- Key bindings: Cmd+O (open), Cmd+S (save), Cmd+P (toggle preview), Cmd+E (read mode), Cmd+B (sidebar), Cmd+F (search — editor or preview depending on view mode)

### Backend (`src-tauri/`)
- `src/lib.rs` (~2150 lines): all Tauri commands
- File commands: `read_file`, `save_file`, `word_count`, `list_directory`, `get_home_dir`, `get_initial_file`, `delete_entry` (Trash → `~/.kaelio/trash` fallback), `copy_into_folder` (drag-to-copy into a sidebar folder), `read_binary_file` (raw bytes + MIME for the in-app image viewer: PNG/JPG/GIF/WEBP/BMP/ICO/AVIF, with zoom, and the PDF.js viewer)
- Export (two families): **HTML group** (PNG/JPG/PDF) via frontend preview capture (`html-to-image` + `jsPDF`, full-width capture); **Markdown group** (PDF/DOCX) via Rust `export_pdf`/`export_docx`. Pandoc is **NOT bundled** — it's resolved from the system (`find_pandoc()`: Homebrew `/opt/homebrew/bin`, `/usr/local/bin`, then PATH). Markdown PDF/DOCX export requires `brew install pandoc`; Markdown PDF also requires `brew install typst`. MacTeX is not required. (Bundling pandoc as a Tauri sidecar was removed — exec'ing the build-machine path failed on end-user installs; `export_html` also removed.)
- Git commands (git2 crate): `git_repo_info`, `git_status`, `git_diff_file`, `git_log`, `git_commit`, `git_push`, `git_pull`, `git_auto_sync`, `git_setup_sync`, `git_check_auth`, `git_init`, `git_discard_file`, `git_stage_file`, `git_file_at_commit`, `git_restore_file`, `git_conflict_info`, `git_resolve_conflict`
- PDF annotation commands: `read_annotations`, `write_annotations` (read/write the `<pdf>.kaelio-annot.json` sidecar; original PDF is never modified)
- Snapshot commands: `save_snapshot`, `list_snapshots`, `read_snapshot`
- Session commands: `save_session`, `load_session` (read/write `~/.kaelio/session.json`)
- Credential handling: SSH agent → SSH key files → system `git credential fill` (HTTPS)
- Plugins: dialog, process, opener, updater

### Build/Release
- Vite dev server on :1420, HMR on :1421
- CI matrix: macOS aarch64, Windows x86_64, Linux x86_64
- Updater: signed `.tar.gz`/`.sig` artifacts, `latest.json` manifest on GitHub Releases
- Bundle file associations: `.md`, `.markdown`, `.yaml`, `.yml`, `.txt`

## Docs

Technical docs in `docs/` (00-08) cover architecture, editor engine, preview pipeline, file ops, PDF export, UI layout, auto-update, release pipeline, and PDF viewing.
