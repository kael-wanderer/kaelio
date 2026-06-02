# Reference

Lookup material: setup, glossary, how-tos.

> Stub. Add pages as needed.

## Planned

- **Build & run** — `npm install`, `npm run tauri dev`, `npm run tauri build`. (Mirror of project `CLAUDE.md`.)
- **Release how-to** — push a `v*` tag → `.github/workflows/release.yml` builds, signs, publishes `latest.json`.
- **Keyboard shortcuts** — full table (see project `README.md`).
- **Glossary** — IPC command, sidecar, `data-source-line`, auto-sync, snapshot, callout.
- **Storage layout** — what lives in `~/.kaelio/` (session.json, snapshots, preview.css).

## Deeper detail

The wiki's deep-tech tier is [03-architecture.md](../03-architecture.md) (stack, system map, data flow, constraints). More granular engineering notes (editor, preview, file ops, export, UI, updater, release) live in the project's `docs/` folder in the source repo — outside this wiki, so they are not part of the published site.
