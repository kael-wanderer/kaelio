---
title: Images and other files
summary: How Kaelio shows images, SVG, HTML, JSON, CSV and plain text files, and which of them you can edit.
---

Kaelio is a Markdown editor first, but it opens most files you keep beside your notes. Each kind gets a preview that suits it.

## When to use it

- When a notes folder also holds screenshots, data files or web pages.
- When you want to glance at a file without opening another app.

## How to use it

Click the file in the Explorer. What you see depends on its kind:

| Kind | Preview | Can you edit it? |
|---|---|---|
| Markdown (`.md`, `.markdown`) | The formatted page | Yes |
| Images: PNG, JPG, GIF, WEBP, BMP, ICO, AVIF, and SVG | The picture, with zoom | No |
| PDF | Pages with search and highlights; see [Read and highlight PDFs](pdf-viewer.md) | No |
| HTML (`.html`, `.htm`) | The rendered page. Scripts in it do not run. | Yes, as text |
| JSON | Neatly indented. Invalid JSON is shown as it is. | Yes |
| CSV | A table, first row as the header, up to 200 rows | Yes |
| Other text: `.txt`, YAML, code, logs and more | Plain text | Yes |

Images, SVG and PDFs open in the preview only. Use **−** and **+** above an image to zoom from 25% to 500%.

Files that are not text, such as a ZIP archive, do not open: Kaelio says **Could not open this file. Kaelio supports text files; binary files are not editable.**

## What it will not do

- It never changes an image, SVG or PDF. Saving one is refused with **Preview-only file**.
- It never runs scripts from an HTML file you preview.

## Next steps

- [Read and highlight PDFs](pdf-viewer.md)
- [Explorer, tabs and windows](explorer-and-tabs.md)
