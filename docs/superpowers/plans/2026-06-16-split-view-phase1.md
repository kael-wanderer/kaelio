# Split View — Phase 1 (Sub Pane Scaffold, Read-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second column on the right (sub pane) that can be toggled on/off via an icon next to zoom, has a draggable divider, and renders a chosen file as read-only markdown preview. No second editor yet — this de-risks the layout before Phase 2 makes it editable.

**Architecture:** Add `#sub-pane-wrapper` + `#sub-divider` to the layout after the existing preview pane. New module-level state `splitOpen` / `subFilePath`. A standalone `renderSubPreview(content)` runs the existing markdown pipeline into `#sub-pane` (static HTML only — no interactive checklists/mermaid wiring, which depend on the main `editor`). Reuse the existing divider-drag pattern. This is the foundation Phases 2–3 build on (editable sub editor, tabs, mode toggle, right-click entries).

**Tech Stack:** Tauri 2, vanilla TypeScript, CodeMirror 6, markdown-it, plain CSS.

**Testing note:** No test framework in this project. Verification is `npm run build` (TypeScript compile) plus the manual checks described. Do NOT add a test framework.

---

### Task 1: Layout — split toggle button + sub pane DOM

**Files:**
- Modify: `index.html:126` (toolbar, after zoom-in button)
- Modify: `index.html:228-229` (after `#preview-pane-wrapper`, inside `#editor-container`)

- [ ] **Step 1: Add the split toggle button next to zoom**

In `index.html`, the zoom controls are:
```html
          <button id="btn-zoom-out" title="Zoom out (Cmd+-)">−</button>
          <span id="status-zoom" class="toolbar-zoom">100%</span>
          <button id="btn-zoom-in" title="Zoom in (Cmd+=)">+</button>
```
Immediately after the `btn-zoom-in` line, add:
```html
          <span class="toolbar-sep"></span>
          <button id="btn-split" title="Toggle split view">⊟</button>
```

- [ ] **Step 2: Add the sub pane + divider after the preview pane**

In `index.html`, the editor container ends like this:
```html
        <div id="preview-pane-wrapper">
          ...
          <div id="preview-pane"></div>
        </div>
      </div>
```
Insert, between the closing `</div>` of `#preview-pane-wrapper` and the closing `</div>` of `#editor-container`:
```html
        <div id="sub-divider" class="hidden"></div>
        <div id="sub-pane-wrapper" class="hidden">
          <div id="sub-tab-bar"></div>
          <div id="sub-pane"></div>
        </div>
```
(`#sub-tab-bar` is an empty placeholder in Phase 1; Phase 2 fills it.)

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: compiles, no errors.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(split): add split toggle button and sub pane DOM"
```

---

### Task 2: CSS — sub pane layout and divider

**Files:**
- Modify: `src/styles.css` (append)

- [ ] **Step 1: Add sub pane styles**

Append to `src/styles.css`:
```css
/* Split view — sub pane (Phase 1: read-only) */
#sub-pane-wrapper {
  flex: 1 1 40%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--border, #45475a);
}
#sub-pane-wrapper.hidden { display: none; }
#sub-tab-bar {
  flex: 0 0 auto;
}
#sub-pane {
  flex: 1 1 auto;
  overflow: auto;
  padding: 1rem 1.5rem;
}
#sub-divider {
  flex: 0 0 4px;
  cursor: col-resize;
  background: var(--border, #45475a);
}
#sub-divider.hidden { display: none; }
```
(The `#sub-pane` padding mirrors the preview pane's reading style; if `#preview-pane` uses a specific class for markdown styling, see Task 3 Step 1 note about reusing it.)

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: compiles, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "feat(split): style sub pane and divider"
```

---

### Task 3: Logic — render, toggle, divider drag, wiring

**Files:**
- Modify: `src/main.ts` (new state near other UI state ~line 71; new functions near `updatePreview` ~1052 and `initDividerDrag` ~2363; wiring in the DOMContentLoaded setup block; init call in startup near line 5539)

- [ ] **Step 1: Add state and the sub-preview renderer**

First, confirm the CSS class used for rendered markdown. The main preview sets `previewPane.innerHTML = html` where `previewPane` is `#preview-pane` (src/main.ts:1100); markdown styling is scoped to `#preview-pane` in CSS. To get the same styling in the sub pane, the renderer below also applies the rendered HTML and we rely on generic element styles. If markdown styles are scoped strictly to `#preview-pane`, add `#sub-pane` to those selectors — but first try without; only widen selectors if the sub preview renders unstyled.

In `src/main.ts`, near the other top-level state (after `let currentFilePath: string | null = null;` at line 71), add:
```ts
let splitOpen = false;
let subFilePath: string | null = null;
```

