# Plan — Editor ↔ Preview Sync

Implementation order:

1. **Enable source-line mapping in markdown-it render**
   - In the render pipeline in `src/main.ts`, add a rule that injects `data-source-line="<startLine>"` on every block-level token that has `token.map`.
   - Verify in DevTools that headings, paragraphs, lists, code blocks, callouts all carry the attribute.

2. **Add sync-scroll toggle**
   - Add a toolbar button (icon + tooltip "Sync scroll"). Active state styled with `--accent`.
   - State held in a module-level `syncScrollEnabled` boolean.

3. **Editor → preview scroll handler**
   - On CM6 scroll, get the top visible line number.
   - Find the preview element with the largest `data-source-line <= topLine`.
   - Scroll preview so that element's `offsetTop` aligns with preview's scrollTop.
   - Guard with `isSyncing` flag set for ~50ms to prevent feedback.

4. **Preview → editor scroll handler**
   - On preview scroll, find the topmost visible `[data-source-line]` element.
   - Read its line number, compute CM6 position for that line, call `editor.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start" }) })`.
   - Same `isSyncing` guard.

5. **Click-to-cursor**
   - Add `click` listener on the preview container.
   - Walk up from `event.target` to find nearest `[data-source-line]`.
   - Read line, compute CM6 doc position for line start, dispatch `{ selection: { anchor: pos }, effects: scrollIntoView(pos) }`.
   - Focus the editor afterward.

6. **Manual smoke test** per `spec.md` test plan.

7. **Update README** with one short bullet under features.
