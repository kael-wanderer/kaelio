# Markdown Focus, Plan A: Quick Wins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six small, daily-impact fixes: conventional shortcuts, pasted images saved as files, highlighted code blocks with a copy button, a usable outline, split view restored on restart, and a reading-width control.

**Architecture:** New pure logic goes in `src/lib/<name>.ts` with `src/lib/<name>.test.ts` beside it, run by Node's built-in test runner. `src/main.ts` only wires those functions to the DOM, CodeMirror and Tauri. One new Rust command with unit tests in the existing `tests` module.

**Tech Stack:** TypeScript (vanilla), CodeMirror 6, markdown-it, highlight.js, Tauri 2, Rust.

**Spec:** `docs/superpowers/specs/2026-11-16-markdown-focus-design.md` (sections I1, I2, I4, I7, I8, A4). Mockup: `docs/design/2026-11-16-markdown-focus-mockup.html`.

## Global Constraints

- Line numbers in this plan were read on 2026-11-16 and drift as tasks land. Locate code by the function or symbol name given; the number is a hint.
- Everything written to `innerHTML` passes `escapeHtml` or `sanitizeHtmlString`.
- No change to `script-src` in `src-tauri/tauri.conf.json`.
- New npm packages: resolve the version with `npm view <pkg> version`, install with `npm install --save-exact`.
- Files in `src/lib/` use erasable TypeScript only (no `enum`, no parameter properties) and import siblings with the `.ts` extension, so Node can run them directly.
- Checks before every commit: `npm test`, `npx tsc --noEmit`, and for Rust changes `cd src-tauri && cargo test --lib`.
- Do not bump the app version. Add one line per task under `## Unreleased` in `CHANGELOG.md`.
- Commit after each task. Do not push.

## Review Focus

1. A user who had already rebound a shortcut to ⌘P or ⇧⌘F: their binding must keep working and the colliding new default must end up unbound, not silently doubled. (Task 1)
2. Pasting a file that claims `image/png` but is not a PNG: rejected, nothing written. (Task 2)
3. A code fence whose content contains `</code></pre><script>`: rendered as text, never as markup. (Task 3)
4. A `# heading`-looking line inside a fenced code block: not listed in the outline. (Task 4)
5. A session file whose `split` field is malformed or names files that no longer exist: app starts normally with the split closed. (Task 5)

---

### Task 1: Test harness and shortcut changes (spec I4)

**Files:**
- Modify: `package.json` (scripts, devDependencies)
- Create: `src/lib/keybindings.ts`, `src/lib/keybindings.test.ts`
- Modify: `src/main.ts` (`getDefaultBindings`, startup, `getCommands`), `src-tauri/src/lib.rs` (native menu accelerators), `index.html` (shortcut labels in menus and help)

**Interfaces:**
- Produces: `npm test` → `node --test "src/lib/**/*.test.ts"`.
- Produces: `migrateKeybindings(custom: Record<string, string>, defaults: { id: string; defaultKey: string }[]): Record<string, string>`

- [ ] **Step 1: Add the test script.** In `package.json` add `"test": "node --test \"src/lib/**/*.test.ts\""`. Install `@types/node` as an exact-pinned devDependency.

- [ ] **Step 2: Write the failing tests** in `src/lib/keybindings.test.ts` (use `node:test` and `node:assert/strict`):

