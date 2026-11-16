# Markdown Focus, Plan C: New Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one merged history list, smart paste, table editing, a changed-since-reload highlight, and opt-in scripts for HTML view.

**Architecture:** Each feature's decision logic is a pure module in `src/lib/` with tests; `src/main.ts` connects it to CodeMirror, the preview DOM and Tauri. Scripts in HTML view run in a sandboxed frame served from a dedicated Tauri URI scheme with its own CSP, gated by a spike that proves isolation before anything is built on it.

**Tech Stack:** TypeScript (vanilla), CodeMirror 6, turndown, Tauri 2, Rust.

**Spec:** `docs/superpowers/specs/2026-11-16-markdown-focus-design.md` (sections I3, I5, A1, A2, A3). Mockup: `docs/design/2026-11-16-markdown-focus-mockup.html`.

**Depends on:** Plan A (test harness, shortcut registry changes) and Plan B (`fileKind`, removed viewers).

## Global Constraints

- Line numbers were read on 2026-11-16 and drift. Locate code by symbol name.
- Everything written to `innerHTML` passes `escapeHtml` or `sanitizeHtmlString`.
- `script-src` in `src-tauri/tauri.conf.json` is not changed. Task 5 may add to `frame-src` only.
- A frame that runs scripts never has `allow-same-origin`.
- New npm and Cargo packages: official registry, exact version pin.
- `src/lib/` files use erasable TypeScript and `.ts` import extensions.
- Checks before every commit: `npm test`, `npx tsc --noEmit`, `cd src-tauri && cargo test --lib`, `npm run build`.
- One line per task under `## Unreleased` in `CHANGELOG.md`, and update the matching `docs/guide/` page named in each task; `npm run guide:check` must pass. Commit after each task. Do not push.

## Review Focus

1. Text copied from VS Code or a terminal (HTML made only of styled `div`/`span`): pasted as plain text, indentation intact. (Task 2)
2. Rich paste with the cursor inside a fenced code block: plain text, no Markdown conversion. (Task 2)
3. A table cell containing `\|` or `` `a|b` ``: Tab does not split it into two columns. (Task 3)
4. Tab pressed on a line that merely contains a `|` but is not in a table: normal Tab behaviour, text untouched. (Task 3)
5. A request to the `kaelio-html` scheme for `../../.ssh/id_rsa`, an encoded `%2e%2e`, or a symlink that points outside the HTML file's folder: 403, nothing read. (Task 5)

---

### Task 1: One history list (spec I5)

**Files:**
- Create: `src/lib/history.ts`, `src/lib/history.test.ts`
- Modify: `src/main.ts` (`showFileHistory`, `loadHistoryCommits`, `loadHistorySnapshots`), `index.html` (history modal tabs), `src/styles.css`, `docs/guide/git/history-and-snapshots.md`

**Interfaces:**
- Produces:
```ts
type HistoryEntry =
  | { kind: "commit"; id: string; message: string; timestamp: number }
  | { kind: "snapshot"; snapPath: string; timestamp: number };
mergeHistory(
  commits: { id: string; message: string; timestamp: number }[],
  snapshots: { snap_path: string; timestamp: number }[],
): HistoryEntry[]
```
Timestamps are Unix seconds on both sides (as `git_log` and `list_snapshots` return today).

- [ ] **Step 1: Write the failing tests:**

