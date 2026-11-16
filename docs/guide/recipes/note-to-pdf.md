---
title: Turn a note into a PDF
summary: Choose the right PDF export, install what it needs, and keep private diagrams on your computer.
---

Kaelio makes PDFs two ways. Which one you want depends on whether the reader needs to select text and whether the document has private diagrams.

## When to use it

- When you need to send a Markdown document as a PDF.

## How to use it

### 1. Pick the export

| You want | Use |
|---|---|
| A PDF that looks exactly like the preview, with nothing to install | File ▸ **Export** ▸ **HTML** ▸ **PDF** |
| A properly typeset PDF with selectable, searchable text | File ▸ **Export** ▸ **Markdown** ▸ **PDF** |

The HTML PDF is made of pictures of the preview, so its text cannot be selected or searched. The Markdown PDF is real text.

### 2. For the Markdown PDF, install Pandoc and Typst once

In Terminal, with [Homebrew](https://brew.sh):

```bash
brew install pandoc
brew install typst
```

### 3. Check the diagrams

If the note has Mermaid diagrams, the Markdown PDF sends each diagram's text to the public mermaid.ink service to draw it. If the diagrams are private, use the HTML PDF instead: it draws them on your computer.

### 4. Export

Choose the export, pick a folder in the save dialog, and click **Save**. The status bar says **PDF saved:** and the file name.

## What it will not do

- Neither export changes your Markdown file.

## Next steps

- [Export and copy](../export/export.md)
- [Troubleshooting](../reference/troubleshooting.md) if Pandoc or Typst is not found.
