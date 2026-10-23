# ADR-043: Main window placement memory and startup behavior

## Status

Accepted, 2026-10-14. The user asked to follow an Electron desktop project and bring in main window placement memory
and "Startup behavior", confirmed that "Start Work Fleet at sign-in" is on by default, and on the same day said to
start the work on that basis; the SPEC-006 questions (Q) are still open. Reference and evidence:
[research](../research/2026-10-14-desktop-window-startup-and-update-reference.md).

Revised 2026-10-17: the user reported that on the installed Pi build "I set it to off, and the main window still
opens", and said to "fix them both" (Linux and Windows). At sign-in, a tray that is "not ready yet" is no longer treated
as "unavailable"; see "Waiting for the tray at sign-in" under Decision.

Revised 2026-10-23: the maintainer merged "Reset main window size and position" into "Reset desktop layout", so one
confirmed reset also returns the main window to its default; see Decision.

## Context

On Windows, macOS and Linux the main window always opened centered at a fixed size and did not remember the position,
size or maximized state the user had set. The app usually sits in the tray, and the main window may stay hidden for
days; in that time a display may be unplugged or change DPI, so checking the position only at startup is not enough.
Desktop notes should appear after sign-in, but there was no start at sign-in; closing the main window always put it in
the tray and could not be changed to exit.

Device settings such as card positions live in each profile's `layout`, go into complete backups and follow account
switches (SPEC-002/003). The main window's placement belongs to how this computer's windows look, and should not move
because a backup is imported or the Google account changes.
Host-level preferences already have precedents: `profile.txt` in the data directory and Linux `display-backend.txt`
(ADR-040).