```ts
test("newest first across both sources", () => {
  const out = mergeHistory(
    [{ id: "a1", message: "m1", timestamp: 100 }, { id: "a2", message: "m2", timestamp: 300 }],
    [{ snap_path: "/s1", timestamp: 200 }],
  );
  assert.deepEqual(out.map(e => e.timestamp), [300, 200, 100]);
  assert.deepEqual(out.map(e => e.kind), ["commit", "snapshot", "commit"]);
});
test("same second: snapshot is listed before commit", () => {
  const out = mergeHistory([{ id: "a", message: "m", timestamp: 5 }], [{ snap_path: "/s", timestamp: 5 }]);
  assert.deepEqual(out.map(e => e.kind), ["snapshot", "commit"]);
});
test("either side may be empty", () => {
  assert.deepEqual(mergeHistory([], []), []);
  assert.equal(mergeHistory([], [{ snap_path: "/s", timestamp: 1 }]).length, 1);
});
test("fields are carried over", () => {
  assert.deepEqual(mergeHistory([], [{ snap_path: "/s", timestamp: 1 }]), [{ kind: "snapshot", snapPath: "/s", timestamp: 1 }]);
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `mergeHistory`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Rebuild the modal list.** Replace `loadHistoryCommits` and `loadHistorySnapshots` with one `loadHistory()`: fetch snapshots always; fetch commits only when `currentFolderPath` is set, and treat a `git_log` error as "no commits" (do not show the error). Render `mergeHistory(...)` as rows following mockup section "I5": badge (`Commit` / `Snapshot`), message (`<short id> — <message>` or "Local snapshot"), time ago, View, Restore. Row actions call the existing `showHistoryDiff` / `restoreFromCommit` / `showSnapshotDiff` / `restoreFromSnapshot`. Every dynamic string goes through `escapeHtml`.

- [ ] **Step 6: Open without a folder.** In `showFileHistory` drop the `!currentFolderPath` guard (keep `!currentFilePath`). Empty state text: "No history yet. Snapshots are saved automatically as you edit."

- [ ] **Step 7: Remove the tabs** `#history-tab-commits` and `#history-tab-snapshots` from `index.html`, their listeners and their CSS.

- [ ] **Step 8: Verify** in dev: in a Git folder both kinds interleave by time; for a file opened without a folder the list shows snapshots; View and Restore work for both kinds. Update the guide page.

- [ ] **Step 9: Commit** `feat: single history list for commits and snapshots`.

---

### Task 2: Smart paste (spec A1)

**Files:**
- Modify: `package.json` (`turndown`, `turndown-plugin-gfm`, dev `@types/turndown`; exact pins)
- Create: `src/lib/smart-paste.ts`, `src/lib/smart-paste.test.ts`, `src/lib/turndown-plugin-gfm.d.ts` (module declaration, the plugin ships no types)
- Modify: `src/main.ts` (paste handling for `editor` and `editorSub`, shortcut registry), `docs/guide/writing/editor-and-preview.md`, `docs/guide/reference/keyboard-shortcuts.md`

**Interfaces:**
- Produces:
```ts
isSingleUrl(text: string): boolean            // one http(s) URL, no whitespace inside, surrounding whitespace allowed
hasStructure(html: string): boolean           // contains any of: h1-h6, ul, ol, li, table, a[href], strong, b, em, i, pre, code, blockquote, img
htmlToMarkdown(html: string): string
type PasteDecision = { kind: "plain" } | { kind: "link"; text: string } | { kind: "markdown"; text: string };
decidePaste(input: { html: string | null; text: string; selection: string; inCode: boolean; forcePlain: boolean }): PasteDecision
const MAX_PASTE_HTML = 2 * 1024 * 1024;
```

`htmlToMarkdown` settings: turndown with `headingStyle: "atx"`, `codeBlockStyle: "fenced"`, `bulletListMarker: "-"`, `emDelimiter: "*"`, the GFM plugin (tables, strikethrough, task lists), `remove(["script", "style", "meta", "link"])`, and a rule that drops any `img` whose `src` starts with `data:`. Result is trimmed.

`decidePaste` order: (1) `forcePlain` or `inCode` → plain. (2) `selection` non-empty and `isSingleUrl(text)` and not `isSingleUrl(selection)` → link, text `[${selection}](${text.trim()})`. (3) `html` non-null, `html.length <= MAX_PASTE_HTML`, `hasStructure(html)` → markdown with `htmlToMarkdown(html)`; if that result is empty → plain. (4) otherwise plain.

- [ ] **Step 1: Install** the three packages, exact-pinned.

- [ ] **Step 2: Write the failing tests:**

