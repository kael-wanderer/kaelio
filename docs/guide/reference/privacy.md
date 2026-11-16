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
| PDF highlights | Next to the PDF, as a `.kaelio-annot.json` file named after the PDF |
| Settings: theme, font, sizes, shortcuts, recent files | Kaelio's own app storage on this computer |

To remove everything Kaelio keeps, quit it and delete the `~/.kaelio` folder.

### When Kaelio goes online

Only for these:

- **Update check.** At launch, at most once a week, and when you choose Help ▸ **Check for Updates...**, Kaelio reads its release information from GitHub (`github.com/kael-wanderer/kaelio`) and downloads an update from there if one exists.
- **Git sync,** only if you set it up. Kaelio pulls from and pushes to the repository you connected, and nowhere else. See [Sync with Git](../git/git-sync.md).
- **Markdown ▸ PDF export with diagrams.** Each Mermaid diagram's text is sent to the public mermaid.ink service to be drawn. Nothing else in the document is sent. **HTML ▸ PDF** draws diagrams locally instead. See [Export and copy](../export/export.md).
- **Pictures from the web in your documents.** If a document shows an image by its web address (`![](https://…)`), the preview loads it from that address, as a browser would.

Links you click to web pages open in your browser, not in Kaelio.

## What it will not do

- It never uploads your documents anywhere except the Git repository you chose.
- It never reads files outside the folders and files you open.

## Next steps

- [File history and snapshots](../git/history-and-snapshots.md)
- [Troubleshooting](troubleshooting.md)
