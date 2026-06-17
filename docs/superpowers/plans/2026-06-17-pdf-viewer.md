# PDF Viewing in Kaelio — Implementation Plan (all phases)

> **For Codex:** Implement task-by-task, in order. After each task run the stated
> verification (`npm run build`, and `cargo check` in `src-tauri` when Rust
> changed) and commit. Steps use checkbox (`- [ ]`) syntax for tracking. This repo
> has **no test framework or linter** — verification is `npm run build` +
> `cargo check` + the manual checks listed per task.

**Goal:** Let users open, read, search, extract from, and annotate PDF files
inside Kaelio, replacing the current opaque native-iframe preview with a
PDF.js-based renderer.

**Architecture:** Frontend-only rendering with `pdfjs-dist` in the existing
preview pane. PDFs already route through `isPdfPath` → `updatePreview` →
`renderPdfPreview` (`src/main.ts`). We rewrite `renderPdfPreview` to render pages
to `<canvas>` with a lazy IntersectionObserver, then layer text (selection/search),
extraction, and a JSON-sidecar annotation layer on top. Bytes come from the
existing Rust `read_binary_file` command — no new backend for Phases 1–3; Phase 4
adds two tiny sidecar commands.

**Tech Stack:** Tauri 2, vanilla TypeScript (`src/main.ts`), Vite, Rust
(`src-tauri/src/lib.rs`), `pdfjs-dist`.

## Global Constraints

- Must work fully **offline** — bundle the PDF.js worker via Vite, never a CDN URL.
- Frontend is **one file** (`src/main.ts`); keep PDF code together there, matching
  the existing image/CSV/JSON preview renderers. Do not introduce a framework.
- Theme with existing Catppuccin CSS variables (`--bg`, `--accent`, `--text`,
  `--surface0`, `--surface1`, etc.) in `src/styles.css`.
- No new Rust commands for Phases 1–3; reuse `read_binary_file` (returns
  `{ path, data_base64, mime_type, size, modified_ms }`).
- Verify every task with `npm run build`; add `cargo check` (run inside
  `src-tauri`) only when Rust changed.
- Do not break existing image / SVG / markdown / CSV / JSON preview behavior.

---

## Existing code to build on

- `src/main.ts:1064` `isPdfPath(path)` — already classifies `.pdf`.
- `src/main.ts:1189` `renderPdfPreview(previewPane, path)` — current iframe impl,
  **to be replaced**.
- `src/main.ts:1267` `updatePreview` dispatches to `renderPdfPreview`.
- `src/main.ts:1118-1187` `renderImagePreview` — the toolbar + zoom + stage pattern
  to imitate (classes `asset-preview-toolbar`, `asset-preview-tool`,
  `asset-preview-stage`, `asset-preview-message`).
- `src/main.ts:61` `interface BinaryFileInfo { path; data_base64; mime_type; size; modified_ms }`.
- `flashStatus(...)` — transient status messages (used across the file).
- Preview search lives behind Cmd+F; reuse its mark-highlight UX in Phase 2.

---

# PHASE 1 — Open + view PDF pages

## Task 1: Add pdfjs-dist and wire the worker

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/main.ts` (imports near top, around the existing `import { jsPDF }` at line 16)

- [ ] **Step 1: Install the dependency**

```bash
npm install pdfjs-dist@^4
```

- [ ] **Step 2: Import pdfjs and set the worker (offline-safe)**

Add near the other imports in `src/main.ts` (after line 16):

```ts
import * as pdfjsLib from "pdfjs-dist";
// Vite bundles the worker as a local asset — no CDN, works offline.
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
```

- [ ] **Step 3: Build to confirm the worker bundles**

Run: `npm run build`
Expected: PASS, no "worker" or "Cannot find module" errors. (If Vite complains
about the worker path, fall back to:
`import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";`
`pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;`)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/main.ts
git commit -m "feat(pdf): add pdfjs-dist with bundled offline worker"
```

---

## Task 2: Replace the iframe renderer with a PDF.js canvas renderer

**Files:**
- Modify: `src/main.ts:1189-1193` (`renderPdfPreview`)
- Modify: `src/styles.css` (add PDF viewer styles)

**Interfaces:**
- Consumes: `pdfjsLib` (Task 1), `BinaryFileInfo`, `read_binary_file`, `flashStatus`,
  `currentFilePath`.
- Produces: `renderPdfPreview(previewPane: HTMLElement, path: string): Promise<void>`
  (now async), a module-level `pdfZooms: Map<string, number>` for persisted zoom,
  and constants `PDF_ZOOM_MIN`, `PDF_ZOOM_MAX`, `PDF_ZOOM_STEP`.

- [ ] **Step 1: Add zoom persistence helpers near the other preview state**

Add above `renderPdfPreview` in `src/main.ts`:

```ts
const PDF_ZOOM_MIN = 0.25;
const PDF_ZOOM_MAX = 4;
const PDF_ZOOM_STEP = 0.2;
const PDF_ZOOM_KEY = "kaelio-pdf-zoom";

