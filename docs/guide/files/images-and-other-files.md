---
title: Images and other files
summary: How Kaelio handles Markdown, HTML, plain text and code, and why PDFs and images open in your default app.
---

Kaelio is a reader and light editor for Markdown, and it can show HTML pages. Other text files open as plain text. PDFs and images open in the app your Mac uses for them, such as Preview.

## When to use it

- When a notes folder also holds screenshots, PDFs, data files or web pages.
- When you want to know what happens when you click a file that is not Markdown.

## How to use it

Click the file in the Explorer, or a link to it in the preview. What happens depends on its kind:

| Kind | What Kaelio does | Can you edit it? |
|---|---|---|
| Markdown (`.md`, `.markdown`) | Opens it with the formatted preview | Yes |
| HTML (`.html`, `.htm`) | Opens it and shows the rendered page. Scripts are off unless you turn them on for that page. | Yes, as text |
| Other text: `.txt`, YAML, JSON, CSV, code, logs and more | Opens it as plain text | Yes |
| PDF, and images: PNG, JPG, GIF, WEBP, BMP, ICO, AVIF and SVG | Opens it in your default app. The status bar says **Opened in default app**, and no tab opens in Kaelio. | No, not in Kaelio |

### Run the scripts of an HTML page

Scripts in an HTML file are off by default, so a page that draws a chart with JavaScript shows an empty space. If the page has scripts, a bar above it reads **Scripts are off for this page.** Click **Run scripts** to run them. (macOS only for now; on Windows and Linux HTML pages stay static.)

- The page then runs in an isolated frame: it cannot reach your other files, Kaelio's commands or its settings. It can load files from its own folder (pictures, styles, scripts beside it) and from `https://` addresses it asks for.
- The bar reads **Scripts are running in an isolated frame.** Click **Turn off** to go back to the static page.
- The frame shows the saved file. While you have unsaved edits the bar adds **Showing the last saved version.**; save to see them.
- The choice lasts until you quit Kaelio. After a restart every page starts with scripts off.
- **Export PNG** always captures the static page, with scripts off.

Images inside a Markdown note still show in the preview. Click one to see it larger.

Files that are not text, such as a ZIP archive, do not open: Kaelio says **Could not open this file. Kaelio supports text files; binary files are not editable.**

> [!NOTE]
> Earlier versions of Kaelio had a built-in PDF reader with highlights and a CSV table view. Those are gone. For reading and annotating PDFs, BugText has a full PDF reader. Highlight files (`.kaelio-annot.json`) made by older versions stay on your disk untouched.

## What it will not do

- It never changes a PDF or image.
- It never runs scripts from an HTML file unless you click **Run scripts** for that page, and then only in an isolated frame.
- When it restores your last session, it skips PDFs and images instead of opening other apps.

## Next steps

- [Explorer, tabs and windows](explorer-and-tabs.md)
- [Export and copy](../export/export.md)