```ts
const base = { html: null, text: "", selection: "", inCode: false, forcePlain: false };

test("isSingleUrl", () => {
  assert.ok(isSingleUrl("https://example.com/a?b=1"));
  assert.ok(isSingleUrl("  http://example.com \n"));
  for (const no of ["example.com", "see https://example.com", "https://a.com https://b.com", "javascript:alert(1)", ""]) assert.ok(!isSingleUrl(no));
});
test("url over a selection becomes a link", () => {
  assert.deepEqual(decidePaste({ ...base, text: "https://example.com/doc", selection: "the doc" }),
    { kind: "link", text: "[the doc](https://example.com/doc)" });
});
test("url over a selected url is plain", () => {
  assert.deepEqual(decidePaste({ ...base, text: "https://b.com", selection: "https://a.com" }), { kind: "plain" });
});
test("url with no selection is plain", () => {
  assert.deepEqual(decidePaste({ ...base, text: "https://example.com" }), { kind: "plain" });
});
test("structured html becomes markdown", () => {
  const d = decidePaste({ ...base, text: "Plan", html: "<h2>Plan</h2><ol><li><strong>Measure</strong> it</li><li>Ship</li></ol>" });
  assert.equal(d.kind, "markdown");
  assert.equal((d as any).text, "## Plan\n\n1.  **Measure** it\n2.  Ship");
});
test("code-editor html (div/span only) is plain", () => {
  const html = '<meta charset="utf-8"><div style="color:#ccc"><div><span style="color:#89b4fa">const</span><span> a = 1;</span></div></div>';
  assert.deepEqual(decidePaste({ ...base, text: "const a = 1;", html }), { kind: "plain" });
});
test("inside code is always plain", () => {
  assert.deepEqual(decidePaste({ ...base, text: "x", html: "<h1>x</h1>", inCode: true }), { kind: "plain" });
  assert.deepEqual(decidePaste({ ...base, text: "https://a.com", selection: "s", inCode: true }), { kind: "plain" });
});
test("forcePlain wins", () => {
  assert.deepEqual(decidePaste({ ...base, text: "x", html: "<h1>x</h1>", forcePlain: true }), { kind: "plain" });
});
test("oversize html is plain", () => {
  const html = "<h1>x</h1>" + "a".repeat(MAX_PASTE_HTML);
  assert.deepEqual(decidePaste({ ...base, text: "x", html }), { kind: "plain" });
});
test("table converts to a pipe table", () => {
  const md = htmlToMarkdown("<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>");
  assert.match(md, /\| A \| B \|/);
  assert.match(md, /\| 1 \| 2 \|/);
});
test("scripts, styles and data-url images are dropped", () => {
  const md = htmlToMarkdown('<p>hi</p><script>alert(1)</script><style>p{}</style><img src="data:image/png;base64,AAAA"><img src="https://e.com/a.png" alt="a">');
  assert.ok(!md.includes("alert"));
  assert.ok(!md.includes("data:"));
  assert.ok(md.includes("![a](https://e.com/a.png)"));
});
```

If turndown's list spacing differs from `"1.  **Measure** it\n2.  Ship"`, do not change turndown's output to match: correct the expected string to what the pinned turndown version produces and note it in the commit message.

- [ ] **Step 3: Run** `npm test`. Expected: FAIL.
- [ ] **Step 4: Implement** the module. If `import { gfm } from "turndown-plugin-gfm"` fails under Node's ESM loader, use the default import and read `.gfm` from it.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.

- [ ] **Step 6: Wire paste in `main.ts`.** One function `handleSmartPaste(e: ClipboardEvent, view: EditorView): boolean`, called from the paste listeners of both editors *after* the image check from Plan A Task 2 (an image item still wins). It reads `text/html` and `text/plain`, computes `inCode` with `syntaxTree(view.state).resolveInner(pos, -1)` walking up for a node named `FencedCode`, `CodeBlock`, `InlineCode` or `CodeText`, takes the current selection text, calls `decidePaste`, and for `link` / `markdown` calls `e.preventDefault()` and `view.dispatch(view.state.replaceSelection(text))` with `userEvent: "input.paste"` so one undo reverts it. For `plain` it returns false and lets CodeMirror paste normally.

- [ ] **Step 7: Paste as plain text (⇧⌘V).** Add registry entry `{ id: "edit.paste-plain", label: "Paste as Plain Text", group: "Edit", defaultKey: "Mod-Shift-v" }`. First test in `npm run tauri dev` whether pressing ⇧⌘V in the editor already fires a `paste` event in the Tauri webview:
  - If it does: the shortcut's action sets `forcePlainPaste = true`, the next paste event passes `forcePlain: true` and resets it; a 500 ms timer also resets it.
  - If it does not: add the official `tauri-plugin-clipboard-manager` (npm and Cargo, exact pins) with only the `clipboard-manager:allow-read-text` permission in `src-tauri/capabilities/default.json`; the action reads the text and inserts it with `replaceSelection`.
  Record which branch was taken in the commit message.

