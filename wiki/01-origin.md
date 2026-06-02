# Origin — why Kaelio exists

## The pain point

I write a lot of Markdown: IT runbooks, project specs, journals, READMEs, knowledge-base notes. The tools I had each fell short in a specific way:

- **Obsidian** was great for editing but its sync and export story didn't fit how I work, and it's not something I can bend to my own feature ideas.
- **VS Code** is overkill — slow to open just to read a folder of notes, and its Markdown preview is an afterthought.
- A **full IDE** is the wrong shape entirely for "open a folder and read/edit some docs."

What I actually wanted: open a project folder, read and edit its Markdown with a faithful live preview (Mermaid, math, callouts, checklists), export it cleanly, and have every save become a Git commit without me thinking about it.

## Who asked

This is a personal/solo tool. No external requester — I am both the user and the builder. The "customer" is future-me, working alone, months from now, who needs to pick a doc back up fast.

## The pressure

The real pressure isn't a deadline; it's **continuity**. I work alone across many projects (n8n flows, Slack bots, dashboards, IT tools). Notes are how I hand work off to my future self. If editing those notes is heavyweight, or if their history is fragile, the whole personal-knowledge system rots. Kaelio is the lightweight, Git-backed surface that keeps that system alive.

## Goals

- **Fast & lightweight** — launches and opens a folder instantly; no IDE weight.
- **Faithful preview** — what I see is what exports (Mermaid, KaTeX, callouts, frontmatter, interactive checklists).
- **Git-backed by default** — saves can become commits; remote sync happens in the background; history and conflict resolution are first-class.
- **Project-folder native** — browse mixed files (md, json, csv, html, svg, pdf, images), not just one file at a time.
- **Mine to shape** — open codebase I fully control, so new ideas don't wait on someone else's roadmap.

## Where it came from

Kaelio is a fork + rebrand of [mx](https://github.com/vibery-studio/mx) by Vibery Studio (GPL-3.0). mx gave a solid Tauri 2 + CodeMirror + markdown-it foundation; Kaelio takes that base in its own direction with a new identity, expanded project browsing, richer preview/export, and the Git-sync workflow.

## Read next

- [Timeline](02-timeline.md) — how it has evolved
- [Architecture](03-architecture.md) — how it's built
