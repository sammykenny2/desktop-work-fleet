# PLAN-006: Main Window Placement, Startup Behaviour and In-App Updates

## Metadata

| Field | Value |
|---|---|
| Status | In Progress (started 2026-10-14): Phases 0–6 implemented; Phase 7 completion not recorded; real-machine verification open, see Progress Log |
| Owner | Project maintainer |
| Assigned To | Implementation responsibility: Windows, macOS and Linux hosts, shared UI and release scripts |
| Reviewer | Independent review not yet available |

## Related Spec

[SPEC-006](../specs/006-desktop-window-startup-and-updates.md), [ADR-043](../decisions/043-desktop-window-placement-and-startup-behavior.md),
[ADR-044](../decisions/044-desktop-in-app-updates-from-github-releases.md).

## Overview

First do the parts that need no external account on any of the three platforms: version display, host preferences, main window placement and startup behaviour.
The updater does Windows MSIX first, then Linux DEB; macOS follows once Developer ID, notarization and the Sparkle keys are ready.
Each phase can be committed on its own; version bumps, releases and Actions dispatches need separate authorization under AGENTS.md.

## Implementation Phases

### Phase 0: Prerequisites (maintainer)

- [x] 0.1 Before going public, confirm that the git history and workflows contain no secrets or private data, then make the repo public.
- [x] 0.2 After going public, update the private-repo and Actions quota descriptions in AGENTS.md and `docs/deployment.md` (the commit must state the reason).
- [x] 0.3 Answer SPEC-006 Q02 (macOS installation method); the other Qs do not block Phases 1–4.
- [x] 0.4 Before macOS updates, prepare Developer ID, notarization credentials and the Sparkle EdDSA key, stored in CI secrets.

**Status**: done. The repo went public on 2026-10-14; Q02 was answered with Sparkle; the Developer ID and Sparkle keys are in Secrets.

### Phase 1: Version and host preference foundation

- [x] 1.1 `host.info` on all three platforms adds the app version and distribution form (MSIX / ZIP / Debug, Developer ID / unsigned, DEB / tar.gz / source).
- [x] 1.2 Host preference file reads and writes: a versioned format for `host-preferences.json` and `window-placement.json`, defaults, atomic writes and corruption handling.
- [x] 1.3 Add the bridge methods `host.preferences.get` / `host.preferences.set` and `host.window.resetPlacement`; the protocol stays at 1.
- [x] 1.4 Settings > Desktop gets skeleton "Startup behaviour" and "Version and updates" sections that show the version; browser development mode does not show the native options.
- [x] 1.5 The backup `appVersion` uses the `host.info` version (SPEC-006 D09).

**Deliverables**: the correct version shows on all three platforms; the preference files can be read and written and have unit tests.

**Status**: implemented on Windows, Linux and macOS, 2026-10-14.

### Phase 2: Main window placement

- [x] 2.1 The shared rules (largest intersecting work area, shrink and clamp, minimum size, default) are written as testable pure functions, tested with the same fixtures on all three platforms.
- [x] 2.2 Windows: save and apply the Win32 window placement; validate before showing; write it again on hiding to the tray, exit, sign-out and shutdown.
- [x] 2.3 macOS: save the window frame and maximized state; validate against `NSScreen.visibleFrame`; write it again on hide and exit.
- [x] 2.4 Linux: X11 position and size, Wayland size and maximized state; coordinate getting out of the way / restoring with the ADR-042 adjust overlay (all three platforms).
- [x] 2.5 Settings page "Reset main window size and position" (merged into "Reset desktop layout" on 2026-10-23).

**Deliverables**: C01–C04 pass on the available hardware; mixed DPI and multiple displays are listed as untested when equipment is missing.

**Status**: implemented on Windows, Linux and macOS, 2026-10-14. Not verified as of 2026-10-17: mixed DPI and multi-display
placement; the macOS placement round trip.

### Phase 3: Startup behaviour and second launch

- [x] 3.1 Windows: `generate-windows-manifest.mjs` adds the `uap5` namespace and `windows.startupTask`;
  read, enable and disable the StartupTask state; detect a sign-in start from the activation; disable the option for ZIP / Debug.
