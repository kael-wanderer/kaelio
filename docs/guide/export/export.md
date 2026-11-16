---
title: Export and copy
summary: Save a document as PDF, DOCX or PNG, or copy it as formatted text, Markdown or plain text.
---

Kaelio exports a document three ways. **PDF** and **DOCX** convert the Markdown source with Pandoc, which gives a real, selectable document. **PNG** takes a picture of the preview exactly as you see it. The Copy menu puts the document on the clipboard instead.

## When to use it

- When you want to send a note to someone who does not use Markdown.
- When you need a picture of a diagram-heavy page, exactly as it looks.
- When you want to paste a formatted document into email, a chat or a word processor.

## How to use it

### Choose an export

Choose File ▸ **Export**, or click **Export ▾** in the toolbar, then:

| Item | What you get | Works for | Needs |
|---|---|---|---|
| **PDF…** | A typeset PDF with selectable text | Markdown and text files | Pandoc and Typst |
| **DOCX…** | A Word document | Markdown and text files | Pandoc |
| **PNG…** | One image of the whole preview | Markdown and HTML | Nothing extra |

For an HTML file, **PDF…** and **DOCX…** are greyed out and marked **Markdown only**.

A save dialog opens with the document's name and the new extension. Pick a folder and click **Save**. The status bar shows progress, then, for example, **PDF saved: notes.pdf**.

### Diagrams

Mermaid diagrams are drawn on your computer and placed in the PDF or DOCX as pictures, on a light background. Nothing is sent online. A diagram with a mistake in it stays in the document as code, and the rest of the export goes ahead.

### Install Pandoc and Typst

PDF and DOCX use tools that are not built into Kaelio. On a Mac with [Homebrew](https://brew.sh), run once in Terminal:

```bash
brew install pandoc
brew install typst
```

Kaelio looks for them in `/opt/homebrew/bin`, `/usr/local/bin`, then your `PATH`. You do not need a TeX installation.

### Copy instead of export

Click **Copy ▾** in the toolbar:

- **Copy Formatted**: the rendered document, with headings, lists and tables, ready to paste into email or a word processor. Clicking the **Copy** button itself does the same. Shortcut: <kbd>⌘</kbd><kbd>⇧</kbd><kbd>C</kbd>.
- **Copy Raw Markdown**: the whole source text.
- **Copy Plain Text**: the rendered text with no formatting.

The same three are in the Edit menu as **Copy Formatted HTML**, **Copy Raw Markdown** and **Copy Plain Text**.

## What it will not do

- It never overwrites a file without the save dialog asking you first.
- Export and the Copy menu work entirely on your computer; nothing is sent online.
- There is no JPG export and no picture-based PDF any more. Use PNG for a picture.

## Next steps

- [Turn a note into a PDF](../recipes/note-to-pdf.md)
- [Troubleshooting](../reference/troubleshooting.md) if an export says Pandoc or Typst was not found.
- [Privacy](../reference/privacy.md)
