---
title: Troubleshooting
summary: Fixes for the macOS warning, missing Pandoc or Typst, Git sign-in and push problems, and other common questions.
---

Most problems have a short fix. Find the message you see below.

## When to use it

- When something does not work as this guide describes.

## How to use it

### macOS says Kaelio "is damaged" or was "Not Opened"

Kaelio is not notarised by Apple. Open System Settings ▸ Privacy & Security and click **Open Anyway**, or run `xattr -cr /Applications/Kaelio.app` in Terminal. Full steps: [Install Kaelio](../start-here/install.md).

### "Pandoc is required for PDF/DOCX export but was not found"

Markdown PDF and DOCX exports need Pandoc. Run `brew install pandoc` in Terminal, then export again. You do not need to restart Kaelio.

### "Typst is required for Markdown PDF export but was not found"

Run `brew install typst`. Or use File ▸ **Export** ▸ **HTML** ▸ **PDF**, which needs nothing installed.

### A diagram appears as code in my Markdown PDF

Kaelio could not reach mermaid.ink to draw it, for example because you are offline. Try again when online, or use the HTML PDF export, which draws diagrams locally.

### "No GitHub credentials found" or "Authentication failed"

Your computer is not signed in to GitHub. Do one of these, then try again:

- Run `gh auth login` in Terminal (install the GitHub CLI with `brew install gh`).
- Add an SSH key to your GitHub account and use the repository's SSH URL (`git@github.com:you/notes.git`).

### My saves are committed but not pushed

The status bar shows **⟳ N unsaved** when commits have not reached GitHub. Usually GitHub has changes you do not have yet. Click **⟳** (**Sync now**) in the Git panel to pull them and push yours.

### "Pull stopped: local changes would be overwritten"

You have edits that are not committed, and the pull would replace them. Save the file (with auto-sync on, that commits it), or type a message in the Git panel and click **Save**, then click **⟳** again.

### "This folder is inside an existing Git repository"

The folder you opened is part of a bigger Git repository. Open the top folder of that repository instead, then set up sync there.

### I closed a tab and lost my changes

In the **Save changes to** question, **Cancel** closes without saving. Check **File History** ▸ **Snapshots** for a recent copy. To avoid it, turn on **Toggle Auto-save** in the Command Palette.

### The preview searched the wrong thing with ⌘F

<kbd>⌘</kbd><kbd>F</kbd> searches the editor when the editor is visible, and the preview only in **Reading View** (<kbd>⌘</kbd><kbd>E</kbd>) or for a PDF.

### Images I pasted make my file huge

Kaelio now saves pasted images as files in an `assets` folder beside the note. Images pasted with an older version are still stored inside the Markdown text as long `data:` links; to shrink the file, save such an image into your folder and replace the `data:` link with a relative path.

### A file opens as "binary files are not editable"

Kaelio opens text files and shows images and PDFs. Other formats, such as Word or ZIP files, are not supported.

### Where is my update?

Kaelio checks at most once a week. Choose Help ▸ **Check for Updates...** to check now.

## What it will not do

- None of these fixes needs you to delete your settings or notes.

## Next steps

- [Privacy](privacy.md)
- [Sync with Git](../git/git-sync.md)
- Report a problem on [GitHub](https://github.com/kael-wanderer/kaelio/issues).