```ts
const defaults = [
  { id: "search.file-search", defaultKey: "Mod-p" },
  { id: "search.content-search", defaultKey: "Mod-Shift-f" },
  { id: "view.toggle-preview", defaultKey: "Mod-Alt-p" },
];

test("no custom bindings: nothing changes", () => {
  assert.deepEqual(migrateKeybindings({}, defaults), {});
});

test("custom binding that collides with a new default unbinds that default", () => {
  // user had put Save-as-something on Mod-p before the defaults moved
  const out = migrateKeybindings({ "file.save": "Mod-p" }, [...defaults, { id: "file.save", defaultKey: "Mod-s" }]);
  assert.equal(out["file.save"], "Mod-p");
  assert.equal(out["search.file-search"], "");
});

test("collision check ignores case", () => {
  const out = migrateKeybindings({ "file.save": "mod-shift-F" }, [...defaults, { id: "file.save", defaultKey: "Mod-s" }]);
  assert.equal(out["search.content-search"], "");
});

test("an action the user customised itself is left alone", () => {
  const out = migrateKeybindings({ "search.file-search": "Mod-p" }, defaults);
  assert.deepEqual(out, { "search.file-search": "Mod-p" });
});

test("does not mutate its input", () => {
  const custom = { "file.save": "Mod-p" };
  migrateKeybindings(custom, [...defaults, { id: "file.save", defaultKey: "Mod-s" }]);
  assert.deepEqual(custom, { "file.save": "Mod-p" });
});
```

- [ ] **Step 3: Run** `npm test`. Expected: FAIL, `migrateKeybindings` not found.

- [ ] **Step 4: Implement `migrateKeybindings`** in `src/lib/keybindings.ts`. For each default whose id is not a key of `custom`: if any other id in `custom` holds a key equal (case-insensitive) to that default's `defaultKey`, set `result[default.id] = ""`.

- [ ] **Step 5: Run** `npm test`. Expected: PASS.

- [ ] **Step 6: Change the defaults** in `getDefaultBindings()` in `src/main.ts`:

| id | new `defaultKey` |
|---|---|
| `search.file-search` | `Mod-p` |
| `search.content-search` | `Mod-Shift-f` |
| `view.toggle-preview` | `Mod-Alt-p` |
| `view.toggle-outline` (new entry, label "Toggle Outline", group "View") | `Mod-Shift-o` |

Register `actions["view.toggle-outline"] = toggleOutline` where the other actions are assigned, and add `shortcut: sk("view.toggle-outline")` to the palette entry.

- [ ] **Step 7: Run the migration once at startup**, before the first `applyBindings()`: if `localStorage["kaelio-keybindings-migrated"] !== "2"`, store `migrateKeybindings(getCustomBindings(), getDefaultBindings())` under `kaelio-keybindings` and set the flag to `"2"`.

- [ ] **Step 8: Update visible labels.** In `src-tauri/src/lib.rs` the native menu item `view.preview` uses accelerator `CmdOrCtrl+P`; change it to `CmdOrCtrl+Alt+P`. Search that menu block for any accelerator on file search, content search or outline and bring it in line with the table. In `index.html` update the shortcut text shown in the View menu, the activity-bar tooltip for `#activity-preview` (both `data-tooltip` and `aria-label`), and the Keyboard Shortcuts help content.

- [ ] **Step 9: Verify.** `npx tsc --noEmit` and `cd src-tauri && cargo test --lib` pass. In `npm run tauri dev`: ⌘P opens file search, ⇧⌘F opens search in files, ⌥⌘P toggles the preview, ⇧⌘O toggles the outline.

- [ ] **Step 10: Commit** `feat: conventional shortcuts for quick open, search and outline`.

---

### Task 2: Pasted images saved to `assets/` (spec I1)

**Files:**
- Modify: `src-tauri/src/lib.rs` (new command, register in `generate_handler!`, tests)
- Modify: `src/main.ts` (`handleImagePaste` and its listener)

**Interfaces:**
- Produces (Rust): `save_pasted_image(note_path: String, data_base64: String, mime: String, stamp: String) -> Result<String, String>`; returns the path relative to the note's folder, always with `/` separators, e.g. `assets/pasted-20261116-073501.png`.
- Produces (Rust, testable core): `fn save_pasted_image_impl(note_path: &Path, bytes: &[u8], mime: &str, stamp: &str) -> Result<String, String>`

Rules the implementation must enforce:

