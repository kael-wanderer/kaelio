# Split View — Phase 2 (Editable Sub Pane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the right (sub) pane a real editor: a second CodeMirror instance (`editorSub`), its own tab bar, an edit/preview mode toggle, and per-pane save/dirty/focus routing — building on the Phase 1 read-only scaffold.

**Architecture:** Two explicit editors (`editor` = main, `editorSub` = sub), NOT a generic pane system (capped at 2 panes). The sub pane reuses the `Tab` interface and `read_file`/`save_file`/`showConfirmDialog`/`gitAutoSync` helpers. The sub editor gets its OWN extensions (a sub-specific update listener that marks the active sub tab dirty — it must NOT call the main `onContentChange`/`updatePreview`/`updateCursorPosition`, which target the main editor/preview). `activePane` ("main" | "sub") tracks focus so Cmd+S saves the right file. The sub editor uses static (non-compartment) display config read at creation time; it does not live-update when line-number/wrap/theme settings change (acceptable for v1).

**Tech Stack:** Tauri 2, vanilla TypeScript, CodeMirror 6, markdown-it.

**Build constraint:** `tsconfig.json` has `noUnusedLocals`/`noUnusedParameters: true`. Because the new symbols are interdependent, intermediate builds may fail on temporarily-unused symbols. Implement the whole phase, committing at the marked checkpoints; **only the FINAL `npm run build` must pass cleanly.** No test framework — verification is build + manual checks.

**Existing symbols to reuse (already defined in src/main.ts):** `Tab` (interface, line 52), `EditorView`, `EditorState`, `createEditorExtensions`, `lineNumbers`, `showLineNumbers`, `EditorView.lineWrapping`, `wrapMode`, `highlightActiveLine`, `highlightActiveLineGutter`, `history`, `bracketMatching`, `closeBrackets`, `foldGutter`, `syntaxHighlighting`, `defaultHighlightStyle`, `markdown`, `markdownLanguage`, `languages`, `search`, `oneDark`, `editorLightTheme`, `getEffectiveTheme`, `editorTypographyTheme`, `editorFillTheme`, `keymap`, `defaultKeymap`, `historyKeymap`, `searchKeymap`, `foldKeymap`, `indentWithTab`, `buildKeymap`, `invoke`, `flashStatus`, `escapeHtml`, `renderSubPreview` (Phase 1), `setSplit`/`splitOpen`/`subFilePath` (Phase 1), `showConfirmDialog`, `autoSyncEnabled`, `currentFolderPath`, `gitAutoSync`.

---

### Task 1: DOM + CSS for sub editor mount, sub tabs container, mode button

**Files:**
- Modify: `index.html` (the `#sub-pane-wrapper` block added in Phase 1, ~lines 231-234)
- Modify: `src/styles.css` (append)

- [ ] **Step 1: Update the sub pane markup**

Replace the Phase 1 sub pane block in `index.html`:
```html
        <div id="sub-pane-wrapper" class="hidden">
          <div id="sub-tab-bar"></div>
          <div id="sub-pane"></div>
        </div>
```
with:
```html
        <div id="sub-pane-wrapper" class="hidden">
          <div id="sub-tab-bar">
            <div id="sub-tabs"></div>
            <button id="btn-sub-mode" title="Toggle edit / preview">✎</button>
          </div>
          <div id="sub-editor-pane" class="hidden"></div>
          <div id="sub-pane"></div>
        </div>
```

- [ ] **Step 2: Append CSS**

Append to `src/styles.css`:
```css
/* Split view — Phase 2 (editable sub pane) */
#sub-tab-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border, #45475a);
}
#sub-tabs { display: flex; overflow-x: auto; }
#btn-sub-mode {
  flex: 0 0 auto;
  background: none;
  border: none;
  color: var(--fg, #cdd6f4);
  cursor: pointer;
  padding: 4px 8px;
}
#sub-editor-pane {
  flex: 1 1 auto;
  overflow: hidden;
  min-height: 0;
}
#sub-editor-pane.hidden { display: none; }
#sub-editor-pane .cm-editor { height: 100%; }
.sub-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-right: 1px solid var(--border, #45475a);
  cursor: pointer;
  white-space: nowrap;
}
.sub-tab.active { background: var(--bg-alt, #313244); }
.sub-tab-close { opacity: 0.6; }
.sub-tab-close:hover { opacity: 1; }
```

- [ ] **Step 3: Build check** — `npm run build` (expect: passes; HTML/CSS only).
- [ ] **Step 4: Commit** — `git add index.html src/styles.css && git commit -m "feat(split): DOM and CSS for editable sub pane"`

---

