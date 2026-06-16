# Text Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add soft-wrap modes (Off / Window Width / Column 80 with a guide line) to the CodeMirror editor so long lines stop clipping, surfaced via a "Text Display" section in the existing View menu alongside the Line Numbers toggle.

**Architecture:** Mirror the existing `lineNumbersCompartment` pattern. A new `lineWrapCompartment` holds `EditorView.lineWrapping` (or `[]`). Column mode additionally toggles a CSS class + custom property on `#editor-wrapper` that constrains `.cm-content` width and draws a vertical guide line. State persists in localStorage. The View menu gets a "Soft Wrap" `<select>` styled like the existing Font/Theme controls.

**Tech Stack:** Tauri 2, vanilla TypeScript, CodeMirror 6 (`@codemirror/view`), plain CSS.

**Testing note:** This project has no test framework (per CLAUDE.md). Verification is manual via `npm run tauri dev` and observing the running app. Each task ends with a concrete manual check and a commit.

---

### Task 1: Wrap state + compartment plumbing

**Files:**
- Modify: `src/main.ts:108-110` (state + compartment declarations)
- Modify: `src/main.ts:3578-3609` (`createEditorExtensions`)

- [ ] **Step 1: Add state variables and compartment**

In `src/main.ts`, just after the existing line-numbers state at lines 108-110:

```ts
let showLineNumbers = localStorage.getItem("kaelio-line-numbers") !== "false";
const lineNumbersCompartment = new Compartment();
const keymapCompartment = new Compartment();
```

add:

```ts
type WrapMode = "off" | "window" | "column";
let wrapMode: WrapMode = (localStorage.getItem("kaelio-wrap-mode") as WrapMode) || "window";
const wrapColumn = 80;
const lineWrapCompartment = new Compartment();
```

- [ ] **Step 2: Add a helper that returns the wrap extension for the current mode**

Add this function near the other editor helpers (e.g. just above `createEditorExtensions` at line 3578):

```ts
function wrapExtension() {
  return wrapMode === "off" ? [] : EditorView.lineWrapping;
}
```

- [ ] **Step 3: Register the compartment in `createEditorExtensions`**

In `createEditorExtensions` (line 3578), add the compartment right after the `lineNumbersCompartment` line (3580):

```ts
    lineNumbersCompartment.of(showLineNumbers ? lineNumbers() : []),
    lineWrapCompartment.of(wrapExtension()),
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: TypeScript compiles with no errors; `dist/` is produced.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: add wrap-mode state and lineWrap compartment"
```

---

### Task 2: Apply wrap mode at runtime (column class + guide line CSS)

**Files:**
- Modify: `src/main.ts` (new `setWrapMode` function, near `toggleLineNumbers` at line 2253)
- Modify: `src/styles.css` (column max-width + guide line)

- [ ] **Step 1: Add the `setWrapMode` function**

In `src/main.ts`, just after `updateLineNumbersUI` (ends line 2266), add:

```ts
function setWrapMode(mode: WrapMode) {
  wrapMode = mode;
  localStorage.setItem("kaelio-wrap-mode", mode);
  editor.dispatch({
    effects: lineWrapCompartment.reconfigure(wrapExtension()),
  });
  applyWrapColumnStyle();
  updateWrapModeUI();
}

function applyWrapColumnStyle() {
  const wrapper = document.getElementById("editor-wrapper");
  if (!wrapper) return;
  wrapper.style.setProperty("--wrap-col", `${wrapColumn}ch`);
  wrapper.classList.toggle("wrap-column", wrapMode === "column");
}

function updateWrapModeUI() {
  const select = document.getElementById("wrap-mode-select") as HTMLSelectElement | null;
  if (select) select.value = wrapMode;
}
```

- [ ] **Step 2: Add the column + guide-line CSS**

In `src/styles.css`, append:

