---
title: Sync with Git
summary: Connect a folder to a GitHub repository once, and Kaelio commits and pushes each file when you save it.
---

Kaelio can keep a folder of notes backed up on GitHub. You set it up once with a repository URL; after that, every save becomes a commit that is pushed in the background, and opening the folder pulls what changed elsewhere. You never need to open a terminal or type a Git command.

## When to use it

- When you want your notes backed up off your computer.
- When you write on more than one computer and want the same files on each.
- When you want a history of every version of every file.

## How to use it

### Before you start

You need a GitHub account and a way for your computer to sign in to it. Either of these works:

- The GitHub CLI: run `gh auth login` once in Terminal.
- An SSH key added to your GitHub account (`~/.ssh/id_ed25519` or `~/.ssh/id_rsa`, or a key loaded in ssh-agent).

### Set up sync

1. Open the folder with your notes: File ▸ **Open Folder...**.
2. In the Explorer header, click **⎇** (**Toggle Git Panel**).
3. Click **Set up Sync**. The dialog checks your sign-in and shows **✓ GitHub connection found**, or tells you how to sign in.
4. On GitHub, create a new private repository (the dialog links to it), and copy its URL.
5. Paste the URL into **Repository URL** and click **Connect & Sync**. `you/my-notes` also works; Kaelio fills in the rest.

Kaelio makes the folder a Git repository if it is not one yet, adds a `.gitignore` for system files such as `.DS_Store`, makes a first commit called **Initial sync**, and pushes it. The status bar flashes **Sync connected!**, and auto-sync is now on.

### What happens when you save

With auto-sync on, each <kbd>⌘</kbd><kbd>S</kbd> commits only the file you saved, with the message `Update` followed by the file name, and pushes it. The status bar shows **✓ Synced** when the push worked. When you open the folder again, Kaelio first pulls changes from GitHub.

### The Git panel

The panel lists changed files with a coloured dot, and the same dot appears beside the file in the Explorer:

| Dot | Meaning |
|---|---|
| Orange | Edited since the last commit |
| Green | New file, not committed yet |
| Red | Deleted |
| Accent colour | Staged for the next commit |
| Magenta | Conflict: needs your choice |

- To commit everything at once, type a message in **Describe your changes…** and click **Save** (or leave it empty for an automatic message).
- Click **⟳** (**Sync now**) to pull and push straight away.
- The status bar shows **✓ Synced**, **⟳ N unsaved** (commits not pushed yet) or **Local only** (no GitHub repository connected).

### When the same file changed in two places

If a pull brings changes to lines you also changed, a **Resolve** window opens with **Your version** and **Incoming version** side by side. Choose **Keep yours**, **Accept incoming** or **Keep both** (yours, then the incoming text). The status bar says **N files need attention** while any remain. After resolving, save once more to commit the result.

### Throw away an edit

Right-click a changed file in the Explorer and choose **Discard Changes** to put it back to its last committed version.

> [!WARNING]
> **Discard Changes** does not ask for confirmation. Your unsaved and uncommitted edits to that file are gone, though an earlier [snapshot](history-and-snapshots.md) may still have them.

## What it will not do

- It never overwrites your local edits when pulling. If a pull would replace files you changed, it stops with **Pull stopped: local changes would be overwritten** and leaves everything as it was.
- It never commits files you did not save; auto-sync commits only the saved file.
- It never stores your GitHub password. Sign-in uses your SSH key or your system's Git credential helper, such as the macOS Keychain or `gh`.
- It does not set up a folder that sits inside another Git repository; open the outer folder instead.

## Next steps

- [File history and snapshots](history-and-snapshots.md)
- [Sync notes between two computers](../recipes/sync-two-computers.md)
- [Troubleshooting](../reference/troubleshooting.md) if sign-in or pushing fails.