- [ ] **Step 8: Verify** in dev: copy a formatted answer from a chat page → headings, lists, bold, links and code fences arrive as Markdown; copy code from VS Code → plain; select a word, paste a URL → link; ⌘Z once restores; ⇧⌘V pastes plain; pasting inside a code fence is plain. Update both guide pages.

- [ ] **Step 9: Commit** `feat: smart paste (rich text to Markdown, URL over selection)`.

---

### Task 3: Table editing (spec A2)

**Files:**
- Create: `src/lib/table.ts`, `src/lib/table.test.ts`
- Modify: `src/main.ts` (keymap of both editors), `docs/guide/writing/markdown-features.md`

**Interfaces:**
- Produces:
```ts
splitRow(line: string): string[]                 // trimmed cells; outer pipes optional; "\|" and pipes inside `code` are not separators
isDelimiterRow(line: string): boolean            // every cell matches /^:?-+:?$/
findTable(lines: string[], lineIndex: number): { start: number; end: number } | null   // inclusive; lines[start+1] is the delimiter row
formatTable(rows: string[]): string[]
interface TabResult { start: number; end: number; newLines: string[]; selLine: number; selFrom: number; selTo: number }
tabInTable(lines: string[], lineIndex: number, column: number, dir: 1 | -1): TabResult | null
```
`selLine` is an absolute index into the document's lines after replacement; `selFrom`/`selTo` are column offsets in that line covering the cell's trimmed content (equal when the cell is empty, placed one space after the pipe).

`formatTable` rules: column count = the widest row; short rows get empty cells. Column width = longest cell in that column, minimum 3, counted with `[...cell].length`. Each row is `| ` + cells padded on the right, joined by ` | ` + ` |`. Delimiter cells are dashes filling the width, keeping the colons of the original (`:---`, `:---:`, `---:`). The leading whitespace of the first row is put in front of every row.

`tabInTable` rules: returns `null` unless `findTable` finds a table containing `lineIndex`. The current cell is found by counting real separators left of `column`. Navigation skips the delimiter row. `dir = 1` in the last cell of the last row appends an empty row and selects its first cell. `dir = -1` in the first cell of the header stays in that cell. The table is always returned formatted.

- [ ] **Step 1: Write the failing tests:**