```css
/* Soft wrap: column mode constrains content width and shows a guide line */
#editor-wrapper.wrap-column .cm-content {
  max-width: var(--wrap-col, 80ch);
}
#editor-wrapper.wrap-column .cm-content::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--wrap-col, 80ch);
  width: 1px;
  background: var(--border, #45475a);
  opacity: 0.5;
  pointer-events: none;
}
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: compiles with no errors.

- [ ] **Step 4: Manual check**

Run: `npm run tauri dev`
Open a file with a very long line. In the browser/devtools console (or temporarily via Step 5 wiring), the styles aren't reachable from UI yet — instead temporarily call `setWrapMode("column")` from the devtools console.
Expected: content width caps at ~80 chars and a faint vertical line appears at column 80; `setWrapMode("window")` wraps at the pane edge; `setWrapMode("off")` restores horizontal scroll.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/styles.css
git commit -m "feat: apply wrap mode with column width and guide line"
```

---

### Task 3: View-menu "Soft Wrap" control + wiring + init

**Files:**
- Modify: `index.html:48-49` (View dropdown)
- Modify: `src/main.ts` (event wiring in the dropdown setup block, and init on startup)

- [ ] **Step 1: Add the Soft Wrap control to the View menu**

In `index.html`, replace the Line Numbers line + following divider (lines 48-49):

```html
              <div id="btn-toggle-linenumbers" class="dropdown-item">Line Numbers: <span id="linenumbers-label">On</span></div>
              <div class="dropdown-divider"></div>
```

with:

```html
              <div id="btn-toggle-linenumbers" class="dropdown-item">Line Numbers: <span id="linenumbers-label">On</span></div>
              <label class="dropdown-control" for="wrap-mode-select">
                <span>Soft Wrap</span>
                <select id="wrap-mode-select">
                  <option value="off">Off</option>
                  <option value="window">Window Width</option>
                  <option value="column">Column (80)</option>
                </select>
              </label>
              <div class="dropdown-divider"></div>
```

- [ ] **Step 2: Wire the select**

In `src/main.ts`, immediately after the `btn-toggle-linenumbers` click listener at line 5071, add:

```ts
  const wrapModeSelect = document.getElementById("wrap-mode-select") as HTMLSelectElement | null;
  if (wrapModeSelect) {
    wrapModeSelect.value = wrapMode;
    wrapModeSelect.addEventListener("change", () => setWrapMode(wrapModeSelect.value as WrapMode));
  }
```

- [ ] **Step 3: Apply the persisted wrap mode on startup**

In `src/main.ts`, at the startup init sequence, immediately after the `updateLineNumbersUI();` call at line 5501, add:

```ts
  applyWrapColumnStyle();
  updateWrapModeUI();
```

This ensures column-mode styling and the select value reflect the saved `wrapMode` on launch. (The compartment itself is already correct because `createEditorExtensions` reads `wrapMode` at construction time.)

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: compiles with no errors.

- [ ] **Step 5: Manual check (full feature)**

Run: `npm run tauri dev`, sidebar open (three panes), open a file with a very long line.
- View menu → Soft Wrap → "Window Width": long line wraps at pane edge.
- → "Column (80)": wraps at 80 chars, faint guide line at column 80.
- → "Off": horizontal scroll returns.
- Resize sidebar in Window Width mode: text reflows.
- Quit and relaunch: last-chosen mode persists and the select shows it.
- Toggle Line Numbers from both the menu and the sidebar icon: stay in sync (unchanged behavior).

Expected: all of the above hold.

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.ts
git commit -m "feat: add Soft Wrap control to View menu with persistence"
```

---

### Task 4: Docs

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md` (key bindings / View notes if relevant)

- [ ] **Step 1: Add a CHANGELOG entry**

Add under the current unreleased/next-version section in `CHANGELOG.md`:

```markdown
- Soft Wrap modes for the editor (Off / Window Width / Column 80 with guide line), in View → Soft Wrap. Persists across restarts.
```

- [ ] **Step 2: Note the feature in CLAUDE.md**

In `CLAUDE.md`, in the frontend View-modes/key-bindings area, add a brief mention that the editor supports soft-wrap modes (off/window/column) persisted in localStorage as `kaelio-wrap-mode`.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: document Soft Wrap feature"
```
