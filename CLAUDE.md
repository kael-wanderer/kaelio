# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Kaelio

A fast, lightweight markdown editor built with Tauri 2 + Rust. Forked from [vibery-studio/mx](https://github.com/vibery-studio/mx) (GPL-3.0). Features: live split preview, Mermaid diagrams, KaTeX math, YAML frontmatter, PDF/DOCX/PNG export (Mermaid rendered locally), HTML viewing, auto-update, native Apple Silicon support, git sync (auto-commit/push on save), Obsidian-style callouts & interactive checklists, conflict resolution, version history with snapshots. Current version: 0.9.7 (build 375). License: GPL-3.0.

## Commands

```bash
npm install              # Install dependencies
npm run tauri dev        # Dev server (Vite :1420) + Rust backend in watch mode
npm run build            # TS compile + Vite bundle → dist/
npm run tauri build      # Full app bundle (per platform)
```

Tests: `npm test` (Node's built-in runner, `node --test`, over `src/lib/**/*.test.ts`; pure frontend logic lives in `src/lib/*.ts` with a test beside it) and `cd src-tauri && cargo test --lib` (Rust unit tests at the bottom of `lib.rs`). No linter; `npx tsc --noEmit` is the type check. Checks before a commit: `npm test`, `npx tsc --noEmit`, `cargo test --lib`, `npm run build`.

Release: push a `v*` tag to trigger `.github/workflows/release.yml` (builds macOS/Windows/Linux, signs, creates GitHub Release with `latest.json` for auto-updater). Version lives in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`; the build number is `bundle.macOS.bundleVersion` in `tauri.conf.json` (macOS `CFBundleVersion`, shown as "0.9.7 (375)" in About) and goes up on every build, even when the version stays the same. CI builds with `--config src-tauri/tauri.release.conf.json`, which turns on `createUpdaterArtifacts`; it stays off in `tauri.conf.json` so local builds need no signing key.

## Architecture

**Tauri 2 IPC-first**: all file/system ops go through Rust commands, no direct Node.js access from frontend.

### Frontend (`src/`)
- **Mostly monolithic**: app wiring in `src/main.ts` (~7400 lines) + `src/styles.css` + `index.html`; pure, tested helpers in `src/lib/` (`file-kind`, `export-availability`, `mermaid-export`, `keybindings`, `outline`, `session`, `history` (merged commit/snapshot list), `smart-paste` (turndown + GFM), `table` (pipe-table Tab/align), `line-diff` (changed-since-reload marks), `html-scripts`, …)
- Vanilla TypeScript, no framework (CodeMirror 6 for editor, markdown-it for preview)
- Rendering pipeline: YAML frontmatter extraction (`src/lib/frontmatter.ts`: block and `[a, b]` lists; tag × edits only the frontmatter) → markdown-it with math parsed from source (`src/lib/markdown-math.ts`: `$…$` / `$$…$$`, Pandoc dollar rules, first `$` after an opener must close, so prices stay text; KaTeX renders) → callouts → checklists → sanitize → Mermaid (diagrams)
- File kinds (`fileKind` in `src/lib/file-kind.ts`): Markdown and HTML preview; other text opens as plain text; PDF, images and SVG are `external` and go to the system default app via `open_in_default_app` (no tab; session restore skips them). There is no in-app PDF, image, CSV or JSON viewer (removed for the Markdown focus; BugText covers PDFs)
- Git integration: state management (gitStatusMap, gitRepoInfo, autoSyncEnabled), non-blocking sync via fire-and-forget promises
- 300ms debounce on content change before re-rendering preview
- State: `currentFilePath`, `editor` (CM6 instance), `zoomLevel` — persisted in localStorage; session data (tabs, scroll, cursor) persisted to `~/.kaelio/session.json` via Rust with localStorage as sync backup
- Theme: Catppuccin Mocha dark palette via CSS variables (`--bg: #1e1e2e`, `--accent: #89b4fa`, etc.)
- View modes: split | editor-only | preview-only
- Editor soft-wrap: off | window | column (80, with guide line) — View → Soft Wrap, persisted in localStorage as `kaelio-wrap-mode` (default `window`) via a `lineWrapCompartment`
- Split view: second pane (⊟ toolbar toggle) with its own editor (`editorSub`), tabs, and edit/preview toggle — capped at 2 panes (explicit `editor`/`editorSub`, no generic pane system). `activePane` routes Cmd+S (`saveActivePane`). Opened via right-click "Open in Split Window" or "Select for Compare → Compare with Selected". Its tabs, active tab and edit/preview mode are saved in the session and restored on launch (`parseSplitSession` in `src/lib/session.ts`; missing files skipped, split stays closed if none remain).
- Key bindings: Cmd+O (open), Cmd+S (save), Cmd+P (file search / quick open), Alt+Cmd+P (toggle preview), Shift+Cmd+F (search in files), Shift+Cmd+O (toggle outline), Cmd+E (read mode), Cmd+B (sidebar), Cmd+F (search — editor or preview depending on view mode)

### Backend (`src-tauri/`)
- `src/lib.rs` (~4200 lines, tests included): all Tauri commands. Sync commands run on the main thread; only the exports are async
- File commands: `read_file`, `save_file`, `word_count`, `list_directory`, `get_home_dir`, `get_initial_file`, `delete_entry` (Trash → `~/.kaelio/trash` fallback), `copy_into_folder` (drag-to-copy into a sidebar folder), `read_binary_file` (raw bytes + MIME; loads relative images in the preview), `save_pasted_image` (pasted image → `assets/` beside the note), `open_in_default_app` (allow-listed extensions only: pdf and images; canonical regular file, else refused)
- Export: one menu, **PDF / DOCX / PNG** (`exportPdf`, `exportDocx`, `exportPng`; native menu ids `export.pdf|docx|png`). PNG captures the preview (`html-to-image`). PDF/DOCX go through Rust `export_pdf`/`export_docx` and are Markdown-only (`exportAvailability`). Mermaid blocks are rendered to PNG in the frontend (`renderDiagramsForExport`) and passed as `diagrams`; Rust validates names/size/PNG signature (`write_diagrams`) and links them (`link_diagrams`) — no network. Pandoc runs Typst with `--root=/` (non-Windows) so absolute image paths resolve; PDF input disables `raw_attribute` so a note cannot inject Typst `#read`. Pandoc is **NOT bundled** — it's resolved from the system (`find_pandoc()`: Homebrew `/opt/homebrew/bin`, `/usr/local/bin`, then PATH). PDF/DOCX export requires `brew install pandoc`; PDF also requires `brew install typst`. MacTeX is not required. (Bundling pandoc as a Tauri sidecar was removed — exec'ing the build-machine path failed on end-user installs; `export_html` also removed.)
- Git commands (git2 crate): `git_repo_info`, `git_status`, `git_diff_file`, `git_log`, `git_commit`, `git_push`, `git_pull`, `git_auto_sync`, `git_setup_sync`, `git_check_auth`, `git_init`, `git_discard_file`, `git_stage_file`, `git_file_at_commit`, `git_restore_file`, `git_conflict_info`, `git_resolve_conflict`
- Snapshot commands: `save_snapshot`, `list_snapshots`, `read_snapshot`
- Session commands: `save_session`, `load_session` (read/write `~/.kaelio/session.json`)
- Credential handling: SSH agent → SSH key files → system `git credential fill` (HTTPS)
- Plugins: dialog, process, opener, updater
- `save_file` and `git_restore_file` write through `write_atomic` (temp file + rename); other writes are still plain `fs::write`
- HTML script mode (macOS only): `kaelio-html` URI scheme (`register_uri_scheme_protocol`) serves `kaelio-html://localhost/<token>/<path>` from the one folder a token grants; commands `html_grant` (path of an .html/.htm → `{token, file_name}`; kept until `html_revoke` (tab close / Turn off); refused when the folder is `$HOME` or `/`) and `html_revoke`; core logic `resolve_html_request` (decode once, canonicalise, outside folder → 403) and `html_content_type`. The frame is `sandbox="allow-scripts"` with no `allow-same-origin`; the response carries its own CSP; the app CSP only adds the scheme to `frame-src`. Default HTML preview stays a static `srcdoc` frame. Smart paste and table Tab act only in Markdown files (`viewIsMarkdown`)
- Updates (`src/lib/update-check.ts`, after Bugler): check at launch, then hourly tick that checks once 24h passed (`kaelio-update-last-check`); a found version shows the `#status-update` chip; nothing downloads until **Install and Restart** in `#update-modal`; Skip This Version (`kaelio-update-skipped`) silences automatic checks only; opt-out `kaelio-update-auto` = "0". Errors shown generic, details to console
- Guide links (`src/lib/guide-link.ts`): Help ▸ Kaelio Guide (native `help.guide`, HTML `#btn-guide`, palette) and the shortcuts modal open `https://kael.io.vn/projects/kaelio/docs/<slug>`; the test fails if a linked slug is not in `docs/guide/published-slugs.txt`
- Clipboard: `tauri-plugin-clipboard-manager` with only `clipboard-manager:allow-read-text`, for Paste as Plain Text (⇧⌘V fires no paste event in the webview)
- Security: CSP is set in `tauri.conf.json` (`csp` / `devCsp`); `withGlobalTauri` is on, so anything written to `innerHTML` must pass `escapeHtml` or `sanitizeHtmlString` (inert `DOMParser` parse)

### Running and testing the dev app

- Run the dev app (`npm run tauri dev`) and do GUI testing on monitor 2 (the non-primary display) by default: put its windows there and do every click there, menu bar items included.
- If monitor 2 is not connected, fall back to monitor 1.

### Build/Release
- Vite dev server on :1420, HMR on :1421
- CI matrix: macOS universal (aarch64 + x86_64), Windows x86_64, Linux x86_64
- Updater: signed `.tar.gz`/`.sig` artifacts, `latest.json` manifest on GitHub Releases
- Bundle file associations: `.md`, `.markdown`, `.yaml`, `.yml`, `.txt`, `.html`, `.htm`

## Docs

Technical docs in `docs/` (00-07) cover architecture, editor engine, preview pipeline, file ops, PDF export, UI layout, auto-update and release pipeline. The user guide is `docs/guide/` (`npm run guide:check`, `npm run guide:test`).
