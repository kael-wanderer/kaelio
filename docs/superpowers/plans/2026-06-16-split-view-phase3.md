# Split View — Phase 3 (Right-click Entry Points) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax. Small phase — adds explorer context-menu items that call the existing Phase 2 `openInSubPane` / `openFile`.

**Goal:** Add explorer right-click entries — "Open in Split Window" and the two-step "Select for Compare → Compare with Selected" — to populate the sub pane.

**Architecture:** New `#context-menu` items + a `compareSelected` state variable. `showContextMenu` toggles item visibility (files only; "Compare with Selected" only when a file is already selected for compare). Handlers reuse `openInSubPane` (sub pane) and `openFile` (main pane).

**Tech Stack:** Tauri 2, vanilla TS. No tests — verify via `npm run build` + manual.

---

### Task 1: Context-menu items, state, visibility, handlers, wiring

**Files:**
- Modify: `index.html` (`#context-menu`, after `#ctx-reveal` ~line 250)
- Modify: `src/main.ts` (state ~line 139; `showContextMenu` ~3124; new handlers near other `ctx*` funcs; wiring ~line 5624)

- [ ] **Step 1: Add menu items**

In `index.html`, after `<div id="ctx-reveal" class="ctx-item">Reveal in Finder</div>` (line 250), insert:
```html
        <div class="ctx-divider" id="ctx-split-divider"></div>
        <div id="ctx-open-split" class="ctx-item">Open in Split Window</div>
        <div id="ctx-select-compare" class="ctx-item">Select for Compare</div>
        <div id="ctx-compare-with" class="ctx-item">Compare with Selected</div>
```

- [ ] **Step 2: Add `compareSelected` state**

In `src/main.ts`, next to `let contextMenuTarget` (line 139), add:
```ts
let compareSelected: string | null = null;
```

- [ ] **Step 3: Toggle item visibility in `showContextMenu`**

In `showContextMenu` (line 3124), after `contextMenuTarget = target;` (line 3127), add:
```ts
  const isFile = !target.isDir;
  const hasCompare = !!compareSelected && compareSelected !== target.path;
  document.getElementById("ctx-split-divider")?.classList.toggle("hidden", !isFile);
  document.getElementById("ctx-open-split")?.classList.toggle("hidden", !isFile);
  document.getElementById("ctx-select-compare")?.classList.toggle("hidden", !isFile);
  document.getElementById("ctx-compare-with")?.classList.toggle("hidden", !(isFile && hasCompare));
```

- [ ] **Step 4: Add handlers**

Near the other `ctx*` handlers (e.g. after `ctxReveal`), add:
```ts
function ctxOpenSplit() {
  if (!contextMenuTarget) return;
  const path = contextMenuTarget.path;
  hideContextMenu();
  openInSubPane(path);
}

function ctxSelectCompare() {
  if (!contextMenuTarget) return;
  compareSelected = contextMenuTarget.path;
  flashStatus(`Selected for compare: ${compareSelected.split("/").pop()}`, "var(--accent)");
  hideContextMenu();
}

async function ctxCompareWith() {
  if (!contextMenuTarget || !compareSelected) return;
  const a = compareSelected;
  const b = contextMenuTarget.path;
  hideContextMenu();
  await openFile(a);
  await openInSubPane(b);
  compareSelected = null;
}
```

- [ ] **Step 5: Wire the items**

Near the other ctx wiring (after `getElementById("ctx-reveal")...`, line 5624), add:
```ts
  document.getElementById("ctx-open-split")?.addEventListener("click", ctxOpenSplit);
  document.getElementById("ctx-select-compare")?.addEventListener("click", ctxSelectCompare);
  document.getElementById("ctx-compare-with")?.addEventListener("click", ctxCompareWith);
```

- [ ] **Step 6: Build** — `npm run build` (expect: clean; all handlers referenced).

- [ ] **Step 7: Manual check** (`npm run tauri dev`)
- Right-click a file → "Open in Split Window": opens it in the sub pane (split turns on).
- Right-click a folder: the three split items do NOT appear.
- Right-click file A → "Select for Compare" (flash confirms); "Compare with Selected" is hidden at this point on A.
- Right-click file B → now "Compare with Selected" appears → click it: A opens in the main pane, B in the sub pane.
- Right-click the same file you selected for compare: "Compare with Selected" stays hidden (no self-compare).

- [ ] **Step 8: Commit**
```bash
git add index.html src/main.ts
git commit -m "feat(split): right-click Open in Split Window and Compare entries"
```

---

### Task 2: Docs

- [ ] **Step 1:** In `CHANGELOG.md`, update the split line to mention the right-click entries (replace "via right-click (see below)" with the concrete actions):
```markdown
- Split view: toggle a second pane (⊟ next to zoom) beside the editor — a full editor with its own tabs and an edit/preview toggle (✎/👁); Cmd+S saves whichever pane has focus. Open files into it via right-click → "Open in Split Window", or compare two files via "Select for Compare" → "Compare with Selected". Draggable divider.
```
- [ ] **Step 2:** Commit: `git add CHANGELOG.md && git commit -m "docs(split): document right-click split/compare entries (Phase 3)"`
