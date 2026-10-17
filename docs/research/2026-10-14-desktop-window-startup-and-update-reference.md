# Main window placement, startup behavior and app update reference

Updated: 2026-10-14. Collects how an Electron desktop reference project does these things, and this project's
current state, for use by [ADR-043](../decisions/043-desktop-window-placement-and-startup-behavior.md),
[ADR-044](../decisions/044-desktop-in-app-updates-from-github-releases.md) and
[SPEC-006](../specs/006-desktop-window-startup-and-updates.md).

## Sources and boundaries

- The reference project is an Electron desktop app (MIT). Only its behavior, limits and design lessons are
  referenced; this product is a WPF/AppKit/GTK native host, and no code, UI or data format is moved over. Its name and
  local location are not recorded.
- Obtained by reading the code on 2026-10-14; the reference project was not built or run. Items marked "inference"
  are derived only from the code or library documentation.

## User requirements (2026-10-14)

- Bring in the reference project's main window position/size memory, "Check for updates" in the tray and on the
  settings page, and Settings > Desktop > "Startup behavior".
- The architectures differ, so first turn these into this project's ADR/SPEC/PLAN.
- The maintainer will make this repo public, and the app gets new versions from its GitHub Releases.
- Windows, macOS and Linux all need in-app upgrades; Windows uses MSIX, not an NSIS installer.
- "Start at sign-in" is on by default.

## External evidence: the reference project

### Main window position and size

- The main process saves `window-state.json`: `{version:1, bounds:{x,y,width,height}, maximized}`;
  bounds are the normal bounds after restore; full screen, minimized state, display IDs and DPI are not stored. It is
  written atomically with a temporary file + rename.
- Writes are debounced by 500 ms after move/resize/maximize changes; closing (including hiding to the tray) and the
  exit flow each write once more; nothing is written without a change.
  While minimized, an unmaximize falsely reported by the platform is ignored and the maximized flag is kept. A failed
  write is only logged.
- On restore, the work area with the largest intersection with the saved bounds is chosen, the window is shrunk to
  fit and clamped back onto the screen; if it intersects no display, the default is used.
  The first time, it is 85% of the primary work area, limited to 1280×800–1680×1050 and centered; if the work area is
  too small, the window is maximized and keeps a smaller restore size.
- Maximizing is deferred until the first show, so a hidden start does not get shown. Validation happens only at
  startup; display changes are not handled.
- "Reset platform data" deletes the file and applies the default position. It was introduced because a fixed size
  exceeded the work area at 1080p/125%.

### Check for updates

- The main process owns the single state machine: unavailable, idle, checking, up_to_date, update_available,
  downloading, downloaded, installing, failed; the snapshot contains the version, summary, progress, error code and
  nextAction (check/download/restart_install).
- Only one check or download runs at a time; repeated requests join the work in progress. It checks again before
  downloading; an already downloaded version is kept only if it is still the latest.
  Only lastCheckedAt is persisted; errors are shown as stable codes, raw messages do not reach the UI, and tokens are
  masked in logs.
- The capability is decided by the build description CI writes into the installer, not by environment variables;
  development builds and local packages only show the version.
- The tray has one fixed item, "Check for updates…"; clicking it always checks again, then answers with a native
  dialog, from which the update can be downloaded and installed directly.
  Download progress goes in the tooltip. At the top of Settings > Desktop, "App updates" maps nextAction to a single
  primary button, with results shown as toasts.
- The transport is electron-updater reading public GitHub Releases (Atom feed, the `releases/latest` redirect and the
  sha512 in `latest*.yml`); private repos are not supported. Automatic checks are off by default, and there is no
  skip-version or interval setting.
- Before installing, child processes are stopped first and restored on failure; when the install watchdog times out,
  the process exits without guessing the state.

### Startup behavior

- Three options: "Start at sign-in" on by default, "Keep running in the tray when the window closes" on by default,
  "Open the main window after sign-in" off by default.
