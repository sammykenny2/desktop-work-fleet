# SPEC-006: Main window placement, startup behaviour and in-app updates

## Metadata

| Field | Value |
|---|---|
| Status | Approved (U confirmed; on 2026-10-14 work was started on the D defaults; Q unanswered) |
| Owner | Project maintainer |
| Reviewer | The maintainer; an independent review is not yet scheduled |
| Date | 2026-10-14 |
| Decision | [ADR-043](../decisions/043-desktop-window-placement-and-startup-behavior.md), [ADR-044](../decisions/044-desktop-in-app-updates-from-github-releases.md) |
| Related Plan | [PLAN-006](../plans/006-desktop-window-startup-and-updates.md) |

## Summary

Make Work Fleet on Windows, macOS and Linux remember the main window's position and size, offer a "Startup behaviour"
setting, and check for, download and install new versions from the tray and the settings page. The requirements come
from experience with an Electron desktop reference project, but are redesigned for this product's native hosts.
Current status is in [PROGRESS](../../PROGRESS.md); history and verification evidence are in the git history and
[testing](../testing.md).

## Goals

- After reopening, being called up from the tray or a display change, the main window still appears visible, at the
  position and size it had when last used.
- After sign-in, desktop notes appear automatically; the user controls whether the main window opens and whether the
  app stays resident after the main window closes.
- On all three desktop platforms the version is visible in the app and the app can be upgraded; data and drafts are
  saved before an update.

## Non-Goals

- Version display and updates on iOS and Android (handled by the stores), and the Microsoft Store and Mac App Store
  update flows.
- Automatic checks, periodic checks, skipping versions and automatic background installs (see Q01).
- Remembering the position of desktop scene windows or of several main windows; scenes are recomputed per display, and
  card positions still belong to `layout`.
- Replacing WPF/AppKit/GTK, or moving over the reference project's Electron code, UI and data formats.
- An agent making the repo public, bumping the version or dispatching the release workflows.

## User Requirements (U, confirmed 2026-10-14)

| ID | Requirement |
|---|---|
| U01 | Remember the main window's position and size, following the behaviour of the existing desktop project |
| U02 | The tray and the settings page offer "Check for updates" |
| U03 | Settings > Desktop offers "Startup behaviour", following the options of the existing desktop project |
| U04 | The maintainer will make the repo public; updates come from this repo's GitHub Releases |
| U05 | Windows, macOS and Linux all get in-app upgrades; Windows uses MSIX, not NSIS |
| U06 | "Start Work Fleet at sign-in" is on by default |
| U07 | The architecture differs, so the reference project's code is not copied directly; the ADR, SPEC and PLAN come first |

## Functional Requirements

### Main window placement (WP)

| ID | Requirement |
|---|---|
| WP-F01 | Save the restored-state position and size and whether the window is maximized in the host-level `window-placement.json`; not per profile, not in backups or Google |
| WP-F02 | Save 500 ms after a move, resize or maximize change; write once more when hiding to the tray, on save and quit, on sign-out or shutdown and before an update installs; do not write when nothing changed |
| WP-F03 | At start and before every showing of the main window, validate against the work area with the largest intersection, shrinking and clamping into the visible area; when nothing intersects, use the default |
| WP-F04 | Maximizing is applied only when the window is first shown; a hidden sign-in start must not show the main window because of it |
| WP-F05 | Default 1180×800 centred on the primary work area, shrunk to fit a smaller work area; minimum 380×520 |
| WP-F06 | Windows saves and applies the window placement in physical pixels; macOS in points; Linux X11 saves the position, and Wayland only the size and the maximized state |
| WP-F07 | Settings > Desktop offers "Reset main window size and position", which deletes the saved file and applies the default at once; desktop scenes and cards are not affected |
| WP-F08 | A corrupt file, an unknown version or a failed write does not block start or close; it is only logged and the default is used |

### Startup behaviour (SB)