```ts
const raw = ["| Name | Role |", "|---|:---:|", "| An | Lead engineer |", "| Binh|Designer"];
const pretty = ["| Name | Role          |", "| ---- | :-----------: |", "| An   | Lead engineer |", "| Binh | Designer      |"];

test("splitRow handles outer pipes, escapes and code", () => {
  assert.deepEqual(splitRow("| a | b |"), ["a", "b"]);
  assert.deepEqual(splitRow("a | b"), ["a", "b"]);
  assert.deepEqual(splitRow("| a \\| b | c |"), ["a \\| b", "c"]);
  assert.deepEqual(splitRow("| `x|y` | z |"), ["`x|y`", "z"]);
  assert.deepEqual(splitRow("| a |  |"), ["a", ""]);
});
test("isDelimiterRow", () => {
  assert.ok(isDelimiterRow("|---|:---:|---:|"));
  assert.ok(!isDelimiterRow("| a | b |"));
  assert.ok(!isDelimiterRow("---"));            // a thematic break, no pipe
});
test("findTable needs a header and a delimiter row", () => {
  assert.deepEqual(findTable(["x", ...raw, "", "y"], 3), { start: 1, end: 4 });
  assert.equal(findTable(["a | b", "c | d"], 0), null);
  assert.equal(findTable(["text with | pipe"], 0), null);
  assert.equal(findTable(["x", ...raw], 0), null);
});
test("formatTable aligns columns and keeps alignment colons", () => {
  assert.deepEqual(formatTable(raw), pretty);
});
test("formatTable pads short rows and keeps indentation", () => {
  assert.deepEqual(formatTable(["  | a | b |", "|---|---|", "| 1 |"]), ["  | a   | b   |", "  | --- | --- |", "  | 1   |     |"]);
});
test("Tab moves to the next cell and selects it", () => {
  const r = tabInTable(raw, 2, 3, 1)!;             // cursor in "An"
  assert.deepEqual(r.newLines, pretty);
  assert.deepEqual([r.selLine, r.selFrom, r.selTo], [2, 9, 22]);   // "Lead engineer"
});
test("Tab from the last header cell skips the delimiter row", () => {
  const r = tabInTable(raw, 0, 10, 1)!;            // cursor in "Role"
  assert.deepEqual([r.selLine, r.selFrom, r.selTo], [2, 2, 4]);    // "An"
});
test("Tab in the last cell adds a row", () => {
  const r = tabInTable(raw, 3, raw[3].length, 1)!;
  assert.deepEqual(r.newLines, [...pretty, "|      |               |"]);
  assert.deepEqual([r.selLine, r.selFrom, r.selTo], [4, 2, 2]);
});
test("Shift+Tab from the first body cell goes to the last header cell", () => {
  const r = tabInTable(raw, 2, 3, -1)!;
  assert.deepEqual([r.selLine, r.selFrom, r.selTo], [0, 9, 13]);   // "Role"
});
test("Shift+Tab in the first header cell stays there", () => {
  const r = tabInTable(raw, 0, 3, -1)!;
  assert.deepEqual([r.selLine, r.selFrom, r.selTo], [0, 2, 6]);    // "Name"
});
test("selLine is absolute when the table is not at the top", () => {
  const r = tabInTable(["intro", "", ...raw], 4, 3, 1)!;
  assert.deepEqual([r.start, r.end, r.selLine], [2, 5, 4]);
});
test("outside a table returns null", () => {
  assert.equal(tabInTable(["just | text"], 0, 3, 1), null);
  assert.equal(tabInTable(["- item"], 0, 2, 1), null);
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/lib/table.ts`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Bind keys.** In `main.ts` add a keymap extension at `Prec.high` to both editors with `Tab` and `Shift-Tab`. The handler acts only when the selection is a single cursor or lies within one line: it calls `tabInTable(doc lines, cursor line index, cursor column, dir)`; on `null` it returns `false` so the existing Tab behaviour runs; otherwise it dispatches one transaction that replaces lines `start..end` with `newLines` and sets the selection to `selLine`/`selFrom`/`selTo`, and returns `true`. For documents over 20,000 lines pass only the block of consecutive non-blank lines around the cursor (and offset the result) instead of the whole document.

- [ ] **Step 6: Verify** in dev: type the unaligned table from mockup section "A2", press Tab through it; pressing Tab in a list item or a paragraph still indents; a single ⌘Z undoes one Tab step. Update the guide page.

- [ ] **Step 7: Commit** `feat: Tab navigation and auto-alignment in Markdown tables`.

---

### Task 4: Changed-since-reload highlight (spec A3)

**Files:**
- Create: `src/lib/line-diff.ts`, `src/lib/line-diff.test.ts`
- Modify: `src/main.ts` (`reloadCurrentFile`, preview render, editor update listener), `index.html` (status bar chip), `src/styles.css`, `docs/guide/writing/editor-and-preview.md`

**Interfaces:**
- Produces:
```ts
type LineRange = [start: number, end: number];        // 0-based lines of the NEW text, end exclusive
const MAX_DIFF_LINES = 20000;
changedLineRanges(oldText: string, newText: string): LineRange[] | null   // null when either side exceeds MAX_DIFF_LINES
blocksToMark(blockLines: number[], ranges: LineRange[]): number[]         // indexes into blockLines (ascending source lines)
```
A block `i` covers lines `[blockLines[i], blockLines[i+1])`; the last block runs to infinity. A block is marked when it overlaps any range. A removal with nothing added yields a one-line range at the line that now follows the removal point, clamped to the last line.

- [ ] **Step 1: Write the failing tests:**

