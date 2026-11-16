---
title: File history and snapshots
summary: See earlier versions of a file, from Git commits or from Kaelio's automatic snapshots, compare them and restore one.
---

Kaelio keeps two kinds of history for every file. **Commits** come from Git, if the file is in a synced folder. **Snapshots** are copies Kaelio saves by itself while you write, with or without Git. Both are in one window.

## When to use it

- When you deleted a paragraph and want it back.
- When you want to see what a file looked like last week.
- When an edit went wrong and you want to start again from an earlier version.

## How to use it

### Open the history

Right-click a file in the Explorer and choose **File History**. The window has two tabs, **Commits** and **Snapshots**.

### Commits

The **Commits** tab lists the last 50 commits that changed this file, newest first, with the message, the author and how long ago.

- **View** shows that version beside the current one (**Selected version** and **Current**). From there, **Restore this version** puts the old text into the editor; nothing is saved until you press <kbd>⌘</kbd><kbd>S</kbd>. **← Back** returns to the list.
- **Restore** in the list writes that version to the file straight away and reloads it.

The tab is empty if the folder is not a Git repository. See [Sync with Git](git-sync.md).

### Snapshots

Kaelio saves a snapshot of the file you are editing a minute after you stop typing, whenever the text changed. It keeps the last 50 snapshots of each file.

- **View** shows the snapshot beside the current text.
- **Restore** puts the snapshot's text into the editor if the file is open (save to keep it), or writes it to the file if it is not.

If the tab says **No snapshots yet**, you have not edited this file in Kaelio long enough for one to be taken.

### Crash recovery

While a file has unsaved changes, Kaelio also keeps a recovery copy every 30 seconds. If Kaelio quits unexpectedly, the next launch shows **Recovered unsaved changes for** the file, with **Restore** and **Dismiss**.

## What it will not do

- Snapshots never leave your computer. They are stored in `~/.kaelio/snapshots/`, not in your folder or your repository.
- Viewing a version never changes the file. Only **Restore** does.

## Next steps

- [Sync with Git](git-sync.md)
- [Privacy](../reference/privacy.md) for every place Kaelio stores data.