| ID | Requirement |
|---|---|
| SB-F01 | Settings > Desktop adds "Startup behaviour": "Start Work Fleet at sign-in" (on by default), "Keep running in the tray when the main window closes" (on by default), "Open the main window after a sign-in start" (off by default) |
| SB-F02 | The preferences live in the host-level `host-preferences.json`, written atomically; the renderer reads and writes them through host methods, which return the effective state |
| SB-F03 | Windows MSIX registers through StartupTask; on `DisabledByUser`/`DisabledByPolicy` it does not override, shows the system state and can open the Windows Startup apps settings |
| SB-F04 | Windows ZIP and Debug builds offer no sign-in start; the option is disabled with the reason; no Run key is written |
| SB-F05 | macOS registers through `SMAppService.mainApp`; when approval is needed, it shows the state and can open the Login Items settings |
| SB-F06 | Linux writes or removes `$XDG_CONFIG_HOME/autostart/work-fleet.desktop` with `--launch-at-login`, and reads the file back to decide the actual state |
| SB-F07 | On a sign-in start where opening the main window was not chosen, the main window stays hidden and desktop notes start as usual; a manual open, or an unavailable tray, always shows it |
| SB-F08 | When keeping the app in the tray on close is off, closing the main window runs the existing save-and-quit flow; when the tray is unavailable, it still quits |
| SB-F09 | A second start on Windows brings up the existing instance's main window and exits normally, without an "already open" error; macOS and Linux keep their existing activation |
| SB-F10 | Toggling an option syncs the operating system; Windows also syncs at every start, while macOS and Linux apply the default only at the first start; an item the user disabled in the system is never silently re-enabled |

### App updates (UP)

| ID | Requirement |
|---|---|
| UP-F01 | `host.info` adds the app version and the distribution form; "App updates" in Settings > Desktop always shows the version and the channel |
| UP-F02 | Only installs with a valid update source embedded in `Config/public.json` and an install form that can upgrade in place have update capability: Windows MSIX, the Developer ID notarized macOS app, and Linux installed from a DEB |
| UP-F03 | The native host owns the update state machine and the mapping of the single main button: "Check for updates", "Download update", "Restart and install"; repeated requests join the work in progress |
| UP-F04 | When capable, the tray shows "Check for updates…", handled natively; a click checks again and answers with a native dialog, from which the app can update and restart directly |
| UP-F05 | Read the public GitHub `releases.atom`, filtered by the configured repo and `<platform>-v<version>`; preview includes published prereleases; choose the highest version in the feed that is newer; never call or fall back to the REST API; reject unsupported channels and non-empty feeds that list no release for the platform |
| UP-F06 | Build the URL of that release's `work-fleet-update.json` from the configured repo and the validated tag; check the platform, version, tag and single-level file name, and verify the actual download size and SHA-256 against the manifest; reject on any mismatch |
| UP-F07 | Downloads use HTTPS only and send no credentials; redirects are allowed only to the GitHub release asset host; the size is capped and verified while downloading |
| UP-F08 | Check again before downloading; when the downloaded version is no longer the latest, download again; only the last check time is persisted |
| UP-F09 | Before installing, run the existing save-and-quit flow so that drafts are saved, scenes are taken down and data is closed |
| UP-F10 | Windows checks the MSIX Name, Publisher, architecture and version, installs with `PackageManager` and reopens; on failure it reopens and shows the error |
| UP-F11 | macOS downloads, verifies and installs the signed and notarized new version with the standard Sparkle 2.10.0 dialog; this project only finds the release and provides the check entry |
| UP-F12 | Linux checks the DEB name, architecture and version, installs with `pkexec` and runs again; when authorization is cancelled, it keeps running and shows the reason |
| UP-F13 | Errors show with a stable code and Traditional Chinese text (the text now comes from the locale catalogs, see [ADR-056](../decisions/056-english-first-ui-and-locale-catalogs.md)); raw responses do not reach the UI, and logs contain no tokens or personal data |
| UP-F14 | Each platform release carries the installer, its `.sha256` and `work-fleet-update.json`; tags are `<platform>-v<version>` |
| UP-F15 | The privacy notice and the security rules list the GitHub connection, which happens only when the user checks or downloads |

## Delegated Defaults (D)

| ID | Default |
|---|---|
| D01 | Main window placement and startup preferences are two host-level files in the data directory, next to `profile.txt` |
| D02 | Full screen, the minimized state and display identity are not saved; after full screen is closed, the window opens in the restored state |
| D03 | When the system state and the preference differ, the settings page shows the system state |
| D04 | When macOS cannot reliably tell a sign-in start, it is treated as a manual open and the main window shows |
| D05 | Preview packages built locally with the same identity also have update capability; the settings page shows the source |
| D06 | Manual checks only; a tray click always checks again and never uses a remembered result |
| D07 | The updaters are implemented per platform; the feed and manifest rules are tested with shared JSON fixtures |
| D08 | The test feed is read only by `app.workfleet.updateprobe.*` package identities (`update-probe.txt` in the data directory); production identities always ignore it |
| D09 | The backup `appVersion` uses the `host.info` version, as a small fix in the same batch |