function loadPdfZoom(): number {
  const raw = Number(localStorage.getItem(PDF_ZOOM_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, raw));
}
function savePdfZoom(zoom: number) {
  localStorage.setItem(PDF_ZOOM_KEY, String(zoom));
}
```

- [ ] **Step 2: Rewrite `renderPdfPreview` (replace lines 1189-1193 entirely)**

```ts
async function renderPdfPreview(previewPane: HTMLElement, path: string) {
  const filename = path.split("/").pop() || "PDF";
  previewPane.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "asset-preview-wrap pdf-preview-wrap";

  const toolbar = document.createElement("div");
  toolbar.className = "asset-preview-toolbar";
  const zoomOut = document.createElement("button");
  zoomOut.className = "asset-preview-tool";
  zoomOut.textContent = "−";
  zoomOut.title = "Zoom out";
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "asset-preview-zoom-label";
  const zoomIn = document.createElement("button");
  zoomIn.className = "asset-preview-tool";
  zoomIn.textContent = "+";
  zoomIn.title = "Zoom in";
  const pageLabel = document.createElement("span");
  pageLabel.className = "pdf-page-label";
  toolbar.append(zoomOut, zoomLabel, zoomIn, pageLabel);

  const stage = document.createElement("div");
  stage.className = "asset-preview-stage pdf-stage";
  const loading = document.createElement("div");
  loading.className = "asset-preview-message";
  loading.textContent = "Loading PDF...";
  stage.appendChild(loading);
  wrap.append(toolbar, stage);
  previewPane.appendChild(wrap);

  let zoom = loadPdfZoom();

  try {
    const file = await invoke<BinaryFileInfo>("read_binary_file", { path });
    if (currentFilePath !== path) return;

    const bytes = Uint8Array.from(atob(file.data_base64), (c) => c.charCodeAt(0));
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    if (currentFilePath !== path) return;

    const pageCount = doc.numPages;
    pageLabel.textContent = `1 / ${pageCount}`;

    // One placeholder per page; render lazily as it scrolls into view.
    type PageSlot = { el: HTMLDivElement; rendered: boolean; rendering: boolean };
    const slots: PageSlot[] = [];
    const container = document.createElement("div");
    container.className = "pdf-pages";
    stage.replaceChildren(container);

    for (let n = 1; n <= pageCount; n++) {
      const el = document.createElement("div");
      el.className = "pdf-page";
      el.dataset.page = String(n);
      container.appendChild(el);
      slots.push({ el, rendered: false, rendering: false });
    }

    async function sizePlaceholders() {
      // Size each placeholder to its page so scroll height is correct before render.
      for (let n = 1; n <= pageCount; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: zoom });
        const slot = slots[n - 1];
        slot.el.style.width = `${Math.floor(vp.width)}px`;
        slot.el.style.height = `${Math.floor(vp.height)}px`;
      }
    }

    async function renderPage(n: number) {
      const slot = slots[n - 1];
      if (slot.rendered || slot.rendering) return;
      slot.rendering = true;
      const page = await doc.getPage(n);
      if (currentFilePath !== path) return;
      const vp = page.getViewport({ scale: zoom });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.className = "pdf-canvas";
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (currentFilePath !== path) return;
      slot.el.replaceChildren(canvas);
      slot.rendered = true;
      slot.rendering = false;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const n = Number((entry.target as HTMLElement).dataset.page);
            void renderPage(n);
          }
        }
      },
      { root: stage, rootMargin: "400px 0px" }
    );
    slots.forEach((s) => io.observe(s.el));

    // Update the page indicator from scroll position.
    stage.addEventListener("scroll", () => {
      const mid = stage.scrollTop + stage.clientHeight / 2;
      let current = 1;
      for (let n = 1; n <= pageCount; n++) {
        if (slots[n - 1].el.offsetTop <= mid) current = n;
      }
      pageLabel.textContent = `${current} / ${pageCount}`;
    });

    async function applyZoom(next: number) {
      zoom = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, Number(next.toFixed(2))));
      savePdfZoom(zoom);
      zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
      slots.forEach((s) => {
        s.rendered = false;
        s.el.replaceChildren();
      });
      await sizePlaceholders();
      // Re-render whatever is currently visible.
      slots.forEach((s) => {
        const r = s.el.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        if (r.bottom >= sr.top - 400 && r.top <= sr.bottom + 400) {
          void renderPage(Number(s.el.dataset.page));
        }
      });
    }

    zoomOut.addEventListener("click", (e) => {
      e.preventDefault();
      void applyZoom(zoom - PDF_ZOOM_STEP);
    });
    zoomIn.addEventListener("click", (e) => {
      e.preventDefault();
      void applyZoom(zoom + PDF_ZOOM_STEP);
    });

    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    await sizePlaceholders();
    void renderPage(1);
    void renderPage(2);
  } catch (err) {
    if (currentFilePath !== path) return;
    loading.classList.add("error");
    const msg = String(err);
    loading.textContent = /password|encrypt/i.test(msg)
      ? "Password-protected PDFs are not supported yet."
      : `Could not load PDF: ${msg}`;
  }
}
```

- [ ] **Step 3: Make the `updatePreview` call await the async renderer**

At `src/main.ts:1267-1270`, change:

```ts
  if (currentFilePath && isPdfPath(currentFilePath)) {
    await renderPdfPreview(previewPane, currentFilePath);
    return;
  }