### Task 2: Sub editor infrastructure (state, extensions, tab factory, lazy editor)

**Files:**
- Modify: `src/main.ts` (state near line 72 where `splitOpen`/`subFilePath` live; functions near `createEditorExtensions`/`createTab` ~line 3655)

- [ ] **Step 1: Add Phase 2 state**

Next to the Phase 1 state (`let splitOpen = false;` / `let subFilePath ...`), add:
```ts
let editorSub: EditorView | null = null;
let subTabs: Tab[] = [];
let subActiveTabId: string | null = null;
let subMode: "edit" | "preview" = "preview";
let activePane: "main" | "sub" = "main";
```

- [ ] **Step 2: Sub editor extensions + sub tab factory + lazy creator + helpers**

After `createTab` (ends ~line 3698), add:
```ts
function createSubEditorExtensions() {
  return [
    showLineNumbers ? lineNumbers() : [],
    wrapMode === "off" ? [] : EditorView.lineWrapping,
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    bracketMatching(),
    closeBrackets(),
    foldGutter(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    search(),
    getEffectiveTheme() === "dark" ? oneDark : editorLightTheme,
    editorTypographyTheme(),
    editorFillTheme,
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
    keymap.of(buildKeymap()),
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged) return;
      const tab = subTabs.find(t => t.id === subActiveTabId);
      if (tab && !tab.isModified) { tab.isModified = true; renderSubTabs(); }
    }),
  ];
}

function createSubTab(filePath: string | null, content: string): Tab {
  return {
    id: crypto.randomUUID(),
    filePath,
    title: filePath ? filePath.split("/").pop()! : "Untitled",
    editorState: EditorState.create({ doc: content, extensions: createSubEditorExtensions() }),
    scrollTop: 0,
    previewScrollTop: 0,
    isModified: false,
  };
}

function getActiveSubTab(): Tab | null {
  return subTabs.find(t => t.id === subActiveTabId) ?? null;
}

function ensureSubEditor(): EditorView {
  if (editorSub) return editorSub;
  const parent = document.getElementById("sub-editor-pane")!;
  const active = getActiveSubTab();
  editorSub = new EditorView({
    state: active ? active.editorState : EditorState.create({ doc: "", extensions: createSubEditorExtensions() }),
    parent,
  });
  editorSub.dom.addEventListener("focusin", () => { activePane = "sub"; });
  return editorSub;
}

function saveActiveSubTabState() {
  const tab = getActiveSubTab();
  if (!tab || !editorSub) return;
  tab.editorState = editorSub.state;
}
```

- [ ] **Step 3: Track main-pane focus**

In the editor-creation block (after `editor = new EditorView({ ... })` at ~line 5043), add:
```ts
  editor.dom.addEventListener("focusin", () => { activePane = "main"; });
```

- [ ] **Step 4: Build check**

`npm run build` — at this checkpoint it is EXPECTED to fail with `noUnusedLocals`/`noUnusedParameters` errors (e.g. `renderSubTabs` not yet defined will error as "cannot find name", and several symbols unused). That is fine; do NOT add suppressions. Proceed to Task 3. (If you prefer a clean checkpoint, you may defer the commit until Task 4 — see commit note below.)

- [ ] **Step 5: Commit (deferred-OK)**

If the build is clean, commit now: `git add src/main.ts && git commit -m "feat(split): sub editor extensions, tab factory, focus tracking"`. If it fails only due to symbols defined in Task 3, continue and make this commit together with Task 3's.

---

### Task 3: Sub tabs — render, switch, close, and reworked openInSubPane

**Files:**
- Modify: `src/main.ts` (near the Phase 1 `openInSubPane`/`setSplit` functions, ~line 1164)

- [ ] **Step 1: Add sub-tab UI + navigation functions**

