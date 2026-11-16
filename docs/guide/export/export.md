---
title: Export and copy
summary: Save a document as PNG, JPG, PDF or DOCX, or copy it as formatted text, Markdown or plain text.
---

Kaelio exports in two families. **HTML** exports take a picture of the preview exactly as you see it. **Markdown** exports convert the source with Pandoc, which gives a real, selectable document. The Copy menu puts the document on the clipboard instead.

## When to use it

- When you want to send a note to someone who does not use Markdown.
- When you need a picture of a diagram-heavy page, exactly as it looks.
- When you want to paste a formatted document into email, a chat or a word processor.

## How to use it

### Choose an export

Choose File ▸ **Export**, or click **Export ▾** in the toolbar, then:

| Menu | Format | What you get | Needs |
|---|---|---|---|
| **HTML** | **PNG** / **JPG** | One image of the whole preview | Nothing extra |
| **HTML** | **PDF** | The preview as A4 pages. The pages are pictures, so text cannot be selected. | Nothing extra |
| **Markdown** | **PDF** | A typeset PDF with selectable text | Pandoc and Typst |
| **Markdown** | **DOCX** | A Word document | Pandoc |

A save dialog opens with the document's name and the new extension. Pick a folder and click **Save**. The status bar shows progress, then, for example, **PDF saved: notes.pdf**.

### Install Pandoc and Typst (Markdown exports only)

Markdown PDF and DOCX use tools that are not built into Kaelio. On a Mac with [Homebrew](https://brew.sh), run once in Terminal:

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
- HTML exports and the Copy menu work entirely on your computer.

> [!WARNING]
> **Markdown ▸ PDF sends diagram source online.** To draw Mermaid diagrams in a Markdown PDF, Kaelio sends each diagram's text to the public mermaid.ink service and puts the returned image in the PDF. Nothing else in the document is sent. If a diagram must stay private, use **HTML ▸ PDF**, which draws diagrams locally. If mermaid.ink cannot be reached, the diagram appears in the PDF as code.

## Next steps

- [Turn a note into a PDF](../recipes/note-to-pdf.md)
- [Troubleshooting](../reference/troubleshooting.md) if an export says Pandoc or Typst was not found.
- [Privacy](../reference/privacy.md)
