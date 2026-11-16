---
title: Turn a note into a PDF
summary: Install Pandoc and Typst once, then export a note as a PDF with selectable text and local diagrams.
---

Kaelio makes a PDF from a Markdown note with Pandoc and Typst. The result is a properly typeset document with text you can select and search. Diagrams are drawn on your computer.

## When to use it

- When you need to send a Markdown document as a PDF.

## How to use it

### 1. Install Pandoc and Typst once

In Terminal, with [Homebrew](https://brew.sh):

```bash
brew install pandoc
brew install typst
```

### 2. Check the diagrams

Mermaid diagrams become pictures in the PDF, drawn locally on a light background. If a diagram has a mistake, it stays in the PDF as code; fix it in the preview first if you want the picture.

### 3. Export

Choose File ▸ **Export** ▸ **PDF…**, pick a folder in the save dialog, and click **Save**. The status bar says **PDF saved:** and the file name.

If you want a picture of the preview exactly as it looks instead, use **PNG…**.

## What it will not do

- It does not change your Markdown file.
- It does not export an HTML file to PDF; for HTML, use **PNG…**.

## Next steps

- [Export and copy](../export/export.md)
- [Troubleshooting](../reference/troubleshooting.md) if Pandoc or Typst is not found.
