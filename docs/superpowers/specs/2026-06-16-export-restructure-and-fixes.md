# Export menu restructure + export fixes (Codex prompt)

Date: 2026-06-16
Status: Ready for implementation. **Task prompt for Codex.** Branch `main`.

Kaelio = Tauri 2 + Rust + vanilla TS Markdown editor. Frontend: `src/main.ts`, `src/styles.css`, `index.html`; native menu + export backend in `src-tauri/src/lib.rs`. No test framework — verify with `npm run build`, `cd src-tauri && cargo check`, and a manual `npm run tauri dev` pass. Match existing style; small commits; don't refactor unrelated code.

## Current state

Export menu (toolbar `#export-dropdown` + File-menu `#btn-export-*` items + native File menu in `lib.rs`) offers a flat list: **PDF, PNG, JPG, DOCX**.

All four are **capture-based** today (render `#preview-pane` to an image via `preparePreviewCaptureNode` → `capturePreviewPng` using `html-to-image`):
- `exportPreviewImage("png"|"jpg")` — image of the preview.
- `exportPDF()` — capture → slice → `jsPDF` (image pages).
- `exportDOCX()` — capture → slice → `docx` `ImageRun` (images embedded, **not editable text**).

The backend **already has real document exporters** that the frontend no longer uses: `export_pdf(markdown_content, output_path, source_format, app)` (Pandoc + Typst/xelatex) and `export_docx(markdown_content, output_path, app)` (Pandoc) in `lib.rs`.

## Goal

### 1. Restructure the Export menu into two families (nested)

```
Export ▾
 ├─ HTML  →  PNG  ·  JPG  ·  PDF      (capture the rendered preview — "picture" output)
 └─ Markdown  →  PDF  ·  DOCX         (convert the .md source via Pandoc — real documents)
```

- **HTML group** = visual capture of the rendered preview (current capture path): **PNG, JPG, PDF**.
- **Markdown group** = document conversion from the markdown source via the existing Rust commands: **PDF** (`export_pdf`), **DOCX** (`export_docx`, editable text).
- Implement nested submenus in the toolbar `#export-dropdown` (hover/click to reveal the sub-items — reuse the existing `.ctx-submenu`/dropdown styling pattern) and as nested `Submenu`s in the native `lib.rs` File → Export menu. Update the File-menu dropdown items similarly. Use distinct command ids, e.g. `export.html.png|jpg|pdf` and `export.md.pdf|docx`.
- Note PDF appears in **both** groups but uses **different paths**: HTML→PDF = capture; Markdown→PDF = Pandoc.

### 2. Fix capture exports to grab the FULL document at full width (Bug)

**Symptom:** in a single window with editor+preview split, PNG/JPG capture only ~half the page (the visible half-width preview).
**Root cause:** capture uses the live `#preview-pane` dimensions, and `withPreviewAvailable` only switches to full preview when `currentViewMode === "editor"` — in `"split"` it stays half-width.
**Fix:** for every capture export (HTML → PNG/JPG/PDF), render the preview content at **full document width and full height** before capturing. Either (a) extend `withPreviewAvailable` to also switch out of `"split"` into full `"preview"`/reading layout during capture (then restore), and/or (b) build the off-flow capture host (`preparePreviewCaptureNode`) at a **full target width** (e.g. a fixed reading width ~820–1000px, or the window/content natural width) instead of inheriting the half-pane `scrollWidth`, and size height to the full content `scrollHeight`. Keep `waitForPreviewAssets` + a paint wait so fonts/images/Mermaid are present. Result: PNG/JPG/HTML-PDF contain the **complete** rendered document regardless of the current split/zoom state.

### 3. Make Markdown → PDF/DOCX produce real documents (Bug: currently blank)

**Symptom:** PDF/DOCX export a blank (white) page with no content.
**Fix:** route the **Markdown group** through the existing Rust commands instead of the capture path:
- Markdown→PDF: `invoke("export_pdf", { markdownContent, outputPath, sourceFormat: "markdown" })`.
- Markdown→DOCX: `invoke("export_docx", { markdownContent, outputPath })` — yields an **editable** Word doc, not images.
- `markdownContent` = the active document's source (`editor.state.doc.toString()`; for the focused pane if split). Show a save dialog for each (reuse the existing `save({ filters, defaultPath })` pattern). Surface Pandoc errors via `flashStatus`.
- Keep the capture-based PDF only for the **HTML** group. The old capture-based `exportDOCX` (image `ImageRun`) is replaced by the Pandoc DOCX for the Markdown group — remove or repurpose it; don't keep dead image-DOCX code.

## Wiring notes
- Frontend handlers (suggested names): `exportHtmlPng`, `exportHtmlJpg`, `exportHtmlPdf` (capture); `exportMarkdownPdf`, `exportMarkdownDocx` (Pandoc). Wire to the new menu item ids in the toolbar dropdown, File dropdown, and `handleNativeMenuCommand` (`lib.rs` native menu).
- Verify the `export_pdf`/`export_docx` commands are registered in `tauri::generate_handler!` (they should be; if not, add them).

## Done criteria
- Export menu shows **HTML → PNG/JPG/PDF** and **Markdown → PDF/DOCX** (toolbar + native menu).
- HTML→PNG/JPG/PDF capture the **full** document at full width, even from a half-width split preview.
- Markdown→PDF and Markdown→DOCX produce **non-blank, full-content** documents; DOCX is editable text.
- `npm run build` + `cargo check` pass; manual `npm run tauri dev` confirms all five exports on a real file (test from editor+preview split).
- Update `CHANGELOG.md` under `## 0.9.2` (or a new `## 0.9.3` if 0.9.2 is already released) describing the restructured export menu + full-capture fix + real document exports.
- Small, descriptive commits on `main`.