- The main window is hidden only for a start at sign-in, when opening the main window is not chosen, and when the tray
  is available; a manual open always shows it, and so does an unavailable tray.
- A start at sign-in is detected by the `--launch-at-login` argument (Windows/Linux) or the macOS login-item flag.
- Single instance is always on; a second launch shows the existing main window.

## Situations to avoid in the design

- Showing only the stored preference and re-registering the login item at every start overrides the user's disabling
  in the system, and the settings page no longer matches reality.
- The autostart path must respect `XDG_CONFIG_HOME`, and `%` in Exec must be written as `%%`.
- A failed login-item sync must not stop the app from starting.
- The preferences file must be written atomically, and an unreadable file must not lead to other settings being
  overwritten with empty content.
- A bridge/IPC that changes system state must verify its caller.
- Uninstalling or turning the setting off must remove the login items the app created.
- A macOS dialog without a parent window may open behind other windows; the Linux relaunch method may bring in
  NoNewPrivs, making the next pkexec fail;
  the install timeout check must avoid the time the user is typing a password; an unsigned build cannot update itself
  to a signed build.

## This project's current state (code read on 2026-10-14)

- The main window is a fixed 1180×800, centered (macOS/Windows), or the default size (Linux), minimum 380×520;
  position, size and maximized state are not saved.
  While the adjust overlay is shown, the main window gets out of the way if it has focus and comes back at the end
  (ADR-042): minimized on Windows, to the Dock on macOS,
  hidden and restored to its in-memory position on Linux X11, minimized on layer-shell; none of this is written to a
  file.
- Desktop scenes are recalculated per display; card positions belong to each profile's `layout`, go into backups and
  switch with the account (SPEC-003, SPEC-002).
- The only host-level data are `profile.txt` in the data directory and the Linux `display-backend.txt`; there is no
  registry, UserDefaults or other preferences file.
- Startup always shows the main window; closing the main window hides it when the tray is available, otherwise saves
  and exits. There is no start at sign-in or command-line option.
- The data directory uses `owner.lock` to prevent opening twice. On Linux, the GtkApplication brings up the existing
  window; macOS uses the ordinary reopen;
  on Windows, a second process only shows an "already open" error.
- There is no version display or update feature; `host.info` has no app version, and the `appVersion` in backups is
  always recorded as the default 0.1.0.
- Each platform has its own version numbers. Only Windows publishes the MSIX, `.sha256` and CER as a
  `windows-v<version>` prerelease; macOS/Linux have local builds only.
- The renderer CSP is `connect-src 'self'`; native HTTP allows only fixed Google endpoints and rejects redirects; the
  privacy notice lists only Google.

## Portable and platform-specific

- Portable: a versioned host preferences file, largest-intersection work area + clamping + default, debounce plus a
  write on close, atomic writes;
  the update state machine, the capability gate, checking again before downloading, stable error codes;
  start-at-sign-in detection, a manual open always shows, showing when the tray is unavailable.
- Electron-specific: `getNormalBounds`, maximizing a hidden window shows it, `app.exit` does not fire close;
  electron-updater's feed, `latest.yml`, NSIS/Squirrel.Mac; `setLoginItemSettings`.
- This project must decide separately: WPF coordinate units under PerMonitorV2, MSIX StartupTask and the user's
  disabled state, MSIX self-update, macOS install replacement, Linux DEB permissions and restart, GitHub as a new
  network destination.

## Inferences and not verified

- The decisions are in ADR-043/044 and SPEC-006; current implementation and acceptance status is in
  [PROGRESS](../../PROGRESS.md), with history and verification evidence in the git history and
  [testing](../testing.md).
- Start-at-sign-in detection for MSIX StartupTask, reopening after a `PackageManager` self-update, macOS
  start-at-sign-in detection, the redirect host for GitHub release assets and Actions billing for a public repo all need
  checking or testing during implementation.
