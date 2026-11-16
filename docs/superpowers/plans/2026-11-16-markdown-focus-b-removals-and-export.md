# Markdown Focus, Plan B: Removals and Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove everything that is not Markdown or HTML viewing (PDF viewer, CSV/JSON preview, image viewer), flatten export to PDF / DOCX / PNG, and render Mermaid locally for export so nothing leaves the machine.

**Architecture:** Removals delete code, dependencies, menu entries and docs together, so no dead entry survives. Removed file types are handed to the system default app by one narrow Rust command. For export, the frontend renders Mermaid blocks to PNG and swaps them for named placeholders; Rust only validates, writes and links the images.

**Tech Stack:** TypeScript (vanilla), Mermaid, html-to-image, Tauri 2, Rust, Pandoc, Typst.

**Spec:** `docs/superpowers/specs/2026-11-16-markdown-focus-design.md` (sections R1–R5, I6, "Documentation in scope"). Mockup: `docs/design/2026-11-16-markdown-focus-mockup.html` (section R5).

**Depends on:** Plan A Task 1 (the `npm test` harness and `src/lib/`).

## Global Constraints

- Line numbers were read on 2026-11-16 and drift. Locate code by symbol name.
- After each removal, `rg` for the removed symbols must return nothing in `src/`, `src-tauri/src/`, `index.html` and `src/styles.css`.
- `noUnusedLocals` is on: `npx tsc --noEmit` failing on an unused symbol means a removal is incomplete. Remove the symbol; do not silence the error.
- Everything written to `innerHTML` passes `escapeHtml` or `sanitizeHtmlString`.
- No change to `script-src` in `src-tauri/tauri.conf.json`.
- Existing `*.kaelio-annot.json` files on users' disks are never deleted or modified.
- Checks before every commit: `npm test`, `npx tsc --noEmit`, `cd src-tauri && cargo test --lib`, `npm run build`.
- One line per task under `## Unreleased` in `CHANGELOG.md`. Commit after each task. Do not push.

## Review Focus

1. A session file from the previous version that lists a `.pdf` or `.png` among open tabs: the app starts, that tab is skipped, no error dialog, no external app is launched at startup. (Task 2)
2. A Markdown link to `report.pdf` or an `<img>`-free link to `photo.png` clicked in the preview: opens in the default app, not as garbage text in the editor. (Task 2)
3. `open_in_default_app` called with a path whose extension is not on the allow-list (for example `.app`, `.sh`, `.command`): refused. (Task 2)
4. A diagram name from the frontend that tries to leave the temp folder (`../x.png`) or is not a PNG: export fails cleanly, nothing is written outside the temp folder. (Task 4)
5. A document where one of three Mermaid blocks has a syntax error: export succeeds, two diagrams appear, the broken one stays as a code block. (Task 4)

---

### Task 1: Remove the PDF viewer (spec R1)

**Files:**
- Modify: `src/main.ts`, `src/styles.css`, `index.html`, `src-tauri/src/lib.rs`, `package.json`, `vite.config.ts` (only if it has pdf.js worker settings)
- Delete: `docs/08-pdf-viewing.md`

- [ ] **Step 1: Remove the frontend code.** In `src/main.ts` delete, with every caller branch: the `pdfjs-dist` imports and worker setup; `PDF_EXTENSIONS`, `isPdfPath`; `PDF_ZOOM_*` constants and the `kaelio-pdf-zoom` read/write; `renderPdfPreview` and its inner helpers; `pdfPageText`, `clearPdfSearch`, `renderCurrentPdfPagesForSearch`, `currentPdfDoc` and the PDF branch of preview search; `pdfAnnotations`, `pdfAnnotationsDirty`, `pdfHighlightMode`, `renderPdfAnnotationLayer` and all annotation load/save code; `extractPdfToMarkdown`, `extractCurrentPdfToMarkdown`; the conditional "Extract PDF to Markdown" entry in `getCommands()`. Delete `openUntitledMarkdownTab` only if `rg` shows no other caller.

