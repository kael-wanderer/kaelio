---
title: Install Kaelio
summary: Download Kaelio, open it past the macOS warning, and keep it up to date.
---

Kaelio is not sold through an app store. You download it from kael.io.vn or from its GitHub releases page and install it like any other app. On a Mac, macOS asks you to confirm the first launch.

## When to use it

- When you are installing Kaelio for the first time.
- When macOS says Kaelio "is damaged" or was "Not Opened".
- When you want to check for a newer version.

## How to use it

### Download and install

Open the Kaelio page on kael.io.vn, or the [Releases page on GitHub](https://github.com/kael-wanderer/kaelio/releases), and download the file for your computer:

| Computer | File | Install |
|---|---|---|
| Mac (Apple silicon or Intel) | `.dmg` | Open it and drag Kaelio onto Applications. |
| Windows | `.msi` | Open it and follow the installer. |
| Linux | `.AppImage` or `.deb` | Make the AppImage executable and run it, or install the `.deb` package. |

### If macOS will not open Kaelio

Kaelio is not notarised by Apple, so macOS may stop the first launch. You only need to do this once.

#### Way A: System Settings (try this first)

1. On the warning, click **Done**, not Move to Trash.
2. Open System Settings ▸ Privacy & Security.
3. Scroll down to the message about Kaelio and click **Open Anyway**.
4. Enter your Mac password, then click **Open**.

#### Way B: Terminal

If macOS says Kaelio "is damaged and can't be opened", or Way A shows no button:

1. Open Terminal.
2. Run `xattr -cr /Applications/Kaelio.app` and press Return.
3. Open Kaelio again.

### Open your files with Kaelio

During install, Kaelio registers itself for `.md`, `.markdown`, `.txt`, `.yaml` and `.yml` files, so you can choose it in Finder's **Open With** menu. To make it the default for Markdown, select a `.md` file in Finder, choose File ▸ Get Info, pick Kaelio under **Open with**, and click **Change All…**.

### Keep Kaelio updated

Kaelio checks for a new version a few seconds after it starts, and once a day while it stays open. To check now, choose Help ▸ **Check for Updates...**.

When there is a newer version, an **Update N** button appears in the status bar. Click it to see what changed, then choose:

- **Install and Restart** to download the update, install it and reopen Kaelio.
- **Later** to keep working. The button stays until you install.
- **Skip This Version** to stop being told about that version. A newer one is still offered, and Help ▸ **Check for Updates...** always shows what it finds.
- **Release Notes** to open the release page on GitHub.

To stop the daily check, clear **Check for updates automatically every day** in the same window. Your settings and files are not touched by an update.

## What it will not do

- It never downloads, installs or restarts by itself. You choose when.
- It never sends anything about you to check for updates. It only reads the latest version number from GitHub.

## Next steps

- [Your first five minutes](first-five-minutes.md)
- [Troubleshooting](../reference/troubleshooting.md)
- [Privacy](../reference/privacy.md)