```ts
test("identical text has no changes", () => { assert.deepEqual(changedLineRanges("a\nb", "a\nb"), []); });
test("one changed line", () => { assert.deepEqual(changedLineRanges("a\nb\nc", "a\nB\nc"), [[1, 2]]); });
test("inserted line", () => { assert.deepEqual(changedLineRanges("a\nc", "a\nb\nc"), [[1, 2]]); });
test("removed line marks the line after it", () => { assert.deepEqual(changedLineRanges("a\nb\nc", "a\nc"), [[1, 2]]); });
test("removed last line marks the new last line", () => { assert.deepEqual(changedLineRanges("a\nb", "a"), [[0, 1]]); });
test("two separate changes give two ranges", () => {
  assert.deepEqual(changedLineRanges("a\nb\nc\nd\ne", "a\nB\nc\nd\nE"), [[1, 2], [4, 5]]);
});
test("adjacent changed lines merge into one range", () => {
  assert.deepEqual(changedLineRanges("a\nb\nc\nd", "a\nB\nC\nd"), [[1, 3]]);
});
test("everything new", () => { assert.deepEqual(changedLineRanges("", "a\nb"), [[0, 2]]); });
test("too large returns null", () => {
  const big = "x\n".repeat(MAX_DIFF_LINES + 1);
  assert.equal(changedLineRanges(big, big + "y"), null);
});
test("blocksToMark picks the block that contains the range", () => {
  assert.deepEqual(blocksToMark([0, 2, 5], [[3, 4]]), [1]);
  assert.deepEqual(blocksToMark([0, 2, 5], [[5, 6]]), [2]);
  assert.deepEqual(blocksToMark([0, 2, 5], [[0, 1], [2, 3]]), [0, 1]);
  assert.deepEqual(blocksToMark([0, 2, 5], [[1, 6]]), [0, 1, 2]);
});
test("a range above the first block marks nothing", () => {
  assert.deepEqual(blocksToMark([3, 5], [[0, 2]]), []);
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Any line-diff that satisfies the tests is acceptable (trim the common prefix and suffix, then an LCS over the middle). It must not take more than about 200 ms on two 20,000-line inputs; add a test that asserts completion under 2 s for that size.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Capture the diff on reload.** In `reloadCurrentFile`, read the old document text before dispatching the replacement, compute `changedLineRanges(old, result.content)`, and store it in a module variable `reloadChangeRanges` (`[]` when null or when the file kind is not `markdown`). Await the preview render, then call `applyChangeMarks()`.

- [ ] **Step 6: `applyChangeMarks()`.** Collect elements in `#preview-pane` carrying `data-source-line`, sorted by that number; call `blocksToMark`; add class `changed-block` to the picked elements; then remove the class from any element that contains another `.changed-block` (so the innermost block is the one marked). Show the chip `#status-changes` with text `N change(s) ↓` and a `×` button; hide it when N is 0.

- [ ] **Step 7: Chip behaviour.** Click on the chip scrolls the preview to the next `.changed-block` below the current scroll position, wrapping to the first. Click on `×` clears marks and ranges.

- [ ] **Step 8: Clearing.** Clear marks and ranges when the editor document changes and `externalReload` is false, when another file becomes current, and at the start of the next reload.

- [ ] **Step 9: Style** per mockup section "A3": `.changed-block` has a 3px left border in `var(--warning)` and a faint tinted background; the border must not shift text (use `box-shadow: inset 3px 0 0` or an outside offset). `#status-changes` is a button element with an accessible label. `.changed-block` must be stripped from the PNG export clone and from Copy Formatted.

- [ ] **Step 10: Verify** in dev: open a note, then from a terminal append a paragraph and edit one line in the middle; the preview reloads with two marks and the chip reads "2 changes ↓"; clicking cycles; typing clears; with unsaved edits the existing "File changed on disk" banner still appears and no marks are drawn until Reload is chosen. Update the guide page.

- [ ] **Step 11: Commit** `feat: highlight blocks changed by an external reload`.

---

### Task 5: Opt-in scripts in HTML view (spec I3)

This task changes the security boundary. Do Step 1 to Step 3 first and stop if the spike fails.

**Files:**
- Modify: `src-tauri/src/lib.rs` (URI scheme, grant state, commands, tests), `src-tauri/Cargo.toml` (`getrandom`, exact version already present in `Cargo.lock`), `src-tauri/tauri.conf.json` (`frame-src` in `csp` and `devCsp`)
- Create: `src/lib/html-scripts.ts`, `src/lib/html-scripts.test.ts`
- Modify: `src/main.ts` (`renderHtmlPreview`, `exportPng`, tab close), `src/styles.css`, `docs/guide/files/images-and-other-files.md`, `docs/guide/reference/privacy.md`