Add near the Phase 1 split functions:
```ts
function renderSubTabs() {
  const container = document.getElementById("sub-tabs");
  if (!container) return;
  container.innerHTML = subTabs.map(tab => {
    const activeClass = tab.id === subActiveTabId ? " active" : "";
    const dot = tab.isModified ? ' <span class="tab-modified">●</span>' : "";
    return `<div class="sub-tab${activeClass}" data-sub-tab-id="${tab.id}">
      <span class="sub-tab-title">${escapeHtml(tab.title)}</span>${dot}
      <span class="sub-tab-close" data-sub-tab-id="${tab.id}">✕</span>
    </div>`;
  }).join("");
  container.querySelectorAll(".sub-tab").forEach(el => {
    const id = (el as HTMLElement).dataset.subTabId!;
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("sub-tab-close")) return;
      switchSubTab(id);
    });
  });
  container.querySelectorAll(".sub-tab-close").forEach(el => {
    const id = (el as HTMLElement).dataset.subTabId!;
    el.addEventListener("click", (e) => { e.stopPropagation(); closeSubTab(id); });
  });
}

function renderActiveSubTab() {
  const tab = getActiveSubTab();
  if (!tab) return;
  subFilePath = tab.filePath;
  if (subMode === "edit") {
    const view = ensureSubEditor();
    view.setState(tab.editorState);
  } else {
    renderSubPreview(tab.editorState.doc.toString());
  }
}

function switchSubTab(id: string) {
  if (id === subActiveTabId) return;
  if (subMode === "edit") saveActiveSubTabState();
  subActiveTabId = id;
  renderActiveSubTab();
  renderSubTabs();
}

async function closeSubTab(id: string) {
  const tab = subTabs.find(t => t.id === id);
  if (!tab) return;
  if (tab.isModified) {
    if (id !== subActiveTabId) { subActiveTabId = id; renderActiveSubTab(); }
    const shouldSave = await showConfirmDialog(`Save changes to ${tab.title}? (Y/N)`);
    if (shouldSave) await saveSubFile();
  }
  const idx = subTabs.findIndex(t => t.id === id);
  subTabs.splice(idx, 1);
  if (subTabs.length === 0) {
    subActiveTabId = null;
    subFilePath = null;
    setSplit(false);
    renderSubTabs();
    return;
  }
  if (id === subActiveTabId) {
    subActiveTabId = subTabs[Math.min(idx, subTabs.length - 1)].id;
    renderActiveSubTab();
  }
  renderSubTabs();
}
```

- [ ] **Step 2: Rework `openInSubPane` (Phase 1 version) to use sub tabs**

Replace the Phase 1 `openInSubPane` body with:
```ts
async function openInSubPane(path: string) {
  const existing = subTabs.find(t => t.filePath === path);
  if (existing) {
    subActiveTabId = existing.id;
    setSplit(true);
    renderActiveSubTab();
    renderSubTabs();
    return;
  }
  try {
    const result = await invoke<{ path: string; content: string }>("read_file", { path });
    const tab = createSubTab(result.path, result.content);
    subTabs.push(tab);
    subActiveTabId = tab.id;
    setSplit(true);
    renderActiveSubTab();
    renderSubTabs();
  } catch (e) {
    flashStatus(`Could not open: ${path}`, "var(--red, #f38ba8)");
  }
}
```

- [ ] **Step 3: Build check** — expected still failing on `setSubMode`/`saveSubFile` (defined in Tasks 4-5). Continue.

---

### Task 4: Mode toggle (edit ↔ preview)

**Files:**
- Modify: `src/main.ts` (near the functions above)
- Modify: `src/main.ts` wiring (DOMContentLoaded button setup)

- [ ] **Step 1: Add mode functions**

```ts
function updateSubModeIcon() {
  const btn = document.getElementById("btn-sub-mode");
  if (btn) btn.textContent = subMode === "edit" ? "👁" : "✎";
}

function setSubMode(mode: "edit" | "preview") {
  const editPane = document.getElementById("sub-editor-pane");
  const prevPane = document.getElementById("sub-pane");
  if (mode === "edit") {
    subMode = "edit";
    const view = ensureSubEditor();
    const tab = getActiveSubTab();
    if (tab) view.setState(tab.editorState);
    editPane?.classList.remove("hidden");
    prevPane?.classList.add("hidden");
    view.focus();
    activePane = "sub";
  } else {
    if (subMode === "edit") saveActiveSubTabState();
    subMode = "preview";
    const tab = getActiveSubTab();
    if (tab) renderSubPreview(tab.editorState.doc.toString());
    prevPane?.classList.remove("hidden");
    editPane?.classList.add("hidden");
  }
  updateSubModeIcon();
}

function toggleSubMode() {
  setSubMode(subMode === "edit" ? "preview" : "edit");
}
```

- [ ] **Step 2: Wire the mode button**

Near the Phase 1 `btn-split` wiring (search `getElementById("btn-split")`), add:
```ts
  document.getElementById("btn-sub-mode")?.addEventListener("click", () => toggleSubMode());
```

- [ ] **Step 3: Build check** — expected still failing on `saveSubFile` until Task 5. Continue.

---

### Task 5: Per-pane save routing

**Files:**
- Modify: `src/main.ts` (near `saveFile`, ~line 1517)

- [ ] **Step 1: Add `saveSubFile` and `saveActivePane`**

