---
title: Appearance and settings
summary: Themes, fonts, text sizes, soft wrap, auto-save and session restore, and where each one is set.
---

Kaelio has no separate preferences window. Appearance lives in the **Appearance** panel and the View menu; a few behaviours are switched from the Command Palette. Every choice is remembered between launches.

## When to use it

- When you want a dark, light or custom colour theme.
- When text is too small or too large to read comfortably.
- When long lines run off the side of the editor.

## How to use it

### The Appearance panel

Click the gear at the bottom of the left activity bar (**Appearance Settings**), or run **Appearance Settings** from the Command Palette. It has four tabs:

| Tab | Choices |
|---|---|
| **Themes** | **System** (follows macOS light or dark), **Light**, **Dark**, **Catppuccin Mocha**, **Everforest Dark**, **Nord**, **Custom...** |
| **Font** | **System**, **Inter**, **Georgia**, **Merriweather**, **JetBrains Mono**, **Custom...** |
| **Size** | **Editor and Preview**: 12 to 24 px or **Custom...** (10 to 48). **Explorer**: 12 to 18 px or **Custom...** (11 to 22). |
| **Session** | **Restore last session**: reopen the last folder and files when Kaelio starts (on by default). |

The same theme, font and size choices are in View ▸ **Theme**, **Font**, **Text Size** and **Explorer Text Size**.

**Custom...** under Font takes the name of any font installed on your Mac, for example `iA Writer Quattro S`. Kaelio does not download fonts.

### A custom theme

Theme ▸ **Custom...** asks for a short JSON text of colours, in the same style as a VS Code colour customisation:

```json
{"workbench.colorCustomizations": {
  "sideBar.background": "#2d353b",
  "editor.background": "#1e2326",
  "preview.background": "#1e2326"
}}
```

Keys you can set: `workbench.background`, `workbench.foreground`, `sideBar.background`, `sideBar.border`, `editor.background`, `editor.foreground`, `preview.background`, `preview.foreground`, `activityBar.background`, `panel.border` and `focusBorder`. Press <kbd>Return</kbd> to apply or <kbd>Esc</kbd> to cancel. If the text is not valid JSON, Kaelio says **Invalid theme JSON** and keeps the current theme.

### Soft wrap and line numbers

View ▸ **Soft Wrap**:

- **Off**: long lines scroll sideways.
- **Window Width**: lines wrap at the edge of the editor (the default).
- **Page Guide**: lines wrap at a fixed column (80 by default), with a guide line.

View ▸ **Show/Hide Line Numbers** turns the editor's line numbers on and off.

### Zoom

View ▸ **Zoom In** (<kbd>⌘</kbd><kbd>=</kbd>), **Zoom Out** (<kbd>⌘</kbd><kbd>-</kbd>) and **Reset Zoom** (<kbd>⌘</kbd><kbd>0</kbd>) scale the whole window. In [split view](../writing/split-view.md) the second pane has its own zoom buttons.

### Auto-save

Run **Toggle Auto-save** from the Command Palette (<kbd>⌘</kbd><kbd>⇧</kbd><kbd>P</kbd>). With it on, Kaelio saves a file three seconds after you stop typing, and the title bar shows **Auto**. It is off by default.

### Custom preview style

For more control over how the preview looks, put a CSS file at `~/.kaelio/preview.css`. Kaelio loads it at launch; run **Reload Custom CSS** from the Command Palette after you change it.

## What it will not do

- Appearance settings stay on this computer. They are not synced with Git.
- Changing the theme never changes your documents.

## Next steps

- [Keyboard shortcuts](keyboard-shortcuts.md), including how to change them.
- [The editor and the preview](../writing/editor-and-preview.md)
