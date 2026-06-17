# Codex task — Kaelio: permission-free delete, and full-content image/HTML export

Repo: /Users/cong.bui/Kael/20-Projects/kaelio (Tauri 2 + Rust, vanilla TS frontend).
Branch: main. No test framework. Verify with `npm run build`, `cargo check` in
`src-tauri/`, and manual GUI. The macOS app is ad-hoc signed and NOT sandboxed
(no entitlements), so it runs with the user's normal Unix file permissions.

Follow superpowers:systematic-debugging. Confirm root cause before editing. Do not
guess. Two problems remain (a separate `posix_spawn` EBADF in pandoc export was
already fixed by capping `RLIMIT_NOFILE` away from infinity, so do not touch that).

## Problem 1 — Delete file never works on local builds

Right-click a sidebar file then Delete calls `delete_entry` (lib.rs), which uses
`trash::delete` (trash crate v5, NSFileManager trashItem). On macOS this needs
Full Disk Access, and the grant does not stick because every local rebuild changes
the app code hash, so macOS treats each build as a new app. Result: delete always
fails for files in Desktop, Documents, Downloads, or iCloud. There is now an
`has_full_disk_access()` pre-check plus an "Open Settings" popup, but it loops.

Goal: make delete work reliably on unsigned local builds WITHOUT requiring Full
Disk Access, while keeping recoverability.

Recommended approach (confirm with the user before finalizing semantics):
1. Replace the hard dependency on `trash::delete` with a permission-free delete.
   The app is not sandboxed, so a plain POSIX move or unlink works on any file the
   user can already read and save. Preferred: move the entry into a Kaelio-managed
   trash folder at `~/.kaelio/trash/` using `std::fs::rename`, preserving the file
   name with a timestamp prefix to avoid collisions. This is recoverable and needs
   no Full Disk Access. Fall back to `std::fs::remove_file` or `remove_dir_all`
   only if the rename crosses filesystems.
2. Keep native Trash as a nice-to-have: try `trash::delete` first, and on error
   fall back to the Kaelio trash move. That gives real Trash on a signed release
   and a working delete everywhere else.
3. Remove or simplify the Full Disk Access popup flow once delete no longer needs
   that permission. Keep `open_full_disk_access_settings` only if still used.
4. Surface a clear status message stating where the file went (Trash or Kaelio
   trash). Never silently fail.

Verify by deleting a file that lives in Documents on a freshly built app launched
from Finder. The file must disappear from the sidebar and be recoverable.

## Problem 2 — Image and HTML export does not capture the full content

Export HTML to PNG, JPG, or PDF captures the live preview with html-to-image in
WKWebView. After recent fixes the blank margins are small (an auto-crop step,
`autoCropImageDataUrl` in src/main.ts, trims surrounding white), but the capture is
still incomplete: part of the document is missing from the image. This is a known
WKWebView limitation when rasterizing a large foreignObject, where content beyond a
size threshold is dropped.

The user suggested scaling the capture down (zoom out) so the whole document fits
within WebKit's capture limits. That is a reasonable direction.

Investigate and fix:
1. In `npm run tauri dev` with DevTools open, log the capture node size
   (scrollWidth, scrollHeight) and the final image naturalWidth and naturalHeight
   from `loadImageDataUrl`. Confirm whether the output image is being truncated
   versus the source node size. There is already a `logCaptureDiagnostics` helper.
2. If WebKit truncates tall or wide captures, render at a reduced pixelRatio or
   scale so total pixel dimensions stay under a safe cap, OR capture the document
   in vertical slices and stitch them on a canvas. The `sliceImageDataUrl` helper
   and the PDF paging code already slice images, so a slice-and-stitch capture is a
   natural extension. Prefer slicing the SOURCE node by scroll offset and capturing
   each slice separately, then compositing, so no single capture exceeds the limit.
3. Keep the existing auto-crop as the final step after stitching.
4. Apply the fix to both `capturePreviewPng` (feeds the capture-based PDF) and
   `exportHtmlImage`.

This MUST be verified by opening a real exported PNG and PDF of a long document and
confirming the entire content is present and not cut off. Do not claim done without
inspecting the output files.

## Docs
README already lists the Markdown PDF requirement (brew install pandoc and typst).
Update any export docs in `docs/` if behavior changes.
