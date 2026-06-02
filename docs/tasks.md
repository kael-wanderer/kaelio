# Tasks — Editor ↔ Preview Sync

### Code Tasks
[x] 1. Add `data-source-line` attribute injection to markdown-it render pipeline
[x] 2. Add sync-scroll toolbar button + state
[x] 3. Implement editor → preview scroll handler (with feedback guard)
[x] 4. Implement preview → editor scroll handler (with feedback guard)
[x] 5. Implement click-to-cursor on preview
[x] 6. Focus editor after click-jump

### Testing Tasks
[x] Build verification — `npm run build` (TS compile + Vite bundle) passes 2026-06-02
[ ] Long-doc scroll sync both directions  ← manual GUI test, human-in-loop
[ ] Toggle OFF restores independent scroll
[ ] Click heading / list / paragraph / code block lands on correct line
[ ] No jitter / infinite loop
[ ] Math, mermaid, callouts, checklists still render

### Documentation Tasks
[x] Update README features list
