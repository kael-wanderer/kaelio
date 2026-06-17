# Codex task — Drag OS files into the sidebar to copy them (like VSCode)

Repo: Kaelio (Tauri 2, vanilla TS frontend in src/main.ts, Rust in
src-tauri/src/lib.rs). Verify with npm run build and cargo check in src-tauri.
Implement directly; this is a small, well-scoped feature.

## Behavior (confirmed with the user)

- Drag a file OR a folder from Finder/Explorer onto the SIDEBAR file tree
  (the explorer): COPY it into the folder under the cursor.
- Drag a file onto an EDITOR WINDOW (the main pane or the sub split pane):
  OPEN it, do not copy. This is the current behavior and must be preserved for
  both panes.
- So only drops whose cursor position is inside the sidebar tree trigger a copy.
  Every other drop location keeps the existing open behavior.

## Current state to build on

- OS drops are already handled in initDragDrop at src/main.ts around line 3049,
  using appWindow.onDragDropEvent. event.payload has type ("enter", "over",
  "drop", "leave"), paths (array of absolute paths), and position (a
  physical-pixel point).
- The internal tree drag-to-move handler at src/main.ts around lines 3268 to
  3319 already shows the pattern for highlighting the folder under the cursor and
  resolving a destination folder. Reuse this approach.
- Tree folder rows have class tree-item directory and a dataset.path. The sidebar
  container is sidebar-tree. The opened root path is currentFolderPath.

## Frontend work in src/main.ts

1. In the onDragDropEvent handler, convert the physical position to CSS pixels
   before hit-testing: divide position.x and position.y by
   window.devicePixelRatio, then use document.elementFromPoint.
2. On type "enter" and "over", if the point is inside sidebar-tree, highlight the
   destination folder using the same drag-over class used by the internal drag
   (clear previous drag-over first, then add it to the resolved folder row). On
   "leave", clear the highlight.
3. On type "drop", decide the destination folder from the point:
   - If the point is over a tree-item directory row, the destination is that row
     dataset.path.
   - If the point is over a tree-item that is a file (not a directory), the
     destination is that file's parent directory.
   - If the point is inside sidebar-tree but not over a row, the destination is
     currentFolderPath (the root).
   - If the point is NOT inside sidebar-tree (it is over an editor or preview
     pane, main or sub), do not copy. Fall through to the existing open behavior.
4. When there is a destination folder, copy every path in event.payload.paths
   into it by calling a new Rust command, then call refreshSidebar and show a
   status message via flashStatus. Do not open the files in this case.

## Rust work in src-tauri/src/lib.rs

1. Add a command copy_into_folder(source: String, dest_dir: String) returning
   Result<String, String> that copies one entry into dest_dir and returns the
   new path.
   - Compute the destination as dest_dir plus the source basename.
   - If a file or folder with that name already exists, pick a non-colliding name
     by appending a numeric or "copy" suffix. Reuse the same naming approach
     already used in duplicate_entry around line 1205.
   - If the source is a directory, copy it recursively using the existing
     copy_dir_recursive at line 453. Otherwise use std fs copy for a single file.
   - Refuse to copy a folder into itself or into a subpath of itself.
2. Register copy_into_folder in the invoke_handler list.

## Edge cases

- Multiple dropped paths: copy each, collect failures, report a concise summary.
- Source already inside the destination folder: still copy with a new
  non-colliding name, matching how duplicate behaves.
- Keep it permission-free and simple; the app is not sandboxed so std fs copy
  works for user files.

## Visual feedback

Reuse the existing drag-over CSS class so the target folder highlights during the
drag, matching the internal move.

## Acceptance test (manual)

- Open a folder in the sidebar. Drag a file from Finder onto a subfolder row and
  confirm it is copied into that subfolder and appears after refresh.
- Drag a folder from Finder onto a subfolder row and confirm the whole folder is
  copied in.
- Drag a file onto the main editor pane and confirm it opens (not copied).
- With split view open, drag a file onto the sub pane and confirm it opens (not
  copied).
