---
title: Sync notes between two computers
summary: Put a notes folder on GitHub from one computer and keep a second computer in step with it.
---

With Git sync set up on both computers, each save goes up to GitHub and each time you open the folder, the other computer's changes come down.

## When to use it

- When you write on a desktop and a laptop and want the same notes on both.

## How to use it

### On the first computer

1. Open your notes folder in Kaelio.
2. Create an empty private repository on GitHub.
3. Open the Git panel (**⎇**), click **Set up Sync**, paste the repository URL and click **Connect & Sync**. Your notes are pushed to GitHub.

### On the second computer

1. Sign in to GitHub on this computer too (`gh auth login`, or an SSH key).
2. Download the notes once by cloning the repository. In Terminal, run `git clone https://github.com/you/my-notes.git` in the folder where you want them, or use **Clone repository** in GitHub Desktop.
3. Open the cloned folder in Kaelio with File ▸ **Open Folder...**.
4. Open the Git panel, click **Set up Sync**, paste the **same** repository URL and click **Connect & Sync**. This turns on auto-sync on this computer.

> [!WARNING]
> Do not run **Set up Sync** in an empty folder on the second computer. It would start a separate history that cannot be merged with the first computer's notes.

### Every day

- Save as usual. Each save is committed and pushed.
- When you sit down at the other computer, open the folder (or click **⟳**) to pull the latest changes before you start writing.
- If you edited the same lines on both computers, Kaelio opens the **Resolve** window so you can choose **Keep yours**, **Accept incoming** or **Keep both**.

## What it will not do

- It never overwrites edits you have not committed when it pulls; it stops and tells you instead.

> [!TIP]
> Pull before you write. Conflicts only happen when both computers change the same lines before either has synced.

## Next steps

- [Sync with Git](../git/git-sync.md)
- [Troubleshooting](../reference/troubleshooting.md)
