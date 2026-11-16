---
title: The editor and the preview
summary: Write in the editor, read in the preview, switch between split, editor-only and Reading View, and find text in either.
---

Kaelio shows your document twice: the Markdown source in the editor, and the formatted page in the preview. You choose whether to see both, only the editor, or only the preview.

## When to use it

- When you write and want to see the result as you type.
- When you only want to read a document without the source in the way.
- When you want to jump from a paragraph in the preview to its line in the source.

## How to use it

### Choose a view

| View | How | Shows |
|---|---|---|
| Split (the default) | — | Editor on the left, preview on the right |
| Editor only | **Show/Hide Preview**, <kbd>⌘</kbd><kbd>⌥</kbd><kbd>P</kbd> | The source, full width |
| **Reading View** | <kbd>⌘</kbd><kbd>E</kbd> | The preview, in a centred reading column |

The same three are buttons on the activity bar at the far left. Kaelio remembers your choice.

In Reading View, the text sits in a centred column. Choose its width under **View → Reading Width**: Narrow, Medium (the default), Wide or Full. Wide tables and diagrams scroll sideways inside the column. Split view always uses the full pane.

### Move between source and preview

- Click any paragraph in the preview, and the editor's cursor jumps to that line.
- Click **⇆** (**Sync Editor & Preview Scroll**) on the activity bar to keep the two scrolled to the same place as you move through a long document.

### The formatting bar

Above the editor, the formatting bar inserts Markdown for you: **Bold**, **Italic**, **Heading** (a level-3 heading), **Link**, **Code**, **Quote**, **List** and **Horizontal Rule**. Select text first to wrap it, or click with nothing selected to insert an example.

### Smart paste

- **Rich text becomes Markdown.** Copy a formatted page, for example an answer from a chat window or a web article, and paste it into the editor: headings, lists, tables, links, bold, italic, code and quotes arrive as Markdown.
- **A URL over selected text becomes a link.** Select some words and paste a single `http://` or `https://` address; you get `[the words](address)`. Square brackets in the words are escaped so the link stays valid, and an address with parentheses is wrapped in `<…>`. If the selection runs over more than one line, the address pastes as plain text.
- Text copied from a code editor or a terminal pastes as plain text, with its indentation.
- Inside a code block or inline code, paste is always plain.
- Press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>V</kbd> (**Paste as Plain Text**) to paste the clipboard's plain text without any conversion.
- One <kbd>⌘</kbd><kbd>Z</kbd> undoes a whole paste.

Smart paste works in Markdown files only; in HTML, YAML and other text files paste is always plain. Images and data-URL pictures are not converted; paste an image on its own to save it to `assets/`.

### Find and replace

- In the editor, press <kbd>⌘</kbd><kbd>F</kbd> to open the find bar. It also has a replace field, with buttons to replace one match or all of them.
- In **Reading View**, <kbd>⌘</kbd><kbd>F</kbd> searches the preview instead. Type in **Search in preview…**; <kbd>Return</kbd> goes to the next match, <kbd>⇧</kbd><kbd>Return</kbd> to the previous one, <kbd>Esc</kbd> closes.

### Outline and line numbers

- Click **¶** (**Toggle Outline**) at the top of the Explorer, or press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>O</kbd>, to list the document's headings. Click one to jump to it; in **Reading View** the preview scrolls to that heading. The entry for the heading at the top of the view is highlighted as you scroll.
- Click **#** on the activity bar (**Show / Hide Line Numbers**) to turn line numbers on or off.

### See what changed on disk

When another program (for example an AI agent) changes the open file and you have no unsaved edits, Kaelio reloads it and marks each changed block in the preview with a coloured bar on its left. If text was only removed, the block after the removal point is marked.

The status bar shows a chip such as **2 changes ↓**. Click it to scroll to the next changed block; it wraps around to the first. Click **×** on the chip to clear the marks. They also clear when you type in the editor, when you switch to another file, and at the next reload.

If you have unsaved edits, the **File changed on disk** banner appears instead; choosing **Reload** there marks the changes the same way. Files longer than 20,000 lines reload without marks.

### Status bar

The status bar at the bottom shows the cursor's line and column, and the word and character counts, which update as you type.

## What it will not do

- The preview never changes your file, with two exceptions you start yourself: ticking a checkbox and removing a tag pill. Both edit the source, and you save as usual.

## Next steps

- [Callouts, checklists, diagrams and math](markdown-features.md)
- [Split view and compare](split-view.md)
- [Appearance and settings](../reference/appearance.md) for fonts, sizes and soft wrap.
