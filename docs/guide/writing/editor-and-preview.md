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
| Editor only | **Show/Hide Preview**, <kbd>⌘</kbd><kbd>P</kbd> | The source, full width |
| **Reading View** | <kbd>⌘</kbd><kbd>E</kbd> | The preview, full width |

The same three are buttons on the activity bar at the far left. Kaelio remembers your choice.

### Move between source and preview

- Click any paragraph in the preview, and the editor's cursor jumps to that line.
- Click **⇆** (**Sync Editor & Preview Scroll**) on the activity bar to keep the two scrolled to the same place as you move through a long document.

### The formatting bar

Above the editor, the formatting bar inserts Markdown for you: **Bold**, **Italic**, **Heading** (a level-3 heading), **Link**, **Code**, **Quote**, **List** and **Horizontal Rule**. Select text first to wrap it, or click with nothing selected to insert an example.

### Find and replace

- In the editor, press <kbd>⌘</kbd><kbd>F</kbd> to open the find bar. It also has a replace field, with buttons to replace one match or all of them.
- In **Reading View**, <kbd>⌘</kbd><kbd>F</kbd> searches the preview instead. Type in **Search in preview…**; <kbd>Return</kbd> goes to the next match, <kbd>⇧</kbd><kbd>Return</kbd> to the previous one, <kbd>Esc</kbd> closes.

### Outline and line numbers

- Click **¶** (**Toggle Outline**) at the top of the Explorer, or press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>O</kbd>, to list the document's headings. Click one to jump to it; in **Reading View** the preview scrolls to that heading. The entry for the heading at the top of the view is highlighted as you scroll.
- Click **#** on the activity bar (**Show / Hide Line Numbers**) to turn line numbers on or off.

### Status bar

The status bar at the bottom shows the cursor's line and column, and the word and character counts, which update as you type.

## What it will not do

- The preview never changes your file, with two exceptions you start yourself: ticking a checkbox and removing a tag pill. Both edit the source, and you save as usual.

## Next steps

- [Callouts, checklists, diagrams and math](markdown-features.md)
- [Split view and compare](split-view.md)
- [Appearance and settings](../reference/appearance.md) for fonts, sizes and soft wrap.