| Rule | Value |
|---|---|
| Allowed mime → extension | `image/png`→`png`, `image/jpeg`→`jpg`, `image/gif`→`gif`, `image/webp`→`webp` |
| Magic bytes must match the mime | PNG `89 50 4E 47`; JPEG `FF D8 FF`; GIF `GIF8`; WEBP `RIFF` at 0 and `WEBP` at 8 |
| Max decoded size | 20 MB (`20 * 1024 * 1024`), larger is rejected |
| `stamp` format | exactly 8 digits, `-`, 6 digits; anything else rejected |
| `note_path` | must be an existing regular file |
| Target | `<note folder>/assets/pasted-<stamp>.<ext>`; on collision `pasted-<stamp>-2.<ext>`, `-3`, … |
| Write | open with `create_new(true)`; never overwrite |
| Error text | short and generic ("Unsupported image type", "Image too large", "Invalid image data", "Save the note first"); no absolute paths in messages |

- [ ] **Step 1: Write the failing Rust tests** in the `tests` module (use a temp dir the way the existing `write_atomic_*` tests do). `PNG` below is the 8-byte PNG signature followed by a few bytes.

```rust
#[test] fn pasted_image_is_written_under_assets_and_returns_relative_path()
// note.md in tmp; call impl(note, PNG, "image/png", "20261116-073501")
// assert Ok("assets/pasted-20261116-073501.png"); file exists with same bytes

#[test] fn pasted_image_collision_gets_numeric_suffix()
// call twice with the same stamp; second returns "assets/pasted-20261116-073501-2.png"; first file unchanged

#[test] fn pasted_image_rejects_unlisted_mime()
// "image/svg+xml" -> Err; assets/ dir not created

#[test] fn pasted_image_rejects_bytes_that_do_not_match_mime()
// b"<html>" with "image/png" -> Err; nothing written

#[test] fn pasted_image_rejects_oversize()
// 20 MB + 1 byte starting with the PNG signature -> Err

#[test] fn pasted_image_rejects_bad_stamp()
// "../../x" and "2026" -> Err

#[test] fn pasted_image_rejects_missing_note()
// note path that does not exist -> Err
```

- [ ] **Step 2: Run** `cd src-tauri && cargo test --lib pasted_image`. Expected: FAIL to compile, function not found.

- [ ] **Step 3: Implement** `save_pasted_image_impl` and the `#[tauri::command] save_pasted_image` wrapper (decode base64 with the existing `general_purpose::STANDARD`, then call the impl). Add `save_pasted_image` to `generate_handler!`.

- [ ] **Step 4: Run** `cargo test --lib`. Expected: all PASS.

- [ ] **Step 5: Rewire `handleImagePaste`** in `src/main.ts`:
  - Change the signature to `handleImagePaste(e: ClipboardEvent, view: EditorView, notePath: string | null)`. Register it on `editor.dom` with `currentFilePath` and on `editorSub.dom` with `subFilePath` (read the path at event time, not at registration).
  - If `notePath` is null: keep `flashStatus("Save file first to paste images", "var(--warning)")`.
  - Read the blob as a data URL, take the base64 part with the existing `dataUrlBase64`, build `stamp` from local time as `YYYYMMDD-HHMMSS`, call `invoke<string>("save_pasted_image", { notePath, dataBase64, mime: blob.type, stamp })`.
  - On success insert `![](${rel})\n` at the cursor of `view`, and flash "Image saved to assets/".
  - On error flash the returned message in `var(--error)`. Insert nothing.
  - Delete the old data-URL insertion.

- [ ] **Step 6: Verify** in `npm run tauri dev`: take a screenshot to the clipboard, paste into a saved note. `assets/pasted-….png` exists beside the note, the link is relative, the preview shows the image. Paste into an untitled note shows the warning.

- [ ] **Step 7: Commit** `fix: save pasted images to assets/ instead of inlining base64`.

---

### Task 3: Code highlighting and copy button (spec I2)

**Files:**
- Modify: `package.json` (`highlight.js`, exact pin)
- Create: `src/lib/highlight.ts`, `src/lib/highlight.test.ts`
- Modify: `src/main.ts` (markdown-it options, preview pipeline, click handlers, export/copy cleanup), `src/styles.css`