```

- [ ] **Step 4: Add styles in `src/styles.css`**

```css
.pdf-preview-wrap { display: flex; flex-direction: column; height: 100%; }
.pdf-stage { overflow: auto; background: var(--bg); flex: 1; }
.pdf-pages { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px; }
.pdf-page { background: var(--surface0); box-shadow: 0 1px 6px rgba(0,0,0,0.4); }
.pdf-canvas { display: block; }
.pdf-page-label { margin-left: auto; color: var(--text); opacity: 0.8; font-size: 12px; }
.asset-preview-zoom-label { color: var(--text); font-size: 12px; min-width: 42px; text-align: center; }
```

(If `.asset-preview-zoom-label` already exists from the image viewer, skip that
rule.)

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Manual verification (`npm run tauri dev`)**

- Open a multi-page PDF → pages render top-to-bottom in a scrollable area.
- Zoom in/out → pages rescale and stay sharp; `%` label updates and persists after
  closing & reopening the PDF.
- Page indicator (`N / total`) tracks scroll.
- Open a 50+ page PDF → scrolling stays smooth (only nearby pages render).
- Open a markdown/image/CSV file → unchanged.
- Disconnect network → PDF still opens (offline worker).

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/styles.css
git commit -m "feat(pdf): render PDFs with pdfjs canvas viewer, zoom, lazy pages"
```

---

## Task 3: Update docs for the new PDF behavior

**Files:**
- Modify: `CLAUDE.md` (the `read_binary_file` line under File commands and the
  preview-pipeline description)

- [ ] **Step 1: Edit CLAUDE.md**

Update the backend `read_binary_file` note to mention it now also feeds the PDF
viewer, and add to the frontend section a line: "PDF viewing: `.pdf` files render
via `pdfjs-dist` (canvas + lazy IntersectionObserver, persisted zoom under
`kaelio-pdf-zoom`) in `renderPdfPreview`; replaced the old native `<iframe>`."

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(pdf): note pdfjs viewer in CLAUDE.md"
```

**END OF PHASE 1 — shippable here.**

---

# PHASE 2 — Text selection + search inside PDF

## Task 4: Render a selectable text layer over each page

**Files:**
- Modify: `src/main.ts` (`renderPage` inside `renderPdfPreview`)
- Modify: `src/styles.css` (text layer styles)
- Modify: import in `src/main.ts`

**Interfaces:**
- Consumes: `pdfjsLib`, the `PageSlot`/`renderPage` from Task 2.
- Produces: a `.pdf-text-layer` element per rendered page containing positioned
  spans; a module map `pdfPageText: Map<number, string>` (page → plain text) for
  Task 5 search and Phase 3 extraction.

- [ ] **Step 1: Import the text-layer CSS once (top of `src/main.ts`)**

```ts
import "pdfjs-dist/web/pdf_viewer.css";
```

- [ ] **Step 2: In `renderPage`, after the canvas renders, build the text layer**

Inside `renderPage`, replace the `slot.el.replaceChildren(canvas)` line with:

```ts
      const textLayerDiv = document.createElement("div");
      textLayerDiv.className = "textLayer pdf-text-layer";
      textLayerDiv.style.width = `${canvas.width}px`;
      textLayerDiv.style.height = `${canvas.height}px`;

      const textContent = await page.getTextContent();
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport: vp,
      });
      await textLayer.render();

      // Cache plain text for search / extraction.
      pdfPageText.set(n, textContent.items.map((i: any) => ("str" in i ? i.str : "")).join(" "));

      const pageInner = document.createElement("div");
      pageInner.className = "pdf-page-inner";
      pageInner.style.position = "relative";
      pageInner.append(canvas, textLayerDiv);
      slot.el.replaceChildren(pageInner);