In MSIX, the start at sign-in is declared as a StartupTask. The user can disable it in Task Manager or Settings, and
the app cannot turn it back on. Re-registering on every start and showing only the stored value (the reference
project's approach) would disagree with the user's choice in the system.

## Decision

### Host preference files

- The data directory gains `host-preferences.json` (startup behavior and the update lastCheckedAt) and
  `window-placement.json`. Both are host level: not per profile, not in backups or Google, and unchanged by account
  switches.
- The format includes `version: 1`. A file that cannot be parsed, has an unknown version or holds invalid values is
  treated as unset and the defaults apply; it never blocks startup.
  Writes are atomic through a temporary file, flush and rename. Uninstalling the MSIX removes them with the package
  data (ADR-037).
- The renderer reads and writes them only through the new `host.*` bridge methods; the host validates the content and
  returns the state that actually took effect. The bridge protocol stays at 1.

### Main window position and size

- Saved: the position and size of the restored (normal) state, and whether the window is maximized. Not saved:
  full screen, minimized, or display identity.
- Coordinates: Windows saves and applies physical screen pixels through `GetWindowRect`/`SetWindowPos`, avoiding WPF
  DIP conversion errors under mixed DPI; `WINDOWPLACEMENT` uses workspace coordinates and is unsuitable for comparing
  with display work areas. Moving to a display with a different DPI scales the window once first, so the placement is
  applied twice. The actual state is read with `IsZoomed`/`IsIconic`.
  macOS uses the window frame in points; Linux X11 saves position and size, and Wayland saves only size and maximized
  state (the compositor decides the position).
- Restore: pick the display work area with the largest intersection with the saved bounds, shrink and clamp into the
  work area if needed, then apply the minimum size; if the bounds intersect no display, use the default. Maximizing is
  applied only when the main window is first shown, so a hidden start at sign-in does not show it for that reason.
- The placement is re-validated every time the main window is shown from the tray, a second launch or a shortcut, not
  only at process start.
- Saving: 500 ms debounce after a move, resize or maximize change; one extra write when going to the tray, on save and
  exit, at system sign-out/shutdown and before an update installs. Unchanged content is not written; a failed write is
  only logged and never blocks closing.
- Minimizing and the step-aside/restore of the [ADR-042](042-adjust-overlay-on-every-desktop-host.md) adjust overlay
  do not change the saved placement; the host still restores from the state it remembers itself.
- The default stays 1180×800 centered on the primary work area; a smaller work area shrinks it to fit, and the minimum
  of 380×520 is unchanged.
- "Reset desktop layout" in Settings > Desktop, once confirmed, also resets the main window: after the layout it
  deletes the saved file and applies the default at once. Until 2026-10-23 this was a separate "Reset main window size
  and position" that left desktop scenes and card positions alone. The browser preview has no host window, so there
  the reset and its text cover only the layout.

### Startup behavior

Settings > Desktop gains a "Startup behavior" section with three options (2026-10-24: the section moved to Settings >
General, which the gear opens; [ADR-059](059-settings-pages-and-entry-points.md)):

1. "Start Work Fleet at sign-in", on by default.
2. "Keep running in the tray when the main window closes", on by default, which is the existing behavior; when off,
   closing takes the existing "save and exit" path. When the tray is unavailable, closing always exits.
3. "Open the main window after a sign-in start", off by default: after a start at sign-in the main window stays hidden
   while desktop notes start as usual, and the tray or a second launch opens it.
   A manual launch always shows the main window, and so does a start when the tray is unavailable.

Waiting for the tray at sign-in (revised 2026-10-17):

- At sign-in, the panel or taskbar that provides the tray may become ready later than Work Fleet. Raspberry Pi OS starts
  `wf-panel-pi` in the same second as Work Fleet, and libayatana sends `connection-changed False` about 0.05 s before
  the StatusNotifierWatcher appears; older builds took this as the tray disappearing and showed the main window at once.
  A Pi reboot with the fixed build is not yet verified (as of 2026-10-17).
- A hidden start waits up to `trayWaitSeconds` seconds for the tray. If the tray appears in that time the window stays
  hidden; only on timeout does the main window show. Opening the app again still shows it at once.
- `trayWaitSeconds` is defined only in `config/startup.json`. The build writes it into the `startup` section of
  `Config/public.json`, which every platform ships, and Linux and Windows read it from there. Without a valid value
  there is no wait, and the decision follows the tray state at once. It is product behavior, so it is not in `.env`,
  and builders cannot tune it individually.
- Only a tray that was connected and then disappeared shows a hidden main window at once.
- Windows hides the main window first after the page loads. If adding the icon fails, it retries every 2 seconds for up
  to 1 minute, after which `TaskbarCreated` still adds it later. A real `Shell_NotifyIcon` failure at sign-in has not
  been observed or tested (as of 2026-10-17).
  The macOS menu bar icon is created synchronously and needs no wait.
- The initial value of 30 seconds is an estimate, not measured. On Windows and Linux, `host.log` records every change
  in tray availability with the seconds since start (`uptime`), plus one line when a timeout shows the main window;
  the value will be tuned from real sign-in records. The Linux `host.log` uses the same format and rotation rules as
  the Windows one from ADR-045.

Operating system registration:

- Windows MSIX: the manifest adds `uap5:StartupTask` (the `windows.startupTask` extension), and the app calls
  `RequestEnableAsync` or `Disable` according to the preference. When the state is `DisabledByUser`/`DisabledByPolicy`
  it does not try to override it; the settings page shows the system state and offers to open the Windows "Startup
  apps" settings (`ms-settings:startupapps`).
  A start at sign-in is detected from StartupTask activation. ZIP/Debug builds do not support starting at sign-in: the
  option is disabled with a note that only the installed build supports it, and no Run key is written.
- macOS: `SMAppService.mainApp` registers and unregisters (deployment target 13.0). On `requiresApproval` the page says
  approval is needed in System Settings and offers to open the Login Items settings. When a start at sign-in cannot be
  detected reliably, it is treated as a manual launch and the main window shows.
  Detection relies on the login-item flag of the open-application Apple event; whether that flag is reliable under
  SMAppService is unverified on a Mac (as of 2026-10-17).
  A main app that has never been registered may return `notFound`; that counts as not enabled and registrable, and must
  not be used to disable the setting or to infer that the app is not in "Applications".
  The default registration on first launch accepts `notFound`/`notRegistered`; an existing preference is not retried
  automatically, but the user can still turn it on by hand.
  `enabled`/`requiresApproval` are not re-registered; turning off a service that was never seen does not call
  `unregister`.
  The source of the fix and its verification limits:
  [login item research](../research/2026-10-15-macos-login-item-first-registration.md).
- Linux: writes or removes `$XDG_CONFIG_HOME/autostart/work-fleet.desktop` (`~/.config` when unset), with
  `--launch-at-login` added to the start command. On read-back, a missing file, `Hidden=true` or
  `X-GNOME-Autostart-enabled=false` counts as off. It writes or removes only its own file.
  Raspberry Pi labwc runs XDG autostart: on 2026-10-17 the host started at sign-in with `--launch-at-login` in the same
  second as `wf-panel-pi`. A process started by an in-app update has no `--launch-at-login` and shows the main window by
  design; do not read it as evidence of a sign-in start.
- Windows syncs on every start and whenever the option changes: for a packaged desktop app, `RequestEnableAsync` shows
  no prompt and does not override a user's disable.
  macOS and Linux have no such protection, so they apply the default only on first launch (no `host-preferences.json`
  yet) and write when the user changes the option; later starts do not recreate an entry the user removed. When the
  system state read back differs from the preference, the page shows the system state.

### Second launch

Windows adds a single-instance channel per user and per data directory: a second process asks the running instance to
show the main window and then exits normally, instead of showing an "already open" error. `owner.lock` remains the
last safeguard. macOS keeps using reopen, and Linux keeps using GtkApplication activation.

## Consequences

### Positive

- The main window comes back at the position and size the user is used to, and does not open off screen after a
  display change.
- Desktop notes appear automatically after sign-in, and a user's choice to disable the start at sign-in in the
  operating system is respected.
- Opening the app again after a hidden start brings up the existing window instead of an error.

### Negative

- Each of the three platforms implements coordinates, registration and single instance separately; mixed DPI and
  multiple displays need acceptance on real hardware.
  The Linux Docker probe proves only that a hidden start realizes the main window without showing it and shows it
  later; it does not prove that the WebKit page loads and starts desktop notes while hidden (2026-10-14). A real
  sign-in autostart on Debian GNOME and Xorg is unverified.
- With the default on, the first launch already registers the login item; macOS shows a system notification.
- Removing the Linux DEB cannot remove each user's autostart file, so it must be turned off in Settings first; a file
  left behind points to a command that no longer exists.

### Neutral

- Uninstalling the MSIX also removes the placement, the preferences and the StartupTask.

## Alternatives Considered

### Alternative 1: Store it in each profile's `layout`

- **Pros**: Reuses the existing settings access and bridge.
- **Cons**: It would go into backups and be imported on another computer, and the main window would move on account
  switches.
- **Why rejected**: It breaks SPEC-003's boundary between shared content and per-device appearance.

### Alternative 2: Re-register the start at sign-in from the preference on every start (the reference project's approach)

- **Pros**: Simple to implement.
- **Cons**: It may override a disable the user set in the system, and the settings page would disagree with reality.
- **Why rejected**: The system state takes precedence; the app only shows it and guides the user.

### Alternative 3: Use the HKCU Run key on Windows

- **Pros**: Works for the ZIP too.
- **Cons**: Uninstalling the MSIX does not remove it, so it is detached from the package lifecycle.
- **Why rejected**: The installed build uses StartupTask; the ZIP is for testing and portable use and does not offer a
  start at sign-in.

### Alternative 4: Use `setFrameAutosaveName` on macOS

- **Pros**: Built into the system, with the least code.
- **Cons**: Its format and validation rules differ from the other platforms, so tests and reset behavior cannot be
  shared.
- **Why rejected**: All three platforms use the same rules and file format.

## References

- [SPEC-006](../specs/006-desktop-window-startup-and-updates.md), [PLAN-006](../plans/006-desktop-window-startup-and-updates.md), [research](../research/2026-10-14-desktop-window-startup-and-update-reference.md)
- [ADR-019](019-windows-shortcuts-and-tray.md), [ADR-020](020-windows-display-lifecycle.md), [ADR-037](037-msix-data-lifetime-and-google-backup-overwrite.md), [ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md), [ADR-040](040-gnome-wayland-xwayland-choice.md), [ADR-042](042-adjust-overlay-on-every-desktop-host.md)
- [StartupTask](https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.startuptask), [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice), [XDG Autostart](https://specifications.freedesktop.org/autostart-spec/latest/)

---

*Decision made: 2026-10-14*
*Decision makers: Maintainer*