**Interfaces:**
- Produces: `highlightCode(code: string, lang: string): string` — highlighted HTML, or `""` to tell markdown-it to escape the code itself.
- Produces (in `main.ts`): `addCodeCopyButtons(html: string): string`

- [ ] **Step 1: Install** `highlight.js` exact-pinned.

- [ ] **Step 2: Write the failing tests** in `src/lib/highlight.test.ts`:

```ts
test("known language is highlighted", () => {
  assert.match(highlightCode("const a = 1;", "js"), /hljs-keyword/);
});
test("language name is case-insensitive", () => {
  assert.match(highlightCode("const a = 1;", "JS"), /hljs-keyword/);
});
test("unknown language returns empty string", () => {
  assert.equal(highlightCode("whatever", "not-a-language"), "");
});
test("missing language returns empty string", () => {
  assert.equal(highlightCode("whatever", ""), "");
});
test("mermaid is never highlighted", () => {
  assert.equal(highlightCode("graph TD; A-->B", "mermaid"), "");
});
test("markup inside code is escaped", () => {
  const out = highlightCode("</code></pre><script>alert(1)</script>", "html");
  assert.ok(!out.includes("<script>"));
  assert.ok(!out.includes("</pre>"));
});
```

- [ ] **Step 3: Run** `npm test`. Expected: FAIL.

- [ ] **Step 4: Implement `highlightCode`** with `import hljs from "highlight.js/lib/common"`: return `""` for empty lang, `mermaid`, or `!hljs.getLanguage(lang)`; otherwise `hljs.highlight(code, { language: lang, ignoreIllegals: true }).value`. No auto-detection.

- [ ] **Step 5: Run** `npm test`. Expected: PASS.

- [ ] **Step 6: Wire into markdown-it.** In `src/main.ts`, pass `highlight: highlightCode` in the `new MarkdownIt({...})` options. Confirm `processMermaidBlocks` still finds `pre > code.language-mermaid` (it will, because `highlightCode` returns `""` for mermaid).

- [ ] **Step 7: Add `addCodeCopyButtons(html)`** next to `processMermaidBlocks`, using the same `<template>` technique: wrap every `pre` that has a direct `code` child in `<div class="code-block">` and append `<button class="code-copy" type="button">Copy</button>` inside the wrapper. Call it right after `processMermaidBlocks` and before `sanitizeHtmlString`, in both the main preview pipeline and `renderMarkdownPreviewHtml` (used by the sub pane).

- [ ] **Step 8: Handle the click** by delegation, beside the existing `.heading-copy-link` handler: on `.code-copy`, copy `wrapper.querySelector("code").textContent` to the clipboard, set the button text to "Copied" and class `done`, restore after 1500 ms. Make the sub-pane preview handle it too.

- [ ] **Step 9: Keep it out of exports.** Remove `.code-copy` elements from the cloned node in `preparePreviewCaptureNode` and from the HTML built by `copyFormattedHTML`.

- [ ] **Step 10: Style** in `src/styles.css`, matching the mockup section "I2": `.code-block { position: relative }`; `.code-copy` absolute top-right, `opacity: 0`, shown on `.code-block:hover` and on `:focus-visible`; `.done` uses `var(--success)`. Add `.hljs-*` token colours through CSS variables (`--hl-keyword`, `--hl-string`, `--hl-number`, `--hl-comment`, `--hl-function`, `--hl-title`) defined for the default dark palette and overridden in each existing theme block, including the light theme. Do not import a stock highlight.js stylesheet.

- [ ] **Step 11: Verify** in `npm run tauri dev` with a note containing `js`, `rust`, an unknown-language fence and a `mermaid` fence: colours show in every theme, Copy works, the diagram still renders, scroll sync and click-to-cursor still work on code blocks, PNG export shows no button.

- [ ] **Step 12: Commit** `feat: syntax highlighting and copy button for code blocks`.

---

### Task 4: Outline that works in Reading View (spec I7)

**Files:**
- Create: `src/lib/outline.ts`, `src/lib/outline.test.ts`
- Modify: `src/main.ts` (`updateOutline`, preview scroll listener), `src/styles.css`

