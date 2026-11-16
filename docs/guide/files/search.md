---
title: Search and the Command Palette
summary: Find a file by name, search the text of every note in a folder, and run any command by typing its name.
---

Kaelio has three search boxes: one for file names, one for the text inside files, and the Command Palette for everything you can do.

## When to use it

- When you know part of a file's name and want to open it fast.
- When you remember a phrase but not which note it is in.
- When you do not remember where a command lives in the menus.

## How to use it

### File Search: find a file by name

1. Press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>F</kbd>, or choose Search ▸ **File Search**.
2. Type part of the name or path in **Search files…**.
3. Pick a result to open it.

It looks through the open folder and up to five levels of subfolders, and skips system and build folders such as `.git` and `node_modules`. You need a folder open.

### Search in Files: find text inside notes

1. Press <kbd>⌘</kbd><kbd>⌥</kbd><kbd>F</kbd>, choose Search ▸ **Search in Files**, or click **⌕** at the top of the Explorer.
2. Type in **Search in files…**. Results appear as you type.
3. Click a result to open the file at that line.

It matches file names in every file and the text of `.md`, `.markdown` and `.txt` files, ignoring upper and lower case. Click the Explorer's title to go back to the file list.

### Command Palette: do anything

Press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>P</kbd> and type a few letters of what you want, for example `export` or `theme`, then press <kbd>Return</kbd>. A few commands live only here:

- **Toggle Auto-save**
- **Cycle Theme** and **Cycle Font**
- **Reload Custom CSS**

### Find in the current file

<kbd>⌘</kbd><kbd>F</kbd> finds and replaces in the editor, or searches the preview in Reading View. See [The editor and the preview](../writing/editor-and-preview.md).

## What it will not do

- Search in Files skips files larger than 1 MB and shows at most 200 results.
- Search never changes files.

## Next steps

- [Keyboard shortcuts](../reference/keyboard-shortcuts.md)
- [Explorer, tabs and windows](explorer-and-tabs.md)