After `saveFile` (ends ~line 1556), add:
```ts
async function saveSubFile() {
  const tab = getActiveSubTab();
  if (!tab) return;
  if (subMode === "edit") saveActiveSubTabState();
  if (!tab.filePath) { flashStatus("Sub pane file has no path.", "var(--warning)"); return; }
  const content = tab.editorState.doc.toString();
  try {
    await invoke("save_file", { path: tab.filePath, content });
    tab.isModified = false;
    renderSubTabs();
    if (subMode === "preview") renderSubPreview(content);
    if (autoSyncEnabled && currentFolderPath) gitAutoSync(tab.filePath);
  } catch (e) {
    console.error("Sub save failed:", e);
  }
}

function saveActivePane() {
  if (activePane === "sub" && splitOpen) { saveSubFile(); return; }
  saveFile();
}
```

- [ ] **Step 2: Route Cmd+S and the Save menu through `saveActivePane`**

Reroute exactly these four user-facing save entry points from `saveFile` to `saveActivePane` (verified line numbers):
- `src/main.ts:4789` — `actions["file.save"] = () => saveFile();` → `actions["file.save"] = () => saveActivePane();`
- `src/main.ts:4810` — `case "file.save": return saveFile();` → `case "file.save": return saveActivePane();`
- `src/main.ts:3183` — the menu item `{ label: "Save", shortcut: sk("file.save"), action: saveFile }` → `action: saveActivePane`
- `src/main.ts:5134` — `getElementById("btn-save")?.addEventListener("click", () => saveFile());` → `() => saveActivePane()`

Leave these as `saveFile` (NOT user-initiated pane save): `src/main.ts:1695` (autosave — main only) and `src/main.ts:3815` (closeTab unsaved-save — main tabs). The internal `saveFile()` / `saveSubFile()` functions stay intact; only the four entry points above change.

- [ ] **Step 3: Build check**

`npm run build` — this should now pass; all symbols are defined and referenced. Fix any remaining type errors. **This is the build that must be clean.**

- [ ] **Step 4: Commit Tasks 2-5 together**

```bash
git add src/main.ts index.html
git commit -m "feat(split): editable sub pane with tabs, mode toggle, and save routing"
```
(If you already committed Task 2 separately and it built clean, just commit the remaining work here.)

---

### Task 6: Close-split unsaved guard

**Files:**
- Modify: `src/main.ts` (the Phase 1 `toggleSplit`, ~line 1185)

- [ ] **Step 1: Guard split-off when sub tabs are dirty**

Replace the Phase 1 `toggleSplit` with:
```ts
async function toggleSplit() {
  if (!splitOpen) {
    if (subTabs.length === 0 && currentFilePath) { await openInSubPane(currentFilePath); return; }
    setSplit(true);
    renderSubTabs();
    return;
  }
  // Turning split OFF — guard unsaved sub tabs
  const dirty = subTabs.filter(t => t.isModified);
  if (dirty.length > 0) {
    const shouldSave = await showConfirmDialog(`Save ${dirty.length} unsaved sub-pane file(s)? (Y/N)`);
    if (shouldSave) {
      for (const t of dirty) { subActiveTabId = t.id; if (subMode === "edit") saveActiveSubTabState(); await saveSubFile(); }
    }
  }
  setSplit(false);
}
```

- [ ] **Step 2: Build check** — `npm run build` (expect: clean).
- [ ] **Step 3: Manual check**

Run `npm run tauri dev`:
- Open a file in the sub pane (Phase 1 split toggle, or once Phase 3 lands, right-click). Click the mode icon (✎/👁): the right pane switches between an editable editor and a rendered preview; the icon flips.
- Type in the sub editor: the sub tab shows a modified dot.
- With focus in the sub editor, Cmd+S saves the sub file (dot clears); with focus in the main editor, Cmd+S saves the main file. Verify on disk.
- Open a second file in the sub pane: a second sub tab appears; clicking switches; ✕ closes (prompts if unsaved).
- Toggle split off with an unsaved sub tab: prompted to save.
- Main editor + preview behave exactly as before throughout.

- [ ] **Step 4: Commit** — `git add src/main.ts && git commit -m "feat(split): unsaved-changes guard when closing split"`

---

### Task 7: Docs

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update the Phase 1 CHANGELOG line**

Replace the Phase 1 split line in `CHANGELOG.md` with:
```markdown
- Split view: toggle a second pane (⊟ next to zoom) beside the editor. The sub pane is a full editor with its own tabs and an edit/preview toggle (✎/👁); Cmd+S saves whichever pane has focus. Open files into it via right-click (see below). Draggable divider.
```

- [ ] **Step 2: Commit** — `git add CHANGELOG.md && git commit -m "docs(split): document editable sub pane (Phase 2)"`
