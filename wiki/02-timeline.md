# Timeline

Dated milestones, newest first. Kaelio's own history begins at the fork-rebrand from mx; upstream history lives in the [mx repo](https://github.com/vibery-studio/mx).

## Milestones

| Date | Milestone |
|------|-----------|
| 2026-05-31 | Explorer sort changed from lexicographic to numeric-aware (so `2-foo` sorts before `10-foo`). |
| 2026-05-30 | Filename search added to the explorer. |
| 2026-05-26 | **v0.9.1** — preview search (`Cmd+F` with match highlighting), persistent session restore (tabs, scroll, cursor) via `~/.kaelio/session.json`. |
| 2026-05-26 | Fixes: text selection in split view, always-visible explorer buttons, reliable file watcher. |
| 2026-05-26 | **v0.9.1 baseline commit** — first Kaelio commit in this repo; Markdown editor on Tauri 2 + Rust + TypeScript. |
| 2026-05-23 | **v0.9.0** — mx → Kaelio rebrand complete: package/cargo/conf/paths, `~/.mx/` → `~/.kaelio/` storage migration, localStorage key updates, PNG export, sync-scroll editor↔preview + click-to-cursor. |
| ~2026-05-19 | Identifier rebrand sweep started across config (package.json, tauri.conf, Cargo, window titles, README). |
| (upstream) | Forked from **mx** by Vibery Studio (GPL-3.0) — the Tauri 2 + CodeMirror 6 + markdown-it foundation. |

## On-hold / restart log

- **Status:** active WIP, not on hold. Core editing + Git sync are usable daily.
- **Open / evolving:** export paths still being firmed up — PNG/JPG/DOCX/HTML retest pending after the HTML-sandbox + preview-clipping fixes (see [lessons.md](lessons.md)).
- **If picking back up:** read [lessons.md](lessons.md) first, then [03-architecture.md](03-architecture.md). The whole frontend is one ~5000-line `src/main.ts`, so orient there.

## Versioning

`v*` git tags drive releases via `.github/workflows/release.yml` (macOS/Windows/Linux build, sign, publish `latest.json` for the in-app updater). Current version: **0.9.1**.
