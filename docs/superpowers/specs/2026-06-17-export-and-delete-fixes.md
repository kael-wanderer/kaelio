# Codex task — Fix Kaelio export (PDF/DOCX + image) and file delete

You are working in the Kaelio repo (`/Users/cong.bui/Kael/20-Projects/kaelio`), a Tauri 2 +
Rust markdown editor. Branch: `main`. No test framework — verification is
`npm run build` + `cargo check` (in `src-tauri/`) + manual GUI in `npm run tauri dev`.

There are **three independent bugs**. Fix all three. Follow `superpowers:systematic-debugging`
for each — confirm the root cause before changing code; do not stack speculative fixes.

## Current state (already changed this session — do NOT redo)

- `src-tauri/src/lib.rs`: pandoc is no longer bundled. `find_pandoc()` resolves a system
  pandoc (`/opt/homebrew/bin/pandoc`, `/usr/local/bin/pandoc`, then `PATH`). `externalBin`
  was removed from `src-tauri/tauri.conf.json`. The user confirmed
  `which pandoc` → `/opt/homebrew/bin/pandoc` and `brew install typst` is installed.
- `src/main.ts`: the delete confirm is now a real modal with Cancel/Confirm buttons
  (`showConfirmDialog`), CSS in `src/styles.css` (`.confirm-modal*`). Image capture got
  `fitNodeToContentWidth()` + margin/transform resets in `EXPORT_LIGHT_THEME_CSS`.

These changes were built and tested by the user. The three problems below REMAIN.

---

## Bug 1 — PDF/DOCX export: pandoc fails to spawn (HIGHEST PRIORITY, strong hypothesis)

**Symptom:** With pandoc installed at `/opt/homebrew/bin/pandoc`, export still fails:
`Export failed: Failed to run pandoc at '/opt/homebrew/bin/pandoc'. (...)`. The earlier form of
this error was `Bad file descriptor (os error 9)`. The binary runs fine from a shell with the
exact same args — only the app's spawn fails.

**Root-cause hypothesis (high confidence):** The failing spawns are the only `Command` calls
with `.current_dir(&tmp_dir)` (lib.rs ~line 798 in `export_pdf_blocking`, ~line 884 in
`export_docx`). `.current_dir()` on `posix_spawn` is a known source of `EBADF` in macOS apps
launched from Finder, where fds 0/1/2 are closed. The sibling `curl` spawn (lib.rs ~678) does
NOT set `current_dir` and is unaffected. Both `.current_dir()` calls were introduced together
with the original regression in commit `d77f9a4`.

**Why removing it is safe:** mermaid diagrams are written to `tmp_dir` and embedded with an
**absolute** path (`png_file.to_string_lossy()`, lib.rs ~687), and `tmp_input` / `output_path`
are already absolute. Nothing depends on the process cwd.

**Fix:**
1. Remove `.current_dir(&tmp_dir)` from both pandoc spawns.
2. Verify in `npm run tauri dev` AND, critically, in a packaged build launched from Finder
   (`npm run tauri build`, then open the `.app` by double-clicking — the bug only reproduces
   in the Finder-launched app, not from a terminal). Export a `.md` to PDF and to DOCX.
3. If removing `current_dir` does NOT fix it, capture the FULL error string (the `(...)` part)
   and investigate the stdio setup: confirm `Stdio::null()`/`Stdio::from(file)` aren't hitting
   an EBADF because the parent app's fds 0/1/2 are closed. As a fallback, explicitly open
   `/dev/null` and dup, or use `.output()` instead of manual `wait_timeout` on a thread.

**Engine note (tell the user, update docs):** the engine order is `["typst","xelatex","pdflatex"]`.
`brew install typst` (21 MB) is the first engine tried and is sufficient — **MacTeX (6.9 GB) is
NOT required**. mactex only matters for the xelatex/pdflatex fallbacks. Update CLAUDE.md and any
export docs so users install `pandoc` + `typst` only.