Near `updatePreview` (after it ends at line 1143), add a standalone renderer that runs the markdown pipeline into `#sub-pane` as static HTML (no interactive checklist/mermaid/tag wiring — those depend on the main `editor`):
```ts
function renderSubPreview(content: string) {
  const pane = document.getElementById("sub-pane");
  if (!pane) return;
  if (subFilePath && !isMarkdownPath(subFilePath)) {
    pane.innerHTML = `<pre class="plain-text-preview">${escapeHtml(content)}</pre>`;
    return;
  }
  const { frontmatter, body } = extractFrontmatter(content);
  let html = "";
  if (frontmatter) html += renderFrontmatter(frontmatter);
  html += md.render(body, { lineOffset: 0 });
  html = renderCallouts(html);
  html = renderChecklists(html);
  html = renderKaTeX(html);
  pane.innerHTML = html;
}
```

- [ ] **Step 2: Add `openInSubPane`, `toggleSplit`, and `setSplit`**

After the function added in Step 1, add:
```ts
async function openInSubPane(path: string) {
  try {
    const result = await invoke<{ path: string; content: string }>("read_file", { path });
    subFilePath = result.path;
    renderSubPreview(result.content);
    setSplit(true);
  } catch (e) {
    flashStatus(`Could not open: ${path}`, "var(--red, #f38ba8)");
  }
}

function setSplit(open: boolean) {
  splitOpen = open;
  const wrapper = document.getElementById("sub-pane-wrapper");
  const divider = document.getElementById("sub-divider");
  const btn = document.getElementById("btn-split");
  wrapper?.classList.toggle("hidden", !open);
  divider?.classList.toggle("hidden", !open);
  btn?.classList.toggle("active", open);
}

function toggleSplit() {
  if (!splitOpen && !subFilePath) {
    // Nothing to show yet — open the current file as a starting reference.
    if (currentFilePath) { openInSubPane(currentFilePath); return; }
  }
  setSplit(!splitOpen);
}
```
Note: `invoke`, `flashStatus`, `currentFilePath`, `md`, `extractFrontmatter`, `renderFrontmatter`, `renderCallouts`, `renderChecklists`, `renderKaTeX`, `isMarkdownPath`, `escapeHtml` are all already defined and used elsewhere in this file.

- [ ] **Step 3: Add sub divider drag**

After `initDividerDrag` (ends line 2400), add a sibling drag initializer for the sub divider:
```ts
function initSubDividerDrag() {
  const divider = document.getElementById("sub-divider");
  const subWrapper = document.getElementById("sub-pane-wrapper");
  const previewPane = document.getElementById("preview-pane-wrapper");
  const container = document.getElementById("editor-container");
  if (!divider || !subWrapper || !previewPane || !container) return;

  let dragging = false;
  divider.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = subWrapper.getBoundingClientRect();
    const right = rect.right;
    const newWidth = Math.max(200, Math.min(right - 200, right - e.clientX));
    subWrapper.style.flexBasis = `${newWidth}px`;
  });
  window.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  });
}
```

- [ ] **Step 4: Wire the split button and init the drag**

`initDividerDrag()` is called at startup at src/main.ts:5354. Immediately after that line, add:
```ts
  initSubDividerDrag();
```

The zoom-in button listener is wired at src/main.ts:5141 (`document.getElementById("btn-zoom-in")?.addEventListener("click", zoomIn);`). Immediately after that line, add:
```ts
  document.getElementById("btn-split")?.addEventListener("click", () => toggleSplit());
```

- [ ] **Step 5: Verify it builds**

Run: `npm run build`
Expected: compiles cleanly, no errors (no unused symbols — `splitOpen`, `subFilePath`, `renderSubPreview`, `openInSubPane`, `setSplit`, `toggleSplit`, `initSubDividerDrag` are all referenced).

- [ ] **Step 6: Manual check**

Run: `npm run tauri dev`. With a markdown file open:
- Click the split icon (⊟, next to zoom): the right sub pane appears showing the current file rendered read-only; icon shows active state.
- Click it again: the sub pane and its divider hide; main layout returns to normal.
- With split open, drag the `#sub-divider`: the sub pane resizes; the rest of the layout adjusts.
- Confirm the main editor + preview still behave exactly as before (open files, edit, preview).

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(split): toggle, read-only sub render, and sub divider drag"
```

---

### Task 4: Docs

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a CHANGELOG entry**

Under the current version's "Editor and Preview" section in `CHANGELOG.md`, add:
```markdown
- Split view (Phase 1): toggle a read-only second pane (⊟ next to zoom) to view another document beside the editor; draggable divider. Editable sub pane and right-click entry points land in later phases.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(split): note Phase 1 read-only sub pane"
```
