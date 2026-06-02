# Design docs

Per-feature design (the **implementer/reviewer** tier): inputs, validation, flow, and how a feature evolved between versions. Two-level — this page is the consolidated index; deep per-feature docs link from here.

> Stub. Add a doc per feature as it's designed. Diagrams here are HLD (trigger → guard → branch → outcome), themed per the [diagram standard](../diagrams/README.md).

## Candidate feature areas

- **Editor ↔ preview sync** — scroll-sync toggle + click-to-cursor (`data-source-line` mapping). Spec exists in `docs/spec.md`.
- **Git sync** — auto-commit/push on save, conflict resolver, credential handling (SSH agent → key → HTTPS).
- **Preview pipeline** — markdown-it → callouts → checklists → KaTeX → Mermaid → frontmatter.
- **Export** — preview-capture (PNG/JPG/PDF/DOCX) vs. Pandoc/Typst sidecar path.
- **Session restore** — tabs, scroll, cursor via `~/.kaelio/session.json`.