- [x] 3.2 Windows: a single-instance channel per user and per data directory; a second launch brings up the existing main window.
- [x] 3.3 macOS: `SMAppService.mainApp` registration, state reading and opening the login item settings.
- [x] 3.4 Linux: write, remove and read back the autostart file, honouring `XDG_CONFIG_HOME`; the `--launch-at-login` argument.
- [x] 3.5 All three platforms: hidden start at sign-in, a switch to keep running in the tray when the main window closes, and showing the main window when the tray is unavailable.

**Deliverables**: C05–C08; Windows sign-in start verified on real 23H2 and 26200 machines.

**Status**: implemented on Windows, Linux and macOS, 2026-10-14. Verified: Windows sign-in starts appear in `host.log` on
build 26200; Linux autostart on the Pi; macOS login-item registration with the real SMAppService in an ad-hoc probe.
Not verified as of 2026-10-17: a Windows sign-in start on 23H2; macOS login-launch detection.

### Phase 4: Shared updater rules and Windows MSIX

- [x] 4.1 Shared fixtures: release list filtering, version comparison, manifest validation, error code mapping.
- [x] 4.2 The update section of `Config/public.json` is generated by the packaging script; the public configuration adds the update source repo.
- [x] 4.3 Windows updater: public Atom query / per-platform selection, downloads with restricted redirects and size, SHA-256, MSIX identity check (revised 2026-10-15 to remove the REST API).
- [x] 4.4 Windows install: after the existing save-and-exit flow, install with `PackageManager` and reopen with `RegisterApplicationRestart`; recovery on failure.
- [x] 4.5 Windows tray "Check for updates…" and a native dialog; download progress text.
- [x] 4.6 `windows-preview.yml` and local packaging generate and upload `work-fleet-update.json`.

**Deliverables**: C09–C11 and C14 (Windows); a real update from an old to a new version with a local test feed.

**Status**: implemented; moved to the public Atom feed on 2026-10-15. Not verified as of 2026-10-17: a Windows update between
two real releases.

### Phase 5: Linux DEB updates

- [x] 5.1 Linux updater (Python): the same rules and fixtures; `dpkg-deb` check.
- [x] 5.2 Install with `pkexec` and relaunch with `host.restart`; cancel and failure handling.
- [x] 5.3 Linux tray items and GTK dialogs; the DEB release flow and manifest (x64 / arm64 according to the actual package architecture).

**Deliverables**: C13 and C14 (Linux).

**Status**: implemented, through pkexec; moved to the public Atom feed on 2026-10-15. Verified: the Linux DEB in-app update on
the Pi.

### Phase 6: macOS updates

- [x] 6.1 Following Q02, add Sparkle 2 (Swift Package) and a custom user driver; update `generate-apple-project.mjs` and THIRD-PARTY-NOTICES.
- [x] 6.2 macOS updater, status bar item and NSAlert; the Developer ID notarized release flow and manifest.

**Deliverables**: C12 and C14 (macOS).

**Status**: implemented with Sparkle 2.10.0; moved to the public Atom feed on 2026-10-15. Not verified as of 2026-10-17: a
macOS update between two real releases.

### Phase 7: Documentation and acceptance

