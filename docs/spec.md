# Spec — Editor ↔ Preview Sync

## What problem does this solve?

When editing a markdown file in Kaelio, the editor (left) and preview (right) scroll independently. Two friction points:

1. After scrolling one pane, the other is at a different section — hard to keep orientation in a long doc.
2. While reading the rendered preview, spotting a typo means manually hunting for that text in the editor before fixing it.

## What does success look like?

- **Sync scroll**: a toggle button. When ON, scrolling either pane keeps the other pane aligned to the same source line. When OFF, panes scroll independently (current behavior).
- **Click-to-cursor**: clicking any rendered element in the preview moves the editor cursor to the corresponding source line and scrolls the editor to reveal it. Works regardless of sync toggle state.

## What's out of scope?

- Character-level mapping inside a paragraph (line-level is enough for v1).
- Reverse direction of click-to-jump (clicking editor → highlight in preview).
- Mapping inside fenced code blocks beyond the block's starting line.
- Persisting sync toggle state across sessions (in-memory only for v1).

## Tech stack

Existing: Tauri 2, vanilla TS, CodeMirror 6, markdown-it. No new dependencies.

## Constraints

- Must not regress preview render performance noticeably (markdown-it source maps add ~negligible overhead).
- Must avoid scroll-event feedback loops between the two panes.
- Sync toggle UI must fit the existing toolbar (Catppuccin Mocha theme).

## Deliverables

- [ ] Code: source-line tagging in render pipeline, sync-scroll handler, click-to-cursor handler, toolbar button
- [ ] Manual test plan (see below)
- [ ] README update mentioning the new feature

## Test plan

- Open a long markdown file (>3 screens).
- Toggle sync ON, scroll editor → preview follows.
- Scroll preview → editor follows.
- Toggle OFF, confirm independent scroll.
- Click a heading in preview → editor cursor lands on that heading's line.
- Click a list item, paragraph, code block → cursor lands on correct line.
- Confirm no jitter / no infinite scroll loop.
- Confirm preview render still works for math, mermaid, callouts, checklists.