**Interfaces:**
- Produces: `interface Heading { level: number; text: string; line: number }` (`line` is 1-based, as today)
- Produces: `extractHeadings(content: string): Heading[]`
- Produces: `activeHeadingIndex(headingLines: number[], topLine: number): number`

- [ ] **Step 1: Write the failing tests:**

```ts
test("ATX headings with level, text and 1-based line", () => {
  assert.deepEqual(extractHeadings("# A\n\ntext\n## B"), [
    { level: 1, text: "A", line: 1 }, { level: 2, text: "B", line: 4 },
  ]);
});
test("headings inside fenced code are ignored", () => {
  assert.deepEqual(extractHeadings("```sh\n# not a heading\n```\n# Real"), [{ level: 1, text: "Real", line: 4 }]);
});
test("tilde fences are fences too", () => {
  assert.deepEqual(extractHeadings("~~~\n# no\n~~~"), []);
});
test("hash without a space is not a heading", () => {
  assert.deepEqual(extractHeadings("#tag"), []);
});
test("active heading is the last one at or above the top line", () => {
  assert.equal(activeHeadingIndex([1, 10, 30], 12), 1);
  assert.equal(activeHeadingIndex([1, 10, 30], 10), 1);
});
test("no heading above the top line gives -1", () => {
  assert.equal(activeHeadingIndex([5, 10], 2), -1);
  assert.equal(activeHeadingIndex([], 2), -1);
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** both functions in `src/lib/outline.ts`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Use them in `updateOutline`.** Replace the inline regex loop with `extractHeadings(content)`.

- [ ] **Step 6: Click behaviour.** When `currentViewMode === "preview"`, a click scrolls the preview so the element with `data-source-line="${line - 1}"` is at the top (same lookup the scroll-sync code uses), and does not focus the editor. In other modes keep today's editor jump.

- [ ] **Step 7: Active entry.** On preview scroll (preview mode) and editor scroll (other modes), throttled with `requestAnimationFrame`, compute the top visible source line, call `activeHeadingIndex`, and toggle class `active` on the matching `.outline-item`. Style `.outline-item.active` as in the mockup section "I7": accent left border, text in `var(--text)`.

- [ ] **Step 8: Verify** in dev: outline entries ignore `#` lines in code fences; in Reading View a click scrolls the preview; the active entry follows scrolling.

- [ ] **Step 9: Commit** `feat: outline works in reading view and tracks the visible heading`.

---

### Task 5: Split view restored on restart (spec I8)

**Files:**
- Create: `src/lib/session.ts`, `src/lib/session.test.ts`
- Modify: `src/main.ts` (`SessionData`, `persistOpenTabs`, the restore path that reads `load_session`)

**Interfaces:**
- Produces: `interface SplitSession { open: boolean; mode: "edit" | "preview"; tabs: { filePath: string; isActive: boolean }[] }`
- Produces: `parseSplitSession(raw: unknown): SplitSession | null`

- [ ] **Step 1: Write the failing tests:**

```ts
test("valid split session is returned", () => {
  const raw = { open: true, mode: "edit", tabs: [{ filePath: "/a.md", isActive: true }] };
  assert.deepEqual(parseSplitSession(raw), raw);
});
test("missing or wrong-typed input gives null", () => {
  for (const bad of [undefined, null, 7, "x", [], { open: "yes" }, { open: true, mode: "edit", tabs: "no" }])
    assert.equal(parseSplitSession(bad), null);
});
test("unknown mode falls back to preview", () => {
  assert.equal(parseSplitSession({ open: true, mode: "weird", tabs: [] })?.mode, "preview");
});
test("tabs without a string filePath are dropped", () => {
  const out = parseSplitSession({ open: true, mode: "edit", tabs: [{ filePath: 5 }, { filePath: "/a.md" }] });
  assert.deepEqual(out?.tabs, [{ filePath: "/a.md", isActive: false }]);
});
test("at most one tab is active; the first active wins", () => {
  const out = parseSplitSession({ open: true, mode: "edit",
    tabs: [{ filePath: "/a.md", isActive: true }, { filePath: "/b.md", isActive: true }] });
  assert.deepEqual(out?.tabs.map(t => t.isActive), [true, false]);
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `parseSplitSession`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Save.** Add `split?: SplitSession` to `SessionData`. In `persistOpenTabs`, set it from `splitOpen`, `subMode`, `subTabs` (skip tabs with a null `filePath`) and `subActiveTabId`.

- [ ] **Step 6: Restore.** After the main tabs are restored, run `parseSplitSession(sessionData.split)`. If it is non-null and `open`, open each tab with `openInSubPane(path)` in order, skipping any that fails to open, then activate the saved active tab and apply `mode`. If no tab opened, leave the split closed. Honour the existing `restoreLastSession` setting: when it is off, do nothing.

- [ ] **Step 7: Verify** in dev: open two files in the split, set the sub pane to edit mode, quit, relaunch: both come back. Delete one file while the app is closed, relaunch: the other comes back, no error dialog.

- [ ] **Step 8: Commit** `feat: restore split view on launch`.

---

### Task 6: Reading width (spec A4)

**Files:**
- Create: `src/lib/reading-width.ts`, `src/lib/reading-width.test.ts`
- Modify: `src/main.ts` (state, `setViewMode`, palette, native menu handler), `index.html` (View menu), `src-tauri/src/lib.rs` (native View menu), `src/styles.css`

**Interfaces:**
- Produces: `type ReadingWidth = "narrow" | "medium" | "wide" | "full"`
- Produces: `parseReadingWidth(raw: string | null): ReadingWidth` (default `"medium"`)
- Produces: `readingWidthCss(w: ReadingWidth): string` → `"60ch"`, `"75ch"`, `"90ch"`, `"none"`

- [ ] **Step 1: Write the failing tests:**

```ts
test("stored values round-trip", () => {
  for (const w of ["narrow", "medium", "wide", "full"]) assert.equal(parseReadingWidth(w), w);
});
test("missing or unknown value is medium", () => {
  assert.equal(parseReadingWidth(null), "medium");
  assert.equal(parseReadingWidth("huge"), "medium");
});
test("css values", () => {
  assert.deepEqual(["narrow", "medium", "wide", "full"].map(w => readingWidthCss(w as ReadingWidth)),
    ["60ch", "75ch", "90ch", "none"]);
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: State and apply.** In `main.ts`: `let readingWidth = parseReadingWidth(localStorage.getItem("kaelio-reading-width"))`; `setReadingWidth(w)` stores it and sets the CSS variable `--reading-width` on `document.documentElement`. In `setViewMode`, toggle class `reading-view` on `#preview-pane` when `mode === "preview"`.

- [ ] **Step 6: CSS.** `#preview-pane.reading-view > *` gets `max-width: var(--reading-width); margin-left: auto; margin-right: auto`. Exclude the preview kinds that must stay full width: `.html-preview-frame` and `.plain-text-preview`. Confirm `.table-scroll` and `.mermaid` scroll horizontally inside the column instead of overflowing it.

- [ ] **Step 7: Menus.** Add a "Reading Width" submenu (Narrow, Medium, Wide, Full) to the View menu in `index.html`, the same four items to the native View menu in `lib.rs` with ids `view.reading-width.narrow|medium|wide|full`, cases in `handleNativeMenuCommand`, and one palette command "Cycle Reading Width". Show a check mark on the current value the same way Soft Wrap does.

- [ ] **Step 8: Verify** in dev on a wide window: Reading View centres the text at each width; split view is unaffected; an HTML file in Reading View still fills the pane; PNG export is still full-width content (it uses its own capture node; confirm the class does not leak into it).

- [ ] **Step 9: Commit** `feat: reading width control for reading view`.

---

## Done when

- `npm test`, `npx tsc --noEmit`, `cd src-tauri && cargo test --lib` and `npm run build` all pass.
- `CHANGELOG.md` has six new lines under Unreleased.
- `README.md` shortcut table matches Task 1.