```

Add near the other module-level maps (above `renderPdfPreview`):

```ts
const pdfPageText = new Map<number, string>();
```

And clear it at the start of `renderPdfPreview` (right after `previewPane.innerHTML = ""`):

```ts
  pdfPageText.clear();
```

- [ ] **Step 3: Add positioning styles in `src/styles.css`**

```css
.pdf-page-inner { position: relative; }
.pdf-text-layer { position: absolute; top: 0; left: 0; overflow: hidden; opacity: 1; line-height: 1; }
.pdf-text-layer ::selection { background: var(--accent); color: var(--bg); }
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Manual verification**

- Open a text-based PDF → drag to select text; selection highlights align with the
  rendered glyphs.
- Cmd+C copies the selected text.
- Zoom in/out → text layer stays aligned with the canvas (re-rendered on zoom).

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/styles.css
git commit -m "feat(pdf): selectable text layer over rendered pages"
```

---

## Task 5: Cmd+F search inside the open PDF

**Files:**
- Modify: `src/main.ts` (the Cmd+F handler that currently branches on view mode;
  search for the existing `"keydown"` handler that triggers preview/editor search)

**Interfaces:**
- Consumes: `pdfPageText` (Task 4), `currentFilePath`, `isPdfPath`, the page slots.
- Produces: a `searchPdf(query: string)` function that scrolls to and highlights
  matches; reuses the existing preview-search input element if present.

- [ ] **Step 1: Locate the Cmd+F dispatch**

Find where Cmd+F decides between editor search and preview search. Add a PDF branch
**before** those: if `isPdfPath(currentFilePath)`, open the preview search input
(reuse the same input element/markup the preview search uses) and route its
`input` event to `searchPdf`.

- [ ] **Step 2: Implement `searchPdf`**

Add near `renderPdfPreview`:

```ts
let pdfSearchMatches: HTMLElement[] = [];
let pdfSearchIndex = 0;

function clearPdfSearch() {
  document.querySelectorAll(".pdf-search-hit").forEach((el) => {
    el.replaceWith(...Array.from(el.childNodes));
  });
  pdfSearchMatches = [];
  pdfSearchIndex = 0;
}

function searchPdf(query: string) {
  clearPdfSearch();
  if (!query.trim()) return;
  const q = query.toLowerCase();
  const spans = Array.from(document.querySelectorAll(".pdf-text-layer span")) as HTMLElement[];
  for (const span of spans) {
    const text = span.textContent || "";
    if (!text.toLowerCase().includes(q)) continue;
    const idx = text.toLowerCase().indexOf(q);
    const before = document.createTextNode(text.slice(0, idx));
    const hit = document.createElement("mark");
    hit.className = "pdf-search-hit";
    hit.textContent = text.slice(idx, idx + q.length);
    const after = document.createTextNode(text.slice(idx + q.length));
    span.replaceChildren(before, hit, after);
    pdfSearchMatches.push(hit);
  }
  if (pdfSearchMatches.length) gotoPdfMatch(0);
}

