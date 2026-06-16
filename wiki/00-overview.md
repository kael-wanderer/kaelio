# Kaelio

**Status:** wip  ·  **Owner:** Kael (cong.bui)  ·  **Audience:** future-me + anyone picking up the codebase

Kaelio is a fast, lightweight desktop Markdown editor and project-folder reader built with Tauri 2, Rust, and vanilla TypeScript. It opens a folder, lets you read/edit/preview Markdown with live split preview, and quietly syncs your writing to Git on save. It exists because I wanted Obsidian-style note editing without launching a full IDE, and with Git-backed history baked in.

## At a glance

- **What it does:** open a folder → edit Markdown with live preview, callouts, Mermaid, math → export or auto-commit to Git on save. Soft-wrap modes and a split view (two documents side by side, with file comparison) keep long lines and multi-file work readable.
- **Who uses it:** me (Kael), for notes, specs, READMEs, journals, and project knowledge bases.
- **Stack:** Tauri 2 + Rust backend, vanilla TypeScript frontend (CodeMirror 6 + markdown-it), Catppuccin Mocha theme.

## Hero diagram

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontFamily':'Iosevka Nerd Font Mono, monospace','lineColor':'#555'}}}%%
flowchart TD
  classDef guard   fill:#FFF4CC,stroke:#E6C200,color:#333;
  classDef action  fill:#CDEFD9,stroke:#4CAF7D,color:#333;
  classDef lookup  fill:#CFE8FB,stroke:#4A90D9,color:#333;
  classDef session fill:#E6DAF7,stroke:#9B72CF,color:#333;
  classDef audit   fill:#FBD5DD,stroke:#E0708A,color:#333;
  classDef reject  fill:#FCE0C8,stroke:#E8954A,color:#333;

  edit[/Type in CodeMirror editor/]:::guard --> render[markdown-it render pipeline]:::action
  render --> preview[Live split preview]:::action
  edit --> save[Save file via Rust IPC]:::action
  save --> sync{Auto-sync on?}:::session
  sync -->|yes| git[git commit + push]:::audit
  sync -->|no| idle[Stay local]:::action
  git -->|conflict| resolve[Conflict resolver]:::reject
```

## Read next

- [Origin / why I built it](01-origin.md)
- [Timeline](02-timeline.md)
- [Architecture](03-architecture.md)
- [Lessons & gotchas](lessons.md)