- [ ] **Step 2: Remove the Rust commands** `read_annotations` and `write_annotations`, their helper functions and structs, their entries in `generate_handler!`, and any tests that cover only them.

- [ ] **Step 3: Remove markup and styles.** Delete PDF-only elements from `index.html` and PDF-only rules from `src/styles.css` (`rg -n -i "pdf" src/styles.css index.html`; keep anything that belongs to PDF *export*).

- [ ] **Step 4: Remove the dependency.** `npm uninstall pdfjs-dist`. Delete `docs/08-pdf-viewing.md`.

- [ ] **Step 5: Verify nothing is left.**

Run: `rg -n "pdfjs|isPdfPath|renderPdfPreview|kaelio-annot|read_annotations|write_annotations|extractPdfToMarkdown" src src-tauri/src index.html`
Expected: no output.

Run: `npm test && npx tsc --noEmit && (cd src-tauri && cargo test --lib) && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit** `refactor: remove in-app PDF viewer, annotations and extract`.

(A `.pdf` clicked in the sidebar is handled in Task 2. Between Task 1 and Task 2 it falls through to the plain-text path; do not ship between them.)

---

### Task 2: Remove CSV/JSON/image viewers; open non-Markdown binaries in the default app (spec R2, R3, R4)

**Files:**
- Create: `src/lib/file-kind.ts`, `src/lib/file-kind.test.ts`
- Modify: `src/main.ts`, `src/styles.css`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`

**Interfaces:**
- Produces: `type FileKind = "markdown" | "html" | "text" | "external"`
- Produces: `fileKind(path: string | null): FileKind` — `markdown` for `md`, `markdown` and for `null` (untitled); `html` for `html`, `htm`; `external` for `pdf png jpg jpeg gif webp bmp ico avif svg`; `text` for everything else.
- Produces (Rust): `open_in_default_app(path: String) -> Result<(), String>`
- Produces (Rust, testable core): `fn default_app_target(path: &Path) -> Result<PathBuf, String>` — returns the canonical path if it is an existing regular file whose lowercase extension is one of `pdf png jpg jpeg gif webp bmp ico avif svg`; otherwise `Err`.

- [ ] **Step 1: Write the failing TypeScript tests:**

```ts
test("markdown", () => { for (const p of ["/a.md", "/a.MARKDOWN", null]) assert.equal(fileKind(p), "markdown"); });
test("html", () => { for (const p of ["/a.html", "/a.HTM"]) assert.equal(fileKind(p), "html"); });
test("external", () => {
  for (const e of ["pdf","png","jpg","jpeg","gif","webp","bmp","ico","avif","svg"]) assert.equal(fileKind(`/x.${e}`), "external");
  assert.equal(fileKind("/x.PDF"), "external");
});
test("everything else is text", () => {
  for (const p of ["/a.json", "/a.csv", "/a.yaml", "/a.txt", "/Makefile", "/.env", "/a.pdf.md.bak"]) assert.equal(fileKind(p), "text");
});
test("extension is taken from the file name, not a folder", () => {
  assert.equal(fileKind("/photos.png/readme"), "text");
});
```

- [ ] **Step 2: Write the failing Rust tests:**

```rust
#[test] fn default_app_target_accepts_listed_extension()      // tmp/x.PDF exists -> Ok(canonical path)
#[test] fn default_app_target_rejects_unlisted_extension()    // tmp/x.sh, tmp/x.command, tmp/x.app (file) -> Err
#[test] fn default_app_target_rejects_missing_file()          // tmp/nope.pdf -> Err
#[test] fn default_app_target_rejects_directory()             // tmp/dir.pdf/ (a directory) -> Err
```

- [ ] **Step 3: Run** `npm test` and `cd src-tauri && cargo test --lib default_app_target`. Expected: both FAIL (not defined).

