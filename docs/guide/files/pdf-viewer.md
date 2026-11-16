---
title: Read and highlight PDFs
summary: Open a PDF inside Kaelio, search and select its text, highlight passages, and pull its text into a Markdown note.
---

Kaelio opens PDFs in the preview pane, next to your notes. You can zoom, select and search text, add highlights, and turn a PDF's text into a new Markdown document. Your PDF file itself is never changed.

## When to use it

- When you read a paper or report while writing notes about it.
- When you want to mark passages in a PDF without editing the file.
- When you want a PDF's text as Markdown to quote or rework.

## How to use it

### Open and read

Click a `.pdf` file in the Explorer, or open it with File ▸ **Open File...**. Pages load as you scroll. The toolbar above the pages has, from left to right:

- **−** and **+** to zoom out and in, in 20% steps from 25% to 400%, with the current zoom between them. Kaelio remembers your zoom for every PDF.
- **H** to turn highlight mode on and off.
- **Save** to save your highlights.
- The current page, for example **3 / 12**.

### Select and search text

Drag across text to select it, then copy it with <kbd>⌘</kbd><kbd>C</kbd>. Press <kbd>⌘</kbd><kbd>F</kbd> to search the whole PDF: type in **Search in preview…**, press <kbd>Return</kbd> for the next match, <kbd>⇧</kbd><kbd>Return</kbd> for the previous one, and <kbd>Esc</kbd> to close.

### Highlight passages

1. Click **H**. The status bar says **PDF highlight mode on**.
2. Drag across the text you want to mark. A yellow highlight appears when you let go.
3. Click **Save**. Kaelio also saves highlights by itself when you switch to another file or close the tab.
4. Click **H** again to go back to normal selection.

Highlights are stored next to the PDF in a small file named after it, for example `report.pdf.kaelio-annot.json`. Keep that file with the PDF if you move it, and your highlights come along.

### Turn a PDF into Markdown

1. Right-click the PDF in the Explorer and choose **Extract to Markdown**, or open the PDF and choose **Extract PDF to Markdown** from the [Command Palette](search.md).
2. A new, unsaved tab opens with the PDF's text, named after the PDF with `.md`.
3. Read it through and save it with <kbd>⌘</kbd><kbd>S</kbd>.

Extraction groups text into lines and paragraphs by its position on the page. It works well for ordinary text; tables, multiple columns and scanned pages (which have no text to select) do not come through.

## What it will not do

- It never writes into the PDF. Highlights live only in the separate `.kaelio-annot.json` file.
- Extract to Markdown never saves a file for you; the new tab stays unsaved until you save it.
- Password-protected PDFs do not open yet.
- Highlights come in one colour, and there is no button to remove one yet. To remove all highlights from a PDF, delete its `.kaelio-annot.json` file.

## Next steps

- [Explorer, tabs and windows](explorer-and-tabs.md)
- [Images and other files](images-and-other-files.md)
- [Split view and compare](../writing/split-view.md) to read a PDF beside your notes.
