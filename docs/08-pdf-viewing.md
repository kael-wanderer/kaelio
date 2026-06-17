# 08-pdf-viewing

> **In-app PDF viewing (0.9.5+).** Opening a `.pdf` renders it with `pdfjs-dist`
> inside the preview pane — replacing the old native `<iframe>`, which was an
> opaque black box with no access to text or pages. The PDF.js renderer is the
> foundation for selection, search, extraction, and annotation. Everything runs in
> the frontend; the PDF.js worker is bundled via Vite so it works offline.

PDF viewing lives in `renderPdfPreview` (`src/main.ts`), reached through
`isPdfPath` → `updatePreview`. Bytes are read with the existing Rust
`read_binary_file` command (base64 → `Uint8Array`), so no PDF-specific backend is
needed except the annotation sidecar (below).

## Capabilities

| Capability | How it works |
|------------|--------------|
| **View** | Each page renders to a `<canvas>` in a continuous, scrollable column. Pages render lazily via an `IntersectionObserver` (placeholders sized up front so scroll height is correct). A toolbar shows zoom in/out and a `current / total` page indicator that tracks scroll. |
| **Zoom** | Persisted across opens in `localStorage` under `kaelio-pdf-zoom`. Re-rendering on zoom keeps canvas and text layer aligned. |
| **Select & copy** | A transparent PDF.js text layer (`.pdf-text-layer`) is positioned over each canvas, giving native text selection and Cmd+C copy. |
| **Search** | Cmd+F (when a PDF is open) highlights matches across the text layer with next/previous (Enter / Shift+Enter) and Escape to clear. |
| **Extract to Markdown** | `extractPdfToMarkdown` walks each page's text content, groups lines by vertical position into paragraphs, and opens the result in a new untitled `.md` tab. Heuristic and lossy — no tables, columns, or OCR. |
| **Annotate** | Highlight selected text; annotations are stored as page-relative percentages so they survive zoom, and persisted to a JSON sidecar. The original PDF is never modified. |

## Annotation sidecar

Annotations are saved next to the PDF as `<pdf_path>.kaelio-annot.json` via two
Rust commands in `src-tauri/src/lib.rs`:

- `read_annotations(pdf_path) -> String` — returns the sidecar JSON, or `"[]"` if
  it doesn't exist.
- `write_annotations(pdf_path, json)` — writes the sidecar.

Each entry: `{ page, type: "highlight" | "note", rectPct: {x,y,w,h}, color?, text? }`.
Storing coordinates as percentages of the page (not pixels) keeps highlights
aligned regardless of the current zoom.

## Constraints & known limits

- Works fully offline — the PDF.js worker is a bundled Vite asset, never a CDN URL.
- Password-protected/encrypted PDFs are not supported; the viewer shows a friendly
  message instead of failing silently.
- Extraction is best-effort: scanned (image-only) PDFs yield little/no text (no
  OCR), and tables/multi-column layouts extract poorly.
- Annotation creation currently covers highlights; note-type entries render but
  have no creation UI yet.

## Relationship to PDF export

This is the **reading** side. PDF *export* (markdown → PDF via Pandoc/Typst) is a
separate subsystem — see [04-pdf-export](04-pdf-export.md).