## Open Questions (Q)

- [ ] Q01: Whether to add an automatic check after start with an interval, or later background downloads (the reference
  project has them off by default).
- [x] Q02: macOS uses Sparkle 2.10.0 with the standard dialog, and the Developer ID build keeps the sandbox; a separate
  build without Sparkle is split off when the App Store listing happens (2026-10-14).
- [ ] Q03: Whether Linux should later offer a signed APT repository and leave updates to the system.
- [ ] Q04: Whether a release channel is wanted beyond preview, and whether that channel excludes prereleases.
- [ ] Q05: Whether locally built packages (D05) should show only the version, so that development builds are not
  replaced by released versions.

## Non-Functional Requirements

- Security: the renderer cannot make network requests or choose URLs; update URLs are decided only by the host from
  `Config/public.json`, the Atom tag and the manifest.
- Data: drafts are saved before any update, quit or restart; a failure must not lose saved data.
- Privacy: GitHub is contacted only on a user action; no account, device identity or usage data is sent.
- Usability: platforms and install forms without update capability explain why clearly, and no button that cannot
  complete is shown.
- Lookup (revised 2026-10-15): avoid the unauthenticated REST API quota that a company NAT shares; Atom is limited to
  2 MiB, and DTDs, external entities and redirects are refused.
  Atom has no reliable prerelease field; the release channel and a long-term per-platform index belong to the later
  Q04 decision, so that a preview is not mistaken for a release.

## Acceptance

| Case | Required evidence |
|---|---|
| C01 Placement round trip | On all three platforms, after moving, resizing or maximizing, quit and reopen: position, size and maximized state are the same; on Wayland only size and maximized state are checked |
| C02 Hiding to the tray | Saved when hidden; calling up from the tray and a second start return to the same position |
| C03 Display change | After unplugging a secondary display or changing the resolution, the called-up main window is entirely inside the visible work area; mixed DPI needs real multiple displays |
| C04 Reset and corruption | Reset applies the default at once; a corrupt file or an unknown version does not affect start |
| C05 Sign-in start | With the default on, sign out and sign in again: the app starts, the main window is hidden, and desktop notes appear; when Explorer is not ready yet, recovery follows ADR-020/030 |
| C06 Disabled in the system | After disabling it in Task Manager, the system settings or autostart, the settings page shows the system state and the next start does not re-enable it |
| C07 Close behaviour | With keeping in the tray on close turned off, the X button saves and quits; with it on, the window hides |
| C08 Second start | Starting again on Windows while hidden shows the existing main window without an error; the ZIP and MSIX data directories do not interfere with each other |
| C09 Version and capability | Each install form shows the correct version; forms without capability show no tray item and no main button |
| C10 Check results | Up to date, new version, offline, rate limit, manifest error and SHA-256 mismatch each show the correct state |
| C11 Windows update | An old MSIX updates in the app to the new version: drafts saved, Explorer restored, app reopened, data kept; a wrong Publisher is rejected |
| C12 macOS update | A Developer ID notarized old version updates to the new one and reopens; a signature mismatch is rejected |
| C13 Linux update | An old DEB updates to the new one and runs again; cancelling pkexec keeps it running |
| C14 Release assets | Each platform release's manifest matches the actual installer's size, SHA-256, tag and platform |

## Dependencies

- The maintainer makes the repo public, confirming before that the history contains no secrets.
- The Windows preview certificate stays the same; macOS needs Developer ID, notarization and Sparkle EdDSA keys; Linux
  needs a DEB release workflow.
- Version bumps, releases and Actions dispatches need separate authorization as described in AGENTS.md.

## References

- [ADR-043](../decisions/043-desktop-window-placement-and-startup-behavior.md), [ADR-044](../decisions/044-desktop-in-app-updates-from-github-releases.md), [PLAN-006](../plans/006-desktop-window-startup-and-updates.md), [Research](../research/2026-10-14-desktop-window-startup-and-update-reference.md)
- [SPEC-003](003-desktop-cards-groups-and-formation.md) (boundary between synced and device state), [Deployment](../deployment.md), [Security boundaries](../security-guidelines.md)

---

*Created: 2026-10-14*
*Related Plan: [PLAN-006](../plans/006-desktop-window-startup-and-updates.md)*
