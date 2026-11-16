---
title: Explorer, tabs and windows
summary: Browse a folder in the Explorer, create, rename, move and delete files, work in tabs, and open more windows.
---

The Explorer on the left shows the folder you opened. Open files appear as tabs above the editor. Kaelio reopens your folder and tabs when you start it again.

## When to use it

- When you work across many files in one folder.
- When you want to add, rename or move notes without switching to Finder.

## How to use it

### Open a folder or a file

- File ▸ **Open Folder...** shows a folder in the Explorer. You can also drag a folder from Finder onto the window.
- File ▸ **Open File...** (<kbd>⌘</kbd><kbd>O</kbd>) opens one file in a tab. Dragging a file onto the editor does the same.
- <kbd>⌘</kbd><kbd>B</kbd> shows or hides the Explorer.

The Explorer lists every file in the folder, folders first. Hidden files (names starting with a dot) are not shown. Click a folder to open or close it, and a file to open it. Changes made in Finder or other apps appear by themselves.

The path above the editor shows where the current file is. Click a folder in that path to make it the Explorer's top folder.

### The Explorer's buttons

From left to right at the top of the Explorer: **Search in folder** (⌕), **Refresh file list** (↻), **New File** (+), **New Folder**, **Toggle Git Panel** (⎇), **Toggle Outline** (¶) and **Close Sidebar** (✕).

### Right-click a file or folder

| Item | What it does |
|---|---|
| **New File**, **New Folder** | Ask for a name and create it in this folder. |
| **Rename** | Edit the name in place. <kbd>Return</kbd> confirms, <kbd>Esc</kbd> cancels. |
| **Duplicate** | Make a copy beside it. |
| **Copy Path** ▸ **Absolute Path** / **Relative Path** | Copy where the file is. |
| **Reveal in Finder** | Show it in Finder. |
| **Open in Split Window** | Open it in the [second pane](../writing/split-view.md). |
| **Select for Compare**, **Compare with Selected** | Show two files side by side. |
| **File History** | Earlier versions: see [File history and snapshots](../git/history-and-snapshots.md). |
| **Discard Changes** | Put a changed file back to its last Git commit. |
| **Delete** | Asks first, then moves it to the Trash. |

### Move and copy files

- Drag a file or folder inside the Explorer onto another folder to **move** it there. Drop it on the empty space below the list to move it to the top folder.
- Drag files or folders from Finder onto a folder in the Explorer to **copy** them in. Hover over a closed folder for a moment and it opens. If a name is already taken, the copy gets a new name; nothing is replaced.

### Tabs

- Each open file has a tab. **●** on a tab means it has unsaved changes.
- Close a tab with its **✕**, a middle-click, or <kbd>⌘</kbd><kbd>W</kbd>. Right-click a tab for **Close**, **Close Others**, **Close to the Right** and **Close All**.
- When you close a tab with unsaved changes, Kaelio asks **Save changes to** the file. Click **Confirm** to save.

> [!WARNING]
> In that question, **Cancel** closes the tab *without saving*; it does not keep the tab open. To keep editing, save with <kbd>⌘</kbd><kbd>S</kbd> before closing, or turn on auto-save.

### When a file changes on disk

If another app changes a file you have open, Kaelio reloads it by itself. If you also have unsaved changes, it asks instead: **File changed on disk.** with **Reload** (take the version on disk) and **Keep mine**.

### Session restore and more windows

- When Kaelio starts, it reopens the last folder and the files you had open, with their scroll and cursor positions. Turn this off in **Appearance Settings** ▸ **Session** ▸ **Restore last session**. Unsaved text is not part of the session; [crash recovery](../git/history-and-snapshots.md) covers that.
- File ▸ **New Window** (<kbd>⌘</kbd><kbd>⇧</kbd><kbd>N</kbd>) opens another Kaelio window. Only the first window's tabs are restored next time.

## What it will not do

- **Delete** never erases a file outright. It goes to the system Trash, or, if the Trash cannot be used, to `~/.kaelio/trash`.
- Copying in from Finder never overwrites a file with the same name.

## Next steps

- [Search and the Command Palette](search.md)
- [Images and other files](images-and-other-files.md)
