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

Right-click a file in the Explorer and choose **File History**, or open the command palette (<kbd>⌘</kbd><kbd>⇧</kbd><kbd>P</kbd>) and choose **File History** for the file you are editing. It works for any saved file, also one opened on its own without a folder.

The window shows one list, newest first. Each row has a **Commit** or **Snapshot** badge, a short description and how long ago it was taken. Hover the time to see the exact date.

- **View** shows that version beside the current one (**Selected version** and **Current**). From there, **Restore this version** puts the old text into the editor; nothing is saved until you press <kbd>⌘</kbd><kbd>S</kbd>. **← Back** returns to the list.
- **Restore** in the list brings that version back straight away.

If the list says **No history yet**, the file has no commits and you have not edited it in Kaelio long enough for a snapshot to be taken.

### Commits

Commit rows show the short commit id and the message, for the last 50 commits that changed this file. They appear only when the file is in an open folder that is a Git repository. See [Sync with Git](git-sync.md).

**Restore** on a commit writes that version to the file and reloads it.

### Snapshots

Kaelio saves a snapshot of the file you are editing a minute after you stop typing, whenever the text changed. It keeps the last 50 snapshots of each file. Snapshot rows read **Local snapshot**.

**Restore** on a snapshot puts its text into the editor if the file is open (save to keep it), or writes it to the file if it is not.

### Crash recovery

While a file has unsaved changes, Kaelio also keeps a recovery copy every 30 seconds. If Kaelio quits unexpectedly, the next launch shows **Recovered unsaved changes for** the file, with **Restore** and **Dismiss**.

## What it will not do

- Snapshots never leave your computer. They are stored in `~/.kaelio/snapshots/`, not in your folder or your repository.
- Viewing a version never changes the file. Only **Restore** does.

## Next steps

- [Sync with Git](git-sync.md)
- [Privacy](../reference/privacy.md) for every place Kaelio stores data.