- [ ] **Step 4: Implement** `fileKind`, `default_app_target`, and the command `open_in_default_app` (calls `default_app_target`, then opens the result with `tauri_plugin_opener`'s Rust API; error text is generic: "Cannot open this file"). Register it in `generate_handler!`.

- [ ] **Step 5: Run** both test commands. Expected: PASS.

- [ ] **Step 6: Route by kind.** At the top of `openFile` and `openInSubPane` in `src/main.ts`: if `fileKind(path) === "external"`, call `invoke("open_in_default_app", { path })`, flash "Opened in default app" (or the error), and return without creating a tab or adding to recent files. The preview link-click handler already calls `openFile`, so links are covered.

- [ ] **Step 7: Session restore must not launch apps.** In the restore path that reopens saved tabs, skip any saved tab whose `fileKind` is `"external"` before calling `openFile`. Same for the split restore from Plan A Task 5 and for `get_initial_file` at startup only if the file came from the saved session (a file the user explicitly opened with Kaelio from Finder may go to the default app).

- [ ] **Step 8: Delete the viewers.** Remove `renderImagePreview`, `IMAGE_PREVIEW_*`, `imagePreviewZooms`, `renderJsonPreview`, `renderCsvPreview`, `isJsonPath`, `isCsvPath`, `isSvgPath`, `isImagePath`, `isPreviewOnlyPath`, `updatePreviewOrRevealPreviewOnly` (replace its callers with `updatePreview`), their extension sets, their branches in the preview function and in `handleCurrentFileChangedOnDisk` / `checkCurrentFileForDiskChanges`, and their CSS. Replace remaining `isHtmlPath` / `isMarkdownPath` calls with `fileKind(...)` comparisons only where it reads more simply; otherwise leave them. Keep the image lightbox (`showImageLightbox`).

- [ ] **Step 9: Remove `read_binary_file`** from `lib.rs` and `generate_handler!` if `rg -n "read_binary_file" src` is empty.

- [ ] **Step 10: File associations.** In `src-tauri/tauri.conf.json` `fileAssociations`, delete the `json`, `csv`, `svg` and image entries. Keep `md/markdown`, `yaml/yml`, `txt`, `html/htm`.

- [ ] **Step 11: Verify.** All four checks pass. In `npm run tauri dev`: clicking a `.png` and a `.pdf` in the sidebar opens Preview.app and no tab; a `.json` and a `.csv` open as plain text; an image inside a Markdown note still shows and its lightbox works.

- [ ] **Step 12: Commit** `refactor: drop CSV/JSON/image viewers; open binaries in the default app`.

---

### Task 3: Flat export menu (spec R5)

**Files:**
- Create: `src/lib/export-availability.ts`, `src/lib/export-availability.test.ts`
- Modify: `src/main.ts`, `index.html`, `src-tauri/src/lib.rs` (native menu), `package.json`

**Interfaces:**
- Consumes: `fileKind` from Task 2.
- Produces: `exportAvailability(path: string | null): { pdf: boolean; docx: boolean; png: boolean }` — `html` kind → `{ pdf: false, docx: false, png: true }`; `markdown` and `text` → all `true`.
- Produces (in `main.ts`): `exportPdf()`, `exportDocx()`, `exportPng()`; native menu ids `export.pdf`, `export.docx`, `export.png`.

- [ ] **Step 1: Write the failing tests:**

```ts
test("markdown and untitled can export everything", () => {
  for (const p of ["/a.md", null]) assert.deepEqual(exportAvailability(p), { pdf: true, docx: true, png: true });
});
test("html exports PNG only", () => {
  assert.deepEqual(exportAvailability("/a.html"), { pdf: false, docx: false, png: true });
});
test("plain text exports everything", () => {
  assert.deepEqual(exportAvailability("/a.txt"), { pdf: true, docx: true, png: true });
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Rename and delete in `main.ts`.** `exportMarkdownPdf` → `exportPdf`, `exportMarkdownDocx` → `exportDocx`, `exportHtmlPng` → `exportPng`. Inline `exportHtmlImage` into `exportPng` (PNG only). Delete `exportHtmlJpg`, `exportHtmlPdf`, the `jsPDF` import, and any helper left unused (`sliceImageDataUrl`, `capturePreviewPng` if nothing else calls them). `exportPdf` and `exportDocx` start with: if `!exportAvailability(getActiveExportPath()).pdf` (or `.docx`), flash "PDF export is for Markdown files" (or "DOCX export is for Markdown files") and return.

- [ ] **Step 6: Menus.** In `index.html`, in both the File menu and the toolbar Export menu, replace the HTML ▸ and Markdown ▸ submenus with three items: "PDF…", "DOCX…", "PNG…". When a menu opens, add class `disabled` and `title="Markdown only"` to PDF and DOCX if not available (mockup section "R5"). In `lib.rs` replace the five native items `export.html.png|jpg|pdf` and `export.md.pdf|docx` with `export.pdf`, `export.docx`, `export.png`, and update `handleNativeMenuCommand`. In `getCommands()` replace the five export entries with "Export PDF", "Export DOCX", "Export PNG".

- [ ] **Step 7: Drop the HTML source format in Rust** if `rg -n "sourceFormat" src` shows the frontend no longer sends `"html"`: remove the `source_format` parameter and the `is_html` branches from `export_pdf` / `export_pdf_blocking`.

- [ ] **Step 8:** `npm uninstall jspdf`.

- [ ] **Step 9: Verify.** `rg -n "jspdf|jsPDF|exportHtml|export\.html\.|export\.md\." src src-tauri/src index.html` returns nothing. All four checks pass. In dev: each of the three exports works on a Markdown note; on an HTML file PDF and DOCX are greyed and PNG works.

- [ ] **Step 10: Commit** `refactor: single export menu (PDF, DOCX, PNG)`.

---

### Task 4: Mermaid rendered locally for export (spec I6)

**Files:**
- Create: `src/lib/mermaid-export.ts`, `src/lib/mermaid-export.test.ts`
- Modify: `src/main.ts` (`exportPdf`, `exportDocx`), `src-tauri/src/lib.rs` (`export_pdf`, `export_pdf_blocking`, `export_docx`, tests)

**Interfaces:**
- Produces: `interface MermaidBlock { startLine: number; endLine: number; source: string }` (0-based, inclusive of both fence lines)
- Produces: `findMermaidBlocks(markdown: string): MermaidBlock[]`
- Produces: `diagramName(nonce: string, index: number): string` → `kaelio-diagram-<nonce>-<index>.png`
- Produces: `applyDiagramPlaceholders(markdown: string, blocks: MermaidBlock[], rendered: boolean[], nonce: string): string` — each block with `rendered[i] === true` becomes the single line `![diagram](<diagramName(nonce, i)>)`; each other block keeps its lines but its opening fence loses the `mermaid` language (so it prints as plain code).
- Produces (Rust): `#[derive(Deserialize)] struct DiagramImage { name: String, data_base64: String }`; `export_pdf` and `export_docx` gain a parameter `diagrams: Vec<DiagramImage>`.
- Produces (Rust, testable core): `fn write_diagrams(dir: &Path, diagrams: &[DiagramImage]) -> Result<Vec<(String, PathBuf)>, String>` and `fn link_diagrams(markdown: &str, written: &[(String, PathBuf)]) -> String` (replaces every `](<name>)` with `](<absolute path>)`).

Rust validation in `write_diagrams`:

| Rule | Value |
|---|---|
| `name` | matches `^kaelio-diagram-[0-9a-f]{16}-[0-9]{1,4}\.png$` exactly |
| Count | at most 200 |
| Decoded size | at most 10 MB each |
| Content | starts with the PNG signature `89 50 4E 47 0D 0A 1A 0A` |
| Any failure | whole call returns `Err("Invalid diagram data")`, files already written in this call are removed |

- [ ] **Step 1: Write the failing TypeScript tests:**

```ts
const doc = ["# T", "```mermaid", "graph TD", "A-->B", "```", "text", "```js", "x", "```"].join("\n");

test("finds a mermaid block with its lines and source", () => {
  assert.deepEqual(findMermaidBlocks(doc), [{ startLine: 1, endLine: 4, source: "graph TD\nA-->B" }]);
});
test("a mermaid fence shown inside another fence is not a block", () => {
  assert.deepEqual(findMermaidBlocks("````md\n```mermaid\ngraph TD\n```\n````"), []);
});
test("unterminated mermaid fence is not a block", () => {
  assert.deepEqual(findMermaidBlocks("```mermaid\ngraph TD"), []);
});
test("rendered block becomes one image line", () => {
  const blocks = findMermaidBlocks(doc);
  const out = applyDiagramPlaceholders(doc, blocks, [true], "0123456789abcdef");
  assert.equal(out.split("\n")[1], "![diagram](kaelio-diagram-0123456789abcdef-0.png)");
  assert.ok(!out.includes("graph TD"));
  assert.ok(out.includes("```js"));
});
test("failed block stays as a plain code block", () => {
  const out = applyDiagramPlaceholders(doc, findMermaidBlocks(doc), [false], "0123456789abcdef");
  assert.deepEqual(out.split("\n").slice(1, 5), ["```", "graph TD", "A-->B", "```"]);
});
test("two blocks keep their own indexes when the first fails", () => {
  const two = doc + "\n```mermaid\ngraph LR\n```";
  const out = applyDiagramPlaceholders(two, findMermaidBlocks(two), [false, true], "0123456789abcdef");
  assert.ok(out.includes("kaelio-diagram-0123456789abcdef-1.png"));
  assert.ok(!out.includes("-0.png"));
});
```

- [ ] **Step 2: Write the failing Rust tests:**

```rust
#[test] fn write_diagrams_writes_valid_png_and_returns_its_path()
#[test] fn write_diagrams_rejects_name_with_path_separator()      // "../kaelio-diagram-0123456789abcdef-0.png"
#[test] fn write_diagrams_rejects_name_not_matching_pattern()     // "x.png", "kaelio-diagram-XYZ-0.png", "...-0.jpg"
#[test] fn write_diagrams_rejects_non_png_bytes()
#[test] fn write_diagrams_rejects_oversize()
#[test] fn write_diagrams_removes_earlier_files_when_a_later_one_fails()
#[test] fn link_diagrams_replaces_only_listed_names()
// "![diagram](kaelio-diagram-0123456789abcdef-0.png) and ![x](other.png)" -> first becomes the absolute path, second unchanged
```

- [ ] **Step 3: Run** `npm test` and `cargo test --lib diagrams`. Expected: FAIL.
- [ ] **Step 4: Implement** the three TypeScript functions and the two Rust functions.
- [ ] **Step 5: Run** both. Expected: PASS.

- [ ] **Step 6: Render in the frontend.** Add `async function renderDiagramsForExport(markdown: string): Promise<{ markdown: string; diagrams: { name: string; data_base64: string }[] }>` in `main.ts`:
  - `nonce` = 16 lowercase hex chars from `crypto.getRandomValues`.
  - For each block: put a `div.mermaid` with the source into an off-screen host element (white background, fixed width 1200px), run `mermaid.run` on it, capture it with the existing `captureNodeImage` helper as PNG at pixel ratio 2, then remove the host. If the source has no `%%{init` directive, prefix it with `%%{init: {'theme':'default'}}%%` so diagrams are light on the white PDF page whatever the app theme is.
  - A block whose render or capture throws is marked `rendered[i] = false`.
  - Return `applyDiagramPlaceholders(...)` and the images for the rendered ones.
  - Flash "Rendering diagram i/n…" while it runs.

- [ ] **Step 7: Use it.** In `exportPdf` and `exportDocx`, call `renderDiagramsForExport(getActiveMarkdownContent())` and pass `markdownContent` and `diagrams` to the Rust command.

- [ ] **Step 8: Replace the network path in Rust.** In `export_pdf_blocking`, delete the whole "Step 1: Extract mermaid blocks, render to PNG via mermaid.ink" loop, the `curl` command and `base64url_encode` if it has no other caller. In its place: `let written = write_diagrams(&tmp_dir, &diagrams)?; let processed = link_diagrams(&markdown_content, &written);`. Do the same in `export_docx` (remove whatever it does with Mermaid today). Keep the temp-folder cleanup that already exists.

- [ ] **Step 9: Verify.**

Run: `rg -n "mermaid\.ink|curl" src-tauri/src/lib.rs`
Expected: no output.

All four checks pass. In dev with Wi-Fi off: export a note with two valid diagrams and one broken one to PDF and to DOCX. Two diagrams appear, readable on white; the broken one is a code block.

- [ ] **Step 10: Commit** `feat: render Mermaid locally for PDF/DOCX export; remove mermaid.ink`.

---

### Task 5: Documentation (spec "Documentation in scope")

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `docs/04-pdf-export.md`, `docs/00-architecture-overview.md` (only lines that mention removed features)
- Modify: `docs/guide/files/pdf-viewer.md`, `docs/guide/files/images-and-other-files.md`, `docs/guide/export/export.md`, `docs/guide/recipes/note-to-pdf.md`, `docs/guide/reference/privacy.md`, `docs/guide/reference/keyboard-shortcuts.md`, `docs/guide/reference/troubleshooting.md`, `docs/guide/guide.json`

- [ ] **Step 1: Read the guide contract.** Read `scripts/check-guide.mjs` fully and `docs/guide/published-slugs.txt`. Determine whether a slug listed in `published-slugs.txt` may be deleted.

- [ ] **Step 2: Guide pages.**
  - `files/pdf-viewer`: if a published slug may not be deleted, replace the body with a short page: Kaelio no longer opens PDFs in-app; PDFs open in the default app; BugText has a full PDF reader. Otherwise delete the page and its `guide.json` entry.
  - `files/images-and-other-files`: rewrite to the new behaviour (images, SVG and PDF open in the default app; JSON, CSV, YAML, TXT open as plain text; HTML renders in the preview).
  - `export/export`, `recipes/note-to-pdf`: three export formats; PDF and DOCX need Pandoc (PDF also Typst); no image-based PDF, no JPG.
  - `reference/privacy`: export makes no network request; remove the mermaid.ink paragraph.
  - `reference/keyboard-shortcuts`: match Plan A Task 1.
  - `reference/troubleshooting`: remove entries about the PDF viewer and mermaid.ink timeouts.

- [ ] **Step 3: Repo docs.** `README.md`: feature bullets, "New in Kaelio" table, export section, privacy note, shortcuts table. `CLAUDE.md`: remove PDF viewing, annotation commands, `read_binary_file`, the two export families and the mermaid.ink sentence; add `src/lib/` + `npm test`, `save_pasted_image`, `open_in_default_app`, the single export menu, local Mermaid export. `docs/04-pdf-export.md`: new Mermaid flow.

- [ ] **Step 4: Run** `npm run guide:check && npm run guide:test`. Expected: both pass.

- [ ] **Step 5: Run** `rg -n -i "mermaid\.ink|pdf viewer|annotat|JPG|jspdf" README.md CLAUDE.md docs/guide docs/0*.md`. Expected: no stale claim remains (historical entries in `CHANGELOG.md` and `wiki/` are left as they are).

- [ ] **Step 6: Commit** `docs: reflect markdown-only scope and single export menu`.

---

## Done when

- The four checks and both guide checks pass.
- `package.json` no longer lists `pdfjs-dist` or `jspdf`.
- `rg -n "mermaid\.ink" .` matches only `CHANGELOG.md` history and `wiki/`.
- A production build (`npm run tauri build`) opens, and its bundle is smaller than the 0.9.5 bundle (record both sizes in the final report).
