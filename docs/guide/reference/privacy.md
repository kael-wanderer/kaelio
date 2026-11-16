---
title: Privacy
summary: No account and no telemetry. What Kaelio stores on your computer, and the few times it goes online.
---

Kaelio is an editor for files on your computer. There is no account, no sign-in to Kaelio and no telemetry: it sends no usage data, crash reports or analytics anywhere.

## When to use it

- When you want to know exactly when Kaelio uses the network.
- When you want to know which files Kaelio writes, to back them up or remove them.

## How to use it

### What Kaelio stores, and where

| What | Where |
|---|---|
| Open folder and tabs, for session restore | `~/.kaelio/session.json` |
| Automatic snapshots (last 50 per file) | `~/.kaelio/snapshots/` |
| Crash-recovery copies of unsaved files | `~/.kaelio/recovery/` |
| Deleted files, only when the system Trash is unavailable | `~/.kaelio/trash/` |
| Your preview style, if you add one | `~/.kaelio/preview.css` |
| Settings: theme, font, sizes, shortcuts, recent files | Kaelio's own app storage on this computer |

To remove everything Kaelio keeps, quit it and delete the `~/.kaelio` folder.

### When Kaelio goes online

Only for these:

- **Update check.** At launch, once a day while Kaelio is open (unless you turn that off), and when you choose Help ▸ **Check for Updates...**, Kaelio reads its release information from GitHub (`github.com/kael-wanderer/kaelio`). It downloads an update from there only when you click **Install and Restart**.
- **The guide.** Help ▸ **Kaelio Guide** opens this guide (`kael.io.vn`) in your browser.
- **Git sync,** only if you set it up. Kaelio pulls from and pushes to the repository you connected, and nowhere else. See [Sync with Git](../git/git-sync.md).
- **Pictures from the web in your documents.** If a document shows an image by its web address (`![](https://…)`), the preview loads it from that address, as a browser would.

- **HTML pages you run scripts for.** Scripts are off by default. When you click **Run scripts** on an HTML page, the page may load scripts, styles, fonts and data from the `https://` addresses it names, as it would in a browser. It runs in an isolated frame with no access to Kaelio or your other files. See [Images and other files](../files/images-and-other-files.md).

Export never goes online: Mermaid diagrams in a PDF or DOCX are drawn on your computer. See [Export and copy](../export/export.md).

Links you click to web pages open in your browser, not in Kaelio. PDFs and images you click open in your default app.

## What it will not do

- It never uploads your documents anywhere except the Git repository you chose.
- It never reads files outside the folders and files you open.

## Next steps

- [File history and snapshots](../git/history-and-snapshots.md)
- [Troubleshooting](troubleshooting.md)