- [ ] 7.1 Update `docs/release/privacy.zh-TW.md`, `docs/release/submission-data.json` and `docs/security-guidelines.md`.
- [ ] 7.2 Update `docs/deployment.md` (update flow, manifest, assets), `docs/testing.md` and `docs/setup-guide.md`.
- [ ] 7.3 Record the actual results in the commit bodies and the untested scope in `docs/testing.md`; update PROGRESS.md where project-level status changes.

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `src/native/windows/app/FleetWindow.cs`, `Program.cs`, `NativeTray.cs` | Modify | Placement saving, startup behaviour, single instance, tray update item |
| New files in `src/native/windows/app/` | Create | Host preferences, window placement, StartupTask, updater and install |
| `src/native/windows/core/BridgeSession.cs` | Modify | `host.info` version and new methods |
| `src/native/apple/macos/Main.swift`, `FleetDesktop.swift`, `src/native/apple/Shared/` | Modify/Create | Placement, SMAppService, updater, status bar |
| `src/native/linux/host.py`, `tray.py`, `service.py` and new modules | Modify/Create | Placement, autostart, updater, tray |
| `src/app/index.html`, `src/app/main.js`, `src/native/bridge.js` | Modify | The two Settings > Desktop sections, version and update status |
| `src/backup/payload.js` and callers | Modify | Backup `appVersion` |
| `scripts/generate-windows-manifest.mjs`, `scripts/windows/Build-WindowsPackage.ps1` | Modify | StartupTask, `Config/public.json` update source, manifest generation |
| `scripts/config.mjs`, `.env.example` | Modify | Public setting for the update source repo |
| `scripts/generate-linux-package.mjs`, `scripts/linux/` | Modify | Autostart launch argument, DEB update manifest |
| `scripts/generate-apple-project.mjs` | Modify | Sparkle dependency (Phase 6) |
| `.github/workflows/windows-preview.yml` and new workflows | Modify/Create | Upload the manifest; macOS / Linux releases |
| `tests/` and `tests/native/` | Create/Modify | Placement rules, preference files, feed / manifest fixtures, native probes |
| Documentation (Phase 7) | Modify | Privacy, security, deployment, testing, setup guide |

## Technical Decisions

See ADR-043 / 044. Host-level files are not per profile; system state takes precedence over preferences; updates connect only on a user action;
installation always goes through the existing save-and-exit flow first; Windows does not use App Installer or the Run registry key.

## Testing Strategy

- **Unit Tests**: fixtures for the placement rules (multiple displays, negative coordinates, disconnection, too small a work area); preference file corruption and defaults;
  feed filtering, version comparison, manifest validation, error codes; the same fixtures run on all three platforms.
- **Integration Tests**: a Debug-only test feed provides synthetic releases and installers; an actual MSIX update with an independent Windows test identity;
  a DEB update in a Linux test VM; Release packages are checked to contain no test feed setting.
- **Manual Testing**: sign-in start after signing out / in, disabling in Task Manager, unplugging displays and changing DPI, second launch,
  checks against a real GitHub prerelease (never test clearing or overwriting with the user's real data).

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| MSIX does not reopen after a self-update, or sign-in start detection does not behave as expected | Medium | Test with a test identity in Phase 4 first; if not workable, prompt to open manually after installing |
| Explorer not ready at sign-in, so scene attachment fails | Medium | Reuse the rebuild recovery of ADR-020 / 030; verify C05 on a real machine |
| A company NAT shares the unauthenticated GitHub API quota | High | All three platforms read the public Atom feed and never use or fall back to the REST API; separate an ordinary 403 from rate limiting with Retry-After |
| The Atom feed lists no platform or has no prerelease field | Medium | The preview channel filters by tag only; refuse unlisted platforms and unsupported channels; a stable channel / long-term platform index is a later decision |
| The GitHub redirect host changes | Medium | The host list is configured in one place; on failure show an error and a link to the Releases page |
| macOS signing and notarization conditions not ready | High | Keep the update capability off and show only the version; do not block the other phases |
| Files replaced during a Linux install | Medium | Save and relaunch right after a successful install; do not relaunch on failure |
| Sign-in start on by default seen as lacking consent | Low | The settings page shows it clearly and turns it off in one click; a system-level disable takes precedence |

## Progress Log

- 2026-10-14: work started; Phase 0 done (repo public); Phases 1–3 implemented on Windows, Linux and macOS.
- Phases 4–6 implemented: Windows MSIX updater, Linux DEB updater through pkexec, macOS Sparkle 2.10.0. On 2026-10-15 all
  three moved to the public Atom feed.
- The macOS placement and startup code was written on Windows and first compiled by the hosted Xcode workflow; apart from the
  login-item fixes, it has never been run and checked on a Mac (as of 2026-10-17).

The Status field, task checkboxes and phase status lines are updated in the same commit as the work; history and verification
evidence are in the git history and [testing](../testing.md).

---

*Created: 2026-10-14*
