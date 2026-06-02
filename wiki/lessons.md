# Lessons & gotchas

If I restart this in a year, read this first — then [03-architecture.md](03-architecture.md).

## Orientation

- **The frontend is one file.** `src/main.ts` is ~5000 lines of vanilla TS — editor, preview, explorer, tabs, Git UI, export UI, all of it. Don't look for modules; search by feature name and orient by section.
- **The backend is one file too.** `src-tauri/src/lib.rs` (~2150 lines) holds every Tauri command. Grep for the command name.
- **No tests, no linter.** Verification is manual. There's a per-feature test plan in `docs/spec.md` / `docs/tasks.md` style — follow it.

## Gotchas

- **Scroll-sync feedback loops.** Editor↔preview sync must guard with an `isSyncing` flag (~50ms) or the two panes fight each other into a jitter loop. Same guard on both directions.
- **`data-source-line` is load-bearing.** Both scroll-sync and click-to-cursor depend on markdown-it injecting `data-source-line` on every block token with a `token.map`. If preview clicks stop jumping the cursor, check that attribute first.
- **Storage migration is done, don't redo it.** The `~/.mx/` → `~/.kaelio/` migration ran in v0.9.0. Storage now lives in `~/.kaelio/` (session.json, snapshots, preview.css).
- **Git sync is fire-and-forget.** Saves don't await the commit/push. That's deliberate (no save stalls on network) but means sync errors surface late — check the Git status display, not the save action.
- **Export is the soft spot.** PDF/DOCX favor preview-capture so output matches the screen; the Pandoc/Typst sidecar path still exists underneath. PNG/JPG/DOCX/HTML need a retest pass after the HTML-sandbox + preview-clipping fixes (see [02-timeline.md](02-timeline.md)).
- **Numeric-aware sort.** Explorer sorting is numeric-aware as of 2026-05-31 (`2-foo` before `10-foo`), not lexicographic — don't "fix" it back.

## License reminder

Kaelio is GPL-3.0, inherited from upstream **mx** (Vibery Studio). Keep the attribution; any distribution stays GPL-3.0.

## If a feature feels missing

Check whether it lives upstream in [mx](https://github.com/vibery-studio/mx) but wasn't carried over, vs. genuinely never built. The rebrand sweep changed identity, not every feature.
