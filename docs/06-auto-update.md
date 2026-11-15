# 06-auto-update

In-app auto-update via `tauri-plugin-updater`. Checks GitHub Releases for `latest.json` weekly, downloads and installs updates in background, prompts user to restart.

## System Diagram

```mermaid
sequenceDiagram
    participant App as Kaelio (frontend)
    participant Plugin as tauri-plugin-updater
    participant GH as GitHub Releases

    App->>App: setTimeout(3s) on startup
    App->>App: Check localStorage throttle (7 days)
    App->>Plugin: check()
    Plugin->>GH: GET /releases/latest/download/latest.json
    GH-->>Plugin: {version, platforms, signatures}
    Plugin-->>App: Update object (or null)
    App->>Plugin: downloadAndInstall(progressCallback)
    Plugin-->>App: Started/Progress/Finished events
    App->>App: Status bar: "click to restart"
    App->>Plugin: relaunch()
```

## 1. Configuration

| Config | Location | Value |
|--------|----------|-------|
| Endpoint | `tauri.conf.json` plugins.updater.endpoints | `https://github.com/kael-wanderer/kaelio/releases/latest/download/latest.json` |
| Public key | `tauri.conf.json` plugins.updater.pubkey | Ed25519 base64 |
| Bundle artifacts | `bundle.createUpdaterArtifacts` | `false` in `tauri.conf.json` (local builds need no signing key); `true` in `tauri.release.conf.json`, which CI passes with `--config` |
| Capabilities | `capabilities/default.json` | `updater:default`, `process:allow-restart` |

## 2. Rust Plugin Registration

Registered in `lib.rs` via `.setup()` with `#[cfg(desktop)]` guard. Also requires `tauri-plugin-process` for `relaunch()`.

## 3. Frontend Logic

| Behavior | Detail |
|----------|--------|
| Auto check | 3s after DOMContentLoaded |
| Throttle | Once per 7 days via `localStorage("kaelio-update-last-check")` |
| Manual check | Help menu > "Check for Updates..." (bypasses throttle) |
| Progress | Status bar shows download percentage |
| Install prompt | "Update installed — click to restart" |
| Error handling | Silent on auto-check, status bar message on manual |

## 4. Signing

| Key | Location |
|-----|----------|
| Private key | GitHub secret `TAURI_SIGNING_PRIVATE_KEY` |
| Password | GitHub secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty) |
| Public key | `tauri.conf.json` plugins.updater.pubkey |
| Local backup | `~/.tauri/kaelio.key` |

## 5. Updater Artifacts per Platform

| Platform | Updater bundle | Signature |
|----------|---------------|-----------|
| macOS | `Kaelio.app.tar.gz` | `Kaelio.app.tar.gz.sig` |
| Linux | `Kaelio_X.Y.Z_amd64.AppImage` | `*.AppImage.sig` |
| Windows | `Kaelio_X.Y.Z_x64-setup.exe` | `*-setup.exe.sig` |

> Releases up to 0.9.5 were built with updater artifacts off, so their `latest.json` carried empty signatures and in-app update could not work. Copies installed from those releases need one manual download.

## File Reference

| File | Purpose |
|------|---------|
| `src/main.ts` | `doUpdateCheck()`, `checkForUpdates()` |
| `src-tauri/src/lib.rs` | Plugin registration (`run()`) |
| `src-tauri/tauri.conf.json` | Updater config (`plugins.updater`) |
| `src-tauri/tauri.release.conf.json` | Release-only override enabling updater artifacts |
| `src-tauri/capabilities/default.json` | Permissions |

## Cross-References

| Doc | Relation |
|-----|----------|
| [00-architecture-overview](00-architecture-overview.md) | System context |
| [05-ui-layout](05-ui-layout.md) | Help menu, status bar |
| [07-release-pipeline](07-release-pipeline.md) | Generates latest.json + signatures |