---

## Bug 2 — File delete does nothing (file stays on disk)

**Symptom:** Right-click a file → Delete → modal shows, click Delete (confirm) → file is NOT
removed. `delete_entry` (lib.rs ~315) calls `trash::delete(&path)` (trash crate v5). `ctxDelete`
(src/main.ts ~3497) awaits the confirm, calls `invoke("delete_entry", ...)`, and on error shows
`flashStatus("Delete failed: ...")`.

**Investigate (in order):**
1. Confirm the confirm modal actually resolves `true` and `delete_entry` is invoked (add a
   temporary log in `ctxDelete` — run via `npm run tauri dev` to read the console).
2. Capture the exact error from `delete_entry`. Likely candidates:
   - **macOS TCC / permissions:** the app is unsigned with no entitlements. Files opened via the
     open-dialog get a powerbox grant for read/write, but `trash::delete` (NSFileManager
     `trashItem`) may be denied for files in protected locations (Desktop/Documents/Downloads),
     surfacing as a permission error. If so: document that PDF/file ops may need Full Disk Access,
     and/or make the error message actionable (tell the user which permission to grant).
   - **trash crate v5 macOS issue:** test `trash::delete` directly; try canonicalizing the path
     first; check whether a newer/older `trash` version behaves.
3. Make failures loud and specific — never silently no-op. The user must always see WHY a delete
   failed.

Do not switch to permanent `fs::remove` as the default — keep "move to Trash" semantics.

---

## Bug 3 — Image/HTML export still clipped (top ~10%, left ~20% blank; content offset)

**Symptom (improved but not fixed):** after this session's changes, the bottom/right blank is
gone, but the exported PNG/JPG/PDF still has ~10% blank at top and ~20% blank at left, with the
content pushed toward the bottom-right and the right edge slightly clipped. So the capture canvas
is larger than the content, or the content is drawn at an offset.

**Context:** `preparePreviewCaptureNode()` (src/main.ts ~4795) builds an off-screen host
(markdown branch: `position:fixed; left:-100000px`; iframe/HTML branch: appended in normal flow).
`capturePreviewPng` / `exportHtmlImage` call `html-to-image` `toPng`/`toJpeg` with explicit
`width`/`height` (from `node.scrollWidth/scrollHeight`) and a computed `pixelRatio`. The app runs
in WKWebView, where `html-to-image`'s SVG `foreignObject` rasterization is known to mis-position
tall/wide content.

**Investigate:**
1. Run `npm run tauri dev`, open DevTools (right-click → Inspect → Console). Add a temporary log
   in the capture path printing `node.getBoundingClientRect()`, `scrollWidth/Height`,
   `clientWidth/Height`, the widest descendant width, and the `width/height/pixelRatio` passed to
   `toPng`. Determine whether the canvas is larger than content (→ trim) or content is translated
   (→ a transform/positioning offset, e.g. the `left:-100000px` host or a child transform).
2. Likely fixes to try once measured: render the host at `left:0; top:0` (behind a temporary
   opaque cover, or simply accept a 1-frame flash) so `html-to-image` doesn't mishandle the large
   negative offset; OR post-process the captured image — auto-crop the white margins on a canvas
   before saving (robust against WKWebView quirks); OR set the host to exact content size with
   `box-sizing:border-box` and zero margins and pass the bounding-rect size.
3. Verify visually by opening the exported file. This bug CANNOT be verified without looking at
   the output image — do not claim it fixed without inspecting a real export.

---

## Deliverables
- All three bugs fixed and verified (Bug 1 & 2 in a Finder-launched packaged build; Bug 3 by
  opening an exported image).
- `npm run build` and `cargo check` both clean.
- CLAUDE.md + export docs updated: PDF/DOCX needs `brew install pandoc` + `brew install typst`
  (MacTeX optional, not required).
- Report exactly what was verified and how (per `superpowers:verification-before-completion`).