**Interfaces:**
- Produces (TS): `hasScriptTag(html: string): boolean` — true for `<script>`, `<SCRIPT src=…>`, `<script\n`; false for `<scripted>` and for the text `&lt;script&gt;`.
- Produces (Rust state): `struct HtmlGrants(Mutex<Vec<(String, PathBuf)>>)` — (token, canonical folder), newest last, at most 32 entries, oldest evicted.
- Produces (Rust commands): `html_grant(path: String) -> Result<HtmlGrant, String>` where `HtmlGrant { token: String, file_name: String }`; `html_revoke(token: String)`.
- Produces (Rust, testable core): `fn resolve_html_request(grants: &[(String, PathBuf)], url_path: &str) -> Result<PathBuf, u16>` and `fn html_content_type(path: &Path) -> &'static str`.
- URL shape: `kaelio-html://localhost/<token>/<relative path>`; the frontend builds it with `convertFileSrc(`${token}/${fileName}`, "kaelio-html")` so each platform gets its correct form.

`html_grant` rules: `path` must be an existing regular file with extension `html` or `htm`; the granted folder is its canonical parent; token is 32 lowercase hex chars from `getrandom`.

`resolve_html_request` rules: percent-decode the path once; first segment is the token, unknown token → `Err(404)`; the rest is joined to the granted folder and canonicalised, missing → `Err(404)`; result not inside the granted folder → `Err(403)`; result not a regular file → `Err(404)`. An empty rest, a NUL byte, or a decoded path that is absolute → `Err(403)`.

Scheme handler: `GET` only (else 405). Response headers on success:

```
Content-Type: <html_content_type>
X-Content-Type-Options: nosniff
Cache-Control: no-store
Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline' https: SELF; style-src 'unsafe-inline' https: SELF; img-src data: blob: https: SELF; font-src data: https: SELF; media-src https: SELF; connect-src https: SELF; frame-src 'none'; form-action 'none'; base-uri 'none'
```

`SELF` is the scheme source for the platform: `kaelio-html:` on macOS and Linux, `http://kaelio-html.localhost` on Windows. No `'unsafe-eval'`.

`html_content_type`: `html htm` → `text/html; charset=utf-8`; `css` → `text/css`; `js mjs` → `text/javascript`; `json` → `application/json`; `png jpg jpeg gif webp svg` → their image types; `woff woff2 ttf` → their font types; anything else → `application/octet-stream`.

- [ ] **Step 1: Spike — build the minimum.** Register the scheme with a handler that serves one hard-coded test folder, add `kaelio-html: http://kaelio-html.localhost` to `frame-src`, and in dev load a frame with `sandbox="allow-scripts"` pointing at this probe page:

```html
<pre id="o"></pre><script>
const r = {};
r.tauri = typeof window.__TAURI__;
r.internals = typeof window.__TAURI_INTERNALS__;
try { r.parent = String(window.parent.document.title); } catch (e) { r.parent = "blocked"; }
try { r.storage = String(localStorage.length); } catch (e) { r.storage = "blocked"; }
(async () => {
  try { r.invoke = JSON.stringify(await window.__TAURI_INTERNALS__.invoke("get_home_dir")); } catch (e) { r.invoke = "blocked"; }
  try { r.ipc = String((await fetch("ipc://localhost/get_home_dir", { method: "POST" })).status); } catch (e) { r.ipc = "blocked"; }
  document.getElementById("o").textContent = JSON.stringify(r, null, 1);
})();
</script>
```

- [ ] **Step 2: Spike — judge.** Pass requires all of: the inline script ran (output is visible); `parent` is `"blocked"`; `storage` is `"blocked"`; `invoke` is `"blocked"`; `ipc` is `"blocked"` or a 4xx/5xx status and never returns the home directory. `tauri` / `internals` being defined is acceptable only if `invoke` is blocked. Also confirm a `<script src="https://…">` from a CDN loads and a relative `<img src="pic.png">` beside the file shows.

- [ ] **Step 3: Gate.** If any pass condition fails: revert the spike, do not ship script mode, write the probe output into the task report, and stop this task. Do not add `allow-same-origin`, do not loosen the app CSP, do not add a capability for the scheme. If all pass: paste the probe output into the commit message of Step 9 and continue.

- [ ] **Step 4: Write the failing tests.**

