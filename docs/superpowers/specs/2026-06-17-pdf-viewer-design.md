# PDF viewing in Kaelio — phased design

Repo: Kaelio (Tauri 2, vanilla TS frontend in `src/main.ts`, Rust in
`src-tauri/src/lib.rs`). Verify with `npm run build` and `cargo check` in
`src-tauri`.

## What problem does this solve?

Kaelio can *export* PDFs but treats them as opaque. Opening a `.pdf` today renders
it in a native `<iframe>` (`renderPdfPreview`, `src/main.ts:1189`) using the
webview's built-in PDF plugin. That works for casual viewing but is a black box:
no access to text, pages, or layout, so we can't search, extract, or annotate.

Users want to read reference PDFs alongside their notes and pull content out of
them without leaving the editor.

## Core decision

Replace the native-iframe preview with a **PDF.js (`pdfjs-dist`) renderer we
control**. The iframe cannot be extended; PDF.js exposes pages, a text layer, and
metadata, which is the foundation every later phase needs. Phase 1 alone justifies
the swap by giving consistent in-app chrome (zoom/page nav) that the iframe lacks.

## Phasing

Only **Phase 1 is committed** by this spec. Phases 2–4 are documented direction;
each gets its own spec + plan when scheduled.

| Phase | Feature | Effort | Status |
|-------|---------|--------|--------|
| 1 | Open + view PDF pages | medium (~1–2 days) | **committed** |
| 2 | Text selection + search in PDF | medium-plus | future |
| 3 | Extract PDF content to Markdown | hard, imperfect | future |
| 4 | Edit / annotate PDF | much harder | future |

---

## Phase 1 — Open + view PDF pages (committed)

### Behavior

- Opening a `.pdf` shows it in the editor area **as a tab**, reusing the same tab
  path the in-app image viewer uses (PDFs already route through `isPdfPath` /
  `updatePreview` at `src/main.ts:1064,1267`).
- Pages render top-to-bottom in a single scrollable container (continuous mode).
- A viewer toolbar shows: current page indicator (`3 / 12`), zoom in / zoom out /
  reset. Page indicator updates from scroll position.
- **Zoom persists across opens** (matches the image viewer). Store under a
  localStorage key, e.g. `kaelio-pdf-zoom`, default `1.0`.
- Large PDFs stay responsive: only render pages at/near the viewport; render
  placeholders (sized to page dimensions) for the rest and fill them in as they
  scroll into view (IntersectionObserver).

### Architecture

- Add dependency `pdfjs-dist`. Configure its worker as a bundled asset so it works
  in the Tauri webview (no CDN — app must work offline). Import the worker via
  Vite (`?url` or `?worker`) rather than a network URL.
- New function `renderPdfPreview(previewPane, path)` **replaces** the current
  iframe implementation:
  1. Read bytes with the existing Rust command `read_binary_file` (no new backend
     code). Pass the `Uint8Array` to `pdfjs.getDocument`.
  2. Build the toolbar + a scroll container in `previewPane`.
  3. For each page, create a placeholder `<div>` at the page's CSS size for the
     current zoom; observe it; on intersection render the page to a `<canvas>`.
  4. Wire zoom buttons to re-layout at the new scale and re-render visible pages.
- Keep all PDF code in `src/main.ts` alongside the other preview renderers; factor
  a small `pdfState` object (current doc, zoom, page count) rather than scattering
  globals. If the PDF block grows past a screen or two, that is the signal to pull
  it into its own module — note it, don't pre-abstract.

### Data flow

`open file → isPdfPath → updatePreview → renderPdfPreview → read_binary_file
(Rust) → pdfjs.getDocument → per-page canvas render`

### Error handling

- Corrupt / unreadable PDF: show an inline error message in the pane (not a
  crash), with the filename. Reuse `flashStatus` for transient failures.
- Encrypted/password PDFs: out of scope for Phase 1 — show "Password-protected
  PDFs are not supported yet" rather than failing silently.

### Out of scope (Phase 1)

- Text selection, search, copy (Phase 2).
- Thumbnails sidebar, page rotation, printing.
- Two-up / book layouts.
- Editing or annotating.

### Acceptance test (manual)

- Open a multi-page PDF from the sidebar → pages render in a scrollable tab.
- Zoom in/out → pages rescale and stay sharp; page indicator tracks scroll.
- Close and reopen a PDF → zoom level is remembered.
- Open a large (50+ page) PDF → scrolling stays smooth (lazy render works).
- Open a non-PDF and a markdown file → unaffected by the change.
- `npm run build` passes; app runs offline (no CDN worker fetch).

---

## Phase 2 — Text selection + search (future)

- Render PDF.js's **text layer** as transparent positioned spans over each page
  canvas → native selection + Cmd+C copy.
- Cmd+F searches across concatenated text-layer content with match highlighting,
  reusing the existing preview-search UX (mark highlighting, next/prev).
- Risk: text-layer alignment with canvas across zoom levels; must re-sync on zoom.

## Phase 3 — Extract PDF content to Markdown (future, imperfect)

- Walk the text layer per page and emit heuristic Markdown: paragraphs joined,
  hard line breaks collapsed, headings/lists best-effort from font-size/position.
- Output to a new untitled `.md` tab for the user to clean up.
- Explicitly lossy: tables, multi-column layouts, and scanned (image-only) PDFs
  will extract poorly or not at all. No OCR. Set this expectation in the UI.

## Phase 4 — Edit / annotate PDF (future, much harder)

- Overlay annotation layer (highlights, text notes) on top of the rendered pages.
- Persist annotations as a **JSON sidecar** (`<file>.kaelio-annot.json`) so the
  original PDF is never mutated. Burning annotations into the PDF (re-writing the
  file) is a separate, larger sub-feature deferred until the sidecar model proves
  out.
- Largest scope and risk; kept deliberately thin here.

---

## Constraints

- Must work fully offline (bundle the PDF.js worker; no CDN).
- No new Rust commands needed for Phase 1 — reuse `read_binary_file`.
- Catppuccin Mocha theming via existing CSS variables for the viewer chrome.
- No test framework in the project; verification is manual + `npm run build`.

## Deliverables (Phase 1)

- [ ] Code (`pdfjs-dist` dep, rewritten `renderPdfPreview`, viewer toolbar, CSS)
- [ ] CLAUDE.md note updating the PDF-open behavior (iframe → PDF.js)
- [ ] Manual test pass per acceptance list above