function gotoPdfMatch(i: number) {
  if (!pdfSearchMatches.length) return;
  pdfSearchIndex = (i + pdfSearchMatches.length) % pdfSearchMatches.length;
  pdfSearchMatches.forEach((m) => m.classList.remove("active"));
  const active = pdfSearchMatches[pdfSearchIndex];
  active.classList.add("active");
  active.scrollIntoView({ block: "center" });
}
```

**Note for the implementer:** matches only exist for pages already rendered (lazy).
On search, first ensure all pages are rendered by calling `renderPage(n)` for every
page and awaiting them, *then* run `searchPdf`. Add a small `renderAllPages()`
helper that loops `renderPage` over `1..pageCount` and `await`s them; call it before
`searchPdf` when the user submits a query.

- [ ] **Step 3: Wire next/prev (Enter / Shift+Enter) to `gotoPdfMatch`**

In the search input keydown: Enter → `gotoPdfMatch(pdfSearchIndex + 1)`,
Shift+Enter → `gotoPdfMatch(pdfSearchIndex - 1)`, Escape → `clearPdfSearch()` and
close the input.

- [ ] **Step 4: Styles in `src/styles.css`**

```css
.pdf-search-hit { background: var(--yellow, #f9e2af); color: #000; }
.pdf-search-hit.active { background: var(--accent); color: var(--bg); }
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Manual verification**

- Open a PDF, press Cmd+F, type a word → all occurrences highlight, view scrolls to
  the first; Enter/Shift+Enter cycle matches; Escape clears.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/styles.css
git commit -m "feat(pdf): Cmd+F search with match highlighting in PDFs"
```

**END OF PHASE 2.**

---

# PHASE 3 — Extract PDF content to Markdown (imperfect)

## Task 6: "Extract to Markdown" command

**Files:**
- Modify: `src/main.ts` (add a context-menu / command entry + extractor)
- Reuse: `pdfPageText` and `doc.getPage(...).getTextContent()`

**Interfaces:**
- Consumes: the open PDF `doc`, `getTextContent()` items (which carry `str`,
  `transform`, `height`).
- Produces: `extractPdfToMarkdown(): Promise<string>` and a way to open the result
  in a new untitled `.md` tab (reuse whatever "new untitled file" path the editor
  already has).

- [ ] **Step 1: Add the extractor**

```ts
// Heuristic, lossy: paragraphs from line grouping, blank lines between blocks.
// No tables, no columns, no OCR.
async function extractPdfToMarkdown(doc: any): Promise<string> {
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let line = "";
    let lastY: number | null = null;
    const lines: string[] = [];
    for (const item of content.items as any[]) {
      if (!("str" in item)) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (line.trim()) lines.push(line.trim());
        line = "";
      }
      line += item.str + (item.hasEOL ? "" : " ");
      lastY = y;
    }
    if (line.trim()) lines.push(line.trim());
    // Join consecutive non-empty lines into paragraphs; blank line between pages.
    out.push(lines.join("\n"));
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
```

- [ ] **Step 2: Hook it to the UI**

When a PDF is open, add an "Extract to Markdown" entry to the file/right-click menu
(follow how existing menu items are registered, e.g. the export entries near
`src/main.ts:6139`). On click: `const md = await extractPdfToMarkdown(currentPdfDoc);`
then open a new untitled tab pre-filled with `md`. Store the active `doc` in a
module variable `currentPdfDoc` set inside `renderPdfPreview` after
`getDocument(...).promise`, and clear it when a non-PDF opens.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual verification**

- Open a text PDF → "Extract to Markdown" → a new untitled `.md` tab opens with
  readable paragraphs.
- Confirm a scanned/image-only PDF yields little/no text (expected — document this
  limitation in the menu tooltip: "best-effort, no tables/OCR").

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(pdf): extract PDF text to a Markdown tab (best-effort)"
```

**END OF PHASE 3.**

---

# PHASE 4 — Annotate PDF (highlights + notes, JSON sidecar)

> Largest and riskiest phase. The original PDF is **never modified** — annotations
> live in a sidecar JSON file next to it. "Burning" annotations into a new PDF is
> explicitly out of scope.

## Task 7: Rust sidecar read/write commands

**Files:**
- Modify: `src-tauri/src/lib.rs` (two commands + register in `invoke_handler` near
  line 3007)

**Interfaces:**
- Produces:
  - `read_annotations(pdf_path: String) -> Result<String, String>` — returns the
    sidecar JSON text, or `"[]"` if the sidecar doesn't exist.
  - `write_annotations(pdf_path: String, json: String) -> Result<(), String>` —
    writes the JSON to the sidecar.
- Sidecar path rule: `<pdf_path>.kaelio-annot.json`.

- [ ] **Step 1: Add the commands**

```rust
fn annotation_sidecar(pdf_path: &str) -> PathBuf {
    PathBuf::from(format!("{pdf_path}.kaelio-annot.json"))
}

#[tauri::command]
fn read_annotations(pdf_path: String) -> Result<String, String> {
    let p = annotation_sidecar(&pdf_path);
    if !p.exists() {
        return Ok("[]".to_string());
    }
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_annotations(pdf_path: String, json: String) -> Result<(), String> {
    let p = annotation_sidecar(&pdf_path);
    fs::write(&p, json).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register both in `invoke_handler`** (add to the list near line 3007,
  alongside `read_binary_file`).

- [ ] **Step 3: Verify Rust compiles**

Run (inside `src-tauri`): `cargo check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(pdf): sidecar read/write commands for annotations"
```

---

## Task 8: Annotation overlay + persistence (frontend)

**Files:**
- Modify: `src/main.ts` (annotation layer in `renderPage`, toolbar toggle, save)
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `read_annotations`, `write_annotations` (Task 7); the page slots and
  `currentPdfDoc`/`currentFilePath`.
- Data shape (one JSON array for the whole PDF):
  `{ page: number, type: "highlight" | "note", rectPct: {x,y,w,h}, color?: string, text?: string }`
  — coordinates stored as **page-relative percentages** so they survive zoom.

- [ ] **Step 1: Load annotations when a PDF opens**

In `renderPdfPreview`, after the doc loads:
`const annots = JSON.parse(await invoke<string>("read_annotations", { pdfPath: path })) as Annotation[];`
Keep them in a module array `pdfAnnotations` and a `pdfAnnotationsDirty = false` flag.

- [ ] **Step 2: Render an annotation layer per page**

In `renderPage`, append an absolutely-positioned `.pdf-annot-layer` over the
text layer. For each annotation whose `page === n`, draw a `div` positioned by
`rectPct` × the page width/height. Highlights are semi-transparent colored boxes;
notes show a small marker that reveals `text` on hover/click.

- [ ] **Step 3: Create highlights from a selection**

Add a toolbar "Highlight" toggle. When active and the user finishes a text
selection inside a page, compute the selection's bounding rect relative to that
page, convert to percentages, push a `{ type: "highlight", page, rectPct, color }`
annotation, re-render that page's annotation layer, set `pdfAnnotationsDirty = true`.

- [ ] **Step 4: Persist**

Add a "Save annotations" toolbar button (and save on tab close if dirty):
`await invoke("write_annotations", { pdfPath: currentFilePath, json: JSON.stringify(pdfAnnotations) }); pdfAnnotationsDirty = false; flashStatus("Annotations saved");`

- [ ] **Step 5: Styles**

```css
.pdf-annot-layer { position: absolute; top: 0; left: 0; pointer-events: none; }
.pdf-annot-highlight { position: absolute; background: rgba(249,226,175,0.4); pointer-events: auto; }
.pdf-annot-note { position: absolute; width: 14px; height: 14px; background: var(--accent); border-radius: 50%; pointer-events: auto; cursor: pointer; }
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Manual verification**

- Open a PDF, toggle Highlight, select text → a colored highlight appears over it.
- Save, close, reopen the PDF → the highlight is restored at the right place, and
  stays aligned after zooming.
- Confirm the original `.pdf` file is byte-unchanged (only the
  `.kaelio-annot.json` sidecar is written).

- [ ] **Step 8: Commit**

```bash
git add src/main.ts src/styles.css
git commit -m "feat(pdf): highlight annotations persisted to JSON sidecar"
```

- [ ] **Step 9: Update CLAUDE.md**

Note the two new Rust commands (`read_annotations`, `write_annotations`) and the
sidecar annotation model under the backend section. Commit.

**END OF PHASE 4.**

---

## Self-review notes (coverage vs. spec)

- Spec Phase 1 (view, toolbar, persisted zoom, lazy render, offline worker,
  error handling) → Tasks 1–3. ✓
- Spec Phase 2 (text layer selection + Cmd+F search) → Tasks 4–5. ✓
- Spec Phase 3 (heuristic extract to a new `.md` tab, lossy, no OCR) → Task 6. ✓
- Spec Phase 4 (overlay highlights/notes, JSON sidecar, original never mutated) →
  Tasks 7–8. ✓
- No new Rust for Phases 1–3 (reuse `read_binary_file`); Phase 4 adds exactly the
  two sidecar commands the spec calls for. ✓

## Known follow-ups (not in scope)

- Password-protected PDFs (Phase 1 shows a friendly message instead).
- Table/column-aware extraction and OCR for scanned PDFs.
- Burning annotations into an exported PDF.
- Note-type annotation creation UI (Task 8 renders notes; the spec's highlight flow
  is the committed creation path — add note creation when scheduled).