TypeScript:
```ts
test("hasScriptTag", () => {
  for (const yes of ["<script>x</script>", "<SCRIPT src='a.js'></SCRIPT>", "<p></p><script\n type=module>"]) assert.ok(hasScriptTag(yes));
  for (const no of ["<p>no</p>", "<scripted>", "&lt;script&gt;", ""]) assert.ok(!hasScriptTag(no));
});
```

Rust (temp folder `root` containing `page.html`, `sub/a.css`; a sibling folder `secret/key.txt`; a symlink `root/link` → `secret`):
```rust
#[test] fn html_request_serves_file_in_granted_folder()          // "/tok/page.html" and "/tok/sub/a.css" -> Ok
#[test] fn html_request_unknown_token_is_404()                   // "/nope/page.html"
#[test] fn html_request_parent_traversal_is_403()                // "/tok/../secret/key.txt"
#[test] fn html_request_encoded_traversal_is_403()               // "/tok/%2e%2e/secret/key.txt"
#[test] fn html_request_symlink_out_of_folder_is_403()           // "/tok/link/key.txt"
#[test] fn html_request_missing_file_is_404()                    // "/tok/none.html"
#[test] fn html_request_directory_is_404()                       // "/tok/sub"
#[test] fn html_request_empty_rest_is_403()                      // "/tok" and "/tok/"
#[test] fn html_grant_rejects_non_html_and_missing_files()       // x.md, missing.html
#[test] fn html_grants_evict_oldest_beyond_32()
#[test] fn html_content_type_known_and_fallback()
```

- [ ] **Step 5: Run** `npm test` and `cargo test --lib html_`. Expected: FAIL.
- [ ] **Step 6: Implement** `hasScriptTag`, the grant state and commands, `resolve_html_request`, `html_content_type`, and replace the spike handler with the real one. Register state with `.manage(...)` and the commands in `generate_handler!`.
- [ ] **Step 7: Run** both. Expected: PASS.

- [ ] **Step 8: Frontend.** Keep a module-level `htmlScriptsAllowed = new Set<string>()` (file paths, memory only) and `htmlGrantTokens = new Map<string, string>()`. In `renderHtmlPreview(previewPane, content)`:
  - Static mode (default): today's `srcdoc` frame with `sandbox="allow-same-origin"`, unchanged. If `hasScriptTag(content)`, put the bar from mockup section "I3" above the frame: "Scripts are off for this page." + button "Run scripts".
  - "Run scripts" adds the path to `htmlScriptsAllowed` and re-renders.
  - Script mode: call `html_grant` (reuse the token if one exists for the path), create the frame with `sandbox="allow-scripts"` and `src` from `convertFileSrc`; bar text "Scripts are running in an isolated frame." + button "Turn off" (removes the path from the set, revokes the token, re-renders). If the file is not saved yet or has unsaved edits, the bar adds "Showing the last saved version."; re-render after each save.
  - Bar text is set with `textContent`, never `innerHTML`.
  - Revoke the token when the tab closes.
  - Apply the same logic to the sub-pane HTML preview if it renders HTML through a separate code path.

- [ ] **Step 9: Export.** In `exportPng`, when the current file is in script mode: render the static frame, run the capture, then restore script mode. Flash "Exported the static version (scripts off)".

- [ ] **Step 10: Verify** in dev with an HTML file that draws a chart from a CDN script and shows a relative image: default shows the bar and no chart; "Run scripts" draws the chart; "Turn off" returns to static; quitting and relaunching starts static again; PNG export works in both modes. Re-run the Step 1 probe page through the finished feature and confirm the same output. Update both guide pages (privacy page: script mode can load `https:` resources the page asks for; it is off by default).

- [ ] **Step 11: Commit** `feat: opt-in sandboxed scripts for HTML preview`.

Not verified by this plan: Windows and Linux webviews. The spike runs on macOS only. Before a release that includes this task, run the probe on a Windows and a Linux build, or ship script mode behind a macOS-only check.

---

## Done when

- The four checks and `npm run guide:check` pass.
- `README.md` feature list mentions smart paste, table editing, change highlight and script mode; `CLAUDE.md` lists the new modules in `src/lib/`, the `kaelio-html` scheme and its two commands.
- Task 5 either shipped with the probe output recorded, or was stopped at its gate with the reason recorded.
