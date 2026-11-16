---
title: Split view and compare
summary: Open a second pane with its own tabs to edit or read another file beside the first, or compare two files side by side.
---

Split view adds a second pane to the right of the window. It has its own tabs, its own zoom, and can show a file as source or as preview. Use it to keep a reference open while you write, or to look at two files together.

## When to use it

- When you write one document while reading another.
- When you want to compare two versions of a file by eye.
- When you read one note and take notes about it in another at the same time.

## How to use it

### Open the second pane

- Click **⊟** (**Toggle Split View**) on the activity bar. The current file opens in the second pane too.
- Or right-click a file in the Explorer and choose **Open in Split Window**.

The second pane has a narrow bar of its own:

- **Toggle Sub Pane Edit / Preview** switches that pane between source and preview.
- **Sub Pane Line Numbers** shows or hides its line numbers.
- **Sub Pane Zoom Out** and **Sub Pane Zoom In** change its text size without touching the main pane.

### Save the right file

<kbd>⌘</kbd><kbd>S</kbd> saves the pane you last clicked in. Each pane's tabs show **●** when they have unsaved changes.

### Compare two files

1. Right-click the first file in the Explorer and choose **Select for Compare**. The status bar says **Selected for compare:** and the name.
2. Right-click the second file and choose **Compare with Selected**.

The first file opens on the left and the second on the right. This is a side-by-side view for reading, not a line-by-line diff.

### Close the second pane

Click **⊟** again. If files in the second pane have unsaved changes, Kaelio asks whether to save them first.

## What it will not do

- Kaelio shows at most two panes.
- Split view is restored after you quit, along with the main pane's tabs: the second pane's tabs, its active tab and its edit or preview mode come back on the next launch. A file that no longer exists is skipped.

## Next steps

- [Compare two files](../recipes/compare-two-files.md)
- [Images and other files](../files/images-and-other-files.md)
- [Explorer, tabs and windows](../files/explorer-and-tabs.md)
