# Linux native host

Python 3.10+, GTK 3, WebKitGTK 4.1 (WebKit 2.40+), PyGObject/cairo and cryptography, provided by the Linux
distribution. This is not the Python note server;
the native GTK main window loads the packaged `workfleet://app/app/index.html`, and there is no resident HTTP listener.
Python 3.10 is for Ubuntu 22.04; the WebKitGTK 2.36 that 22.04 shipped with is not enough, and the newer version from
jammy-security must be installed (2.50.4 on amd64 in 2026-10). The code must not use syntax from 3.11 or later, which
`tests/test_linux_python_floor.py` checks.

```bash
npm ci --ignore-scripts
bash scripts/linux/build-native-app.sh
bash "build/linux/work-fleet-$(cat src/native/linux/VERSION)/run-work-fleet.sh"
# Build the installation package where Debian tools are available:
bash scripts/linux/build-native-app.sh --deb
bash scripts/linux/build-native-app.sh --release --deb
```

The launch script prefers `/usr/bin/python3`, so that a pyenv/virtualenv `python3` on the PATH without the
distribution's GI bindings is not used;
set `WORK_FLEET_PYTHON` for another interpreter, and only an environment without `/usr/bin/python3` uses the `python3`
on the PATH.

The Linux client ID in `.env.example` is a Google Desktop app type. Without Google configured, notes can still be
taken offline; sign-in uses the system browser with PKCE/state and a temporary loopback callback, which closes on
completion or after a 110-second timeout.
After sign-in the account workspace is created from the HTTPS userinfo sub; the system Secret Service stores the access
and refresh credentials, and the renderer never reads credentials.
Drive uses only fixed appDataFolder FileStore operations, with SHA-256/metadata checks and 1 MiB resumable chunks.

Data is in `$XDG_DATA_HOME/WorkFleet` by default (usually `~/.local/share/WorkFleet`); `--data PATH` selects a new
directory with the same protection. [ADR-047](../../../docs/decisions/047-linux-local-key-without-keyring-prompts.md) and
[ADR-048](../../../docs/decisions/048-linux-offline-workspace-and-system-secrets.md):
SQLite payloads and native backup metadata are encrypted with AES-GCM; the 32-byte master key is stored in
`storage-key` (0600) in the same directory,
which must belong to the current user and be 0700. Starting a local or a Google workspace never asks for a keyring
password.
Google tokens and saved automatic-backup passwords are stored in the unlocked persistent default keyring; SQLite keeps
only references and the revocation state,
and when the vault is unavailable there is no fallback to local storage. Switching accounts and clearing a workspace keep
the Google credentials; clearing revokes only that profile's backup password, and sign-out saves a revocation marker
first.
Local notes are protected by the OS account and file permissions; anyone who can read the whole data directory can still
decrypt the notes, and losing `storage-key` loses the data.
SQLite revisions and new attachments share one transaction, and flock keeps a single owner; backups across machines use
the app's portable ZIP.

The first start after an older version migrates the original keyring key: libsecret reads only unlocked items, and
the local key is saved atomically only after the existing encrypted payloads of all accounts are verified; the original
keyring items are never rewritten or deleted. If the original keyring is still locked, no password dialog appears;
a one-time migration message is shown and the data is kept. Unlock it in the system keyring manager and reopen the app,
or restore from a portable backup.
A new data directory and offline notes whose master-key migration is complete need no Secret Service; Google and saved
backup passwords need libsecret and an unlocked persistent vault.
Start-up and background sync never ask for the keyring password. When it is locked, sync shows as paused ("Sync
paused"); "Sync now" opens the system unlock dialog,
and after a successful unlock the original account's sync continues without signing in again. Cancelling or a timeout
can be retried, and no prompt appears when the keyring is already unlocked.
The app never receives the keyring password; the interactive unlock does not occupy the note storage worker. Other
problems, such as a missing Secret Service, never ask for an unrelated password.
Encrypted backups pause only the jobs that need to read the password, keep the last successful backup and the pending
work, and never fall back to plaintext.
Old local credentials and backup passwords migrate after the page is ready or when used; once the vault save and
read-back are confirmed, the current DB/WAL copies are cleaned up.
On failure the copies are kept, but the vault is never bypassed. Until the migration completes, the older version's
weaker protection still applies, and old snapshots or backups are not guaranteed to be cleared.
The data schema is raised to 2; downgrading to a schema 1 program refuses to open, so secrets are never copied back to
local storage.

The native folder chooser saves the authorized location and the device/inode identity; new backups use
O_EXCL/NOFOLLOW and fsync/read-back confirmation. Automatic jobs check the journal, the native creation record, the
latest confirmed backup and the number to keep,
and clean up only files they created that still match the original identity. When the file system cannot support the
confirmation steps, the file is kept and a failure is reported.
Portable password-protected backups share the PBKDF2-600000/AES-GCM ZIP format with Windows, Apple and Android.

The build entry point produces a source/runtime tar.gz, and the Debian variant declares the system runtime dependencies;
it carries no private keys, tokens, user data or copied Python/GTK binaries. Signing and repository publication still
wait for a real environment.
The Linux version is recorded in `VERSION` in the same directory, and the DEB, tar.gz and bundle names all come from it;
early versions get no extra `~preview`;
a release still needs the final public app settings and a support email as the maintainer contact.
The shared `scripts/linux/package-deb.sh` uses a new staging directory each time and installs the launcher, desktop
entry, icons and notices.
The desktop entry passes validation but has both Office and Utility as main categories, so some menus may list it twice
(2026-10-05).
The Linux and Windows build entry points produce `build/work-fleet_<version>_all.deb` and a `.sha256` of the same name
directly, with no manual file moves;
staging is removed automatically when the packaging script ends; the tar.gz is in `build/` next to the DEB, the
source/runtime copy is in `build/linux/`, and both are regenerated on every build.
On Windows, `scripts/windows/Build-LinuxPackage.ps1` packages with dpkg-deb in a pinned Ubuntu image on the existing
Docker Linux engine; the container mounts only the generated bundle/output and the script, and never runs GTK or
installs the app.
With layer-shell each display has three WebKit scenes: the Desktop layer on BOTTOM, the Top layer on TOP and the
Wallpaper layer on BACKGROUND;
the main window holds the only workspace, and scenes only send commands, drafts and frames.
Adjust this group temporarily moves the group to the Top layer, and ending it restores the current persistent
preference without changing positions. The Wallpaper layer is always click-through and never has keyboard focus.
On layer-shell, adjust mode is an overlay: a Top layer scene covers the whole display (including panels), and during
adjustment the EXCLUSIVE keyboard mode makes Esc work immediately.
Top layer notes outside the adjusted scope are drawn below the overlay. A main window that has focus when adjustment
starts is minimized and brought back with xdg-activation afterwards; if that is refused, it is shown again
(the compositor chooses the position). A main window that is already minimized or has no focus is left alone and is not
brought back afterwards. X11 also uses an overlay (covering the work area),
consistent with Windows and macOS ([ADR-042](../../../docs/decisions/042-adjust-overlay-on-every-desktop-host.md)).
`pcmanfm --desktop` draws the wallpaper and the icons on the same surface, so background notes could only cover the
icons. When it is detected on the same Wayland display,
no Wallpaper layer is created and the wallpaper preference falls back to the Desktop layer. Detection runs only at
start-up; after switching to swaybg (`use_swaybg=1`, without desktop icons), reopen the app to get the Wallpaper layer.
X11 keeps two layers: a wallpaper request explicitly falls back to the desktop, the original preference is still saved,
and "Group settings" states the unsupported layer and the layer actually shown.
Under GNOME Wayland through XWayland, the desktop icons (DING) cover X11 desktop-type windows with a transparent Wayland
window and receive the clicks,
and the top level also blocks other windows, so groups can stay only on the Wallpaper layer, and Desktop and Top layer
preferences explicitly fall back to the Wallpaper layer. Adjust mode covers the work area with an overlay,
the main window is hidden and returns to its place afterwards, and the overlay offers Stack, Spread, Undo and Done.
GNOME Xorg has none of these limits and offers three layers:
the Desktop layer uses an ordinary window with keep below to stay above DING reliably, and the Wallpaper layer may show
above the icons until the user has clicked the desktop;
see [ADR-039](../../../docs/decisions/039-gnome-desktop-icons-and-x11-scene-size.md).
GNOME Wayland has no layer-shell, so desktop notes go through XWayland: the first start asks "Use XWayland to show desktop
notes?", and later "Show desktop notes through XWayland" on the Desktop page of the settings switches it, followed by a
restart ("Restart now");
the preference is stored in `display-backend.txt` in the data directory, and a `GDK_BACKEND` set by the user takes
precedence and disables the setting ([ADR-040](../../../docs/decisions/040-gnome-wayland-xwayland-choice.md)).
The dialog, the restart and the settings row of the XWayland switch have no automated tests; a non-default `--data` path,
cancelling the restart with an unsaved draft, and GNOME with XWayland disabled are untested (2026-10-13).
A regular Xorg session has not been tested on a real machine.
X11 uses native window levels and input regions, and the scenes cover the display's work area (the window manager pushes
ordinary windows away from the taskbar);
the windows cannot be resized, and their size comes from the viewport size request;
Wayland uses compositors that GtkLayerShell supports.
GTK on Wayland reports a monitor's whole geometry as its work area, so layer-shell scenes would place new papers under a
panel and count a title behind it as reachable. Layer-shell work areas therefore come from `_NET_WORKAREA` on the XWayland
root window, read through libxcb and intersected with each monitor; labwc publishes it (wf-panel-pi on a 1920×1080 Pi
display: `0, 36, 1920, 1044`, a 36 px panel at the top). A thread of its own reads it every two seconds over one
connection, so an Xwayland that is starting or stalled holds up GTK for at most 3 s at start (waiting for the first
sample) and 1 s on a display change (waiting for a fresh one); a read that fails keeps the sample before it. A panel
that moves or resizes is picked up by the next display poll, and a paper whose title it then covers is rescued as on a
display change.
Without XWayland, libxcb or the property, or when the X root does not span the GTK monitor layout (a compositor that
scales XWayland itself), papers keep 48 px clear on every edge, which clears the usual panels at scale 1. That margin is
a guess, so it waits for a definite answer: until Xwayland first answers, and for up to 10 s while a new connection
lacks the property or the X root still shows the layout before a display change, the monitor keeps its whole area, and
papers near an edge are not rescued on a transient.
`_NET_WORKAREA` is one rectangle for the whole layout, so with several displays only panels on the outer edges of the
layout count: a panel at an inner edge (for example at the bottom of the shorter of two top-aligned displays) is
missed, and a panel on one display also narrows a display beside it on the same outer edge.
Holding the connection keeps an Xwayland that the compositor starts on demand running while Work Fleet does.
The scenes still cover the whole monitor, so adjust mode keeps covering panels.
Without layer-shell support the reason is reported, and notes can still be taken in the main window. Areas outside cards
and papers that cannot be operated do not intercept desktop input.
Input regions are set on the GTK widget with a queued draw, so click-through is not lost after reallocation; the
viewport size request is set explicitly.
After map, configure and frame events a full redraw is merged in, avoiding partial leftovers in transparent WebKit. Only
on a Raspberry Pi (device-tree model) or
with the V3D driver loaded, and only if the user has not set it, `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` is the default, which
avoids the known Pi/V3D DMA-BUF corruption.
The DMA-BUF renderer is not disabled instead, because then a scene disappears entirely when the mouse moves over it, and
on other machines ghost images stay where a note was moved away.
Display, workspace and sleep changes stop scene input first; after drafts are saved, the main window applies the new
layout and keeps the original WebView.
X11 shortcuts use Keybinder 3 raw matching (the default cooked matching makes Ctrl+Shift with a letter or digit be
intercepted without triggering);
labwc offers no way for a program to register global shortcuts, so pressing "Write the labwc settings" ("Write the
labwc settings again" after a change) on the Shortcuts page of the settings writes the current combination into a block of rc.xml that Work Fleet manages (after a backup, with `labwc --reconfigure`),
and the keybind runs `gapplication action <app id> shortcut` to hand it to the app
([ADR-041](../../../docs/decisions/041-labwc-shortcuts-through-rc-xml-keybinds.md));
otherwise the XDG GlobalShortcuts portal is used, which needs a matching backend from the desktop.
The system can reassign keys, and the settings show the actual trigger description. Global registrations are released
while the app has focus or a dialog is open;
rebuilding the portal session may show the system authorization UI again, and the real flow still awaits confirmation in
a native environment.
Ayatana/AppIndicator or Gtk.StatusIcon provides the tray, whose tooltip reads "Work Fleet"; the main window is hidden only
after the tray is confirmed available.
Quitting from the tray uses the draft save flow; if a tray that was connected disconnects, the main window is restored,
and an account switch closes the old desktop session.
The main window size, X11 position and maximized state are stored in `window-placement.json` in the data directory, and
the start-up behaviour in `host-preferences.json` (ADR-043).
Launch at login writes `$XDG_CONFIG_HOME/autostart/work-fleet.desktop` (`work-fleet` for the DEB, the bundle's launcher
for the tar.gz; running from source is not supported),
rewritten only when the default is applied at the first start and when the user changes it. With `--launch-at-login` the
main window stays in the tray; because the panel can become ready later than the app at login, the main window is shown
only if the tray has not connected within `trayWaitSeconds` seconds from `config/startup.json`.
`host.log` in the data directory records each start, each change in tray availability and the seconds since start, with
the same format and rotation as Windows (ADR-045), and no note content.
`updater.py` (ADR-044) is enabled only for DEB installs: it checks the `linux-v<version>` releases, downloads and verifies
the package, installs it with pkexec, then saves and restarts on success.
Native scene regressions for this product can run in an isolated headless labwc; the commands are in
[testing](../../../docs/testing.md).
Current status is in [PROGRESS](../../../PROGRESS.md), and verification evidence is in [testing](../../../docs/testing.md)
and the git history; headless x64 tests are never taken as acceptance of the Pi/V3D,
pcmanfm-pi, libsecret, real Google or a Debian installation.

## Localization

- The Settings > General > Display language choice (`auto`, `en` or `zh-TW`) is the `language` field of
  `host-preferences.json` in the data directory, next to the start-up settings; it is never part of a profile, a backup
  or Google data. The host resolves it before any window opens, so the tray of a sign-in start is already in that
  language; `auto` reads the session languages from `LANGUAGE`, then `LC_ALL`, `LC_MESSAGES` and `LANG`.
- The host's own text (tray, pickers, dialogs and the reasons it returns for the page) is in `text.py`, with an
  `i18n:en` and an `i18n:zh-TW` block.
- `host.language.set` saves the preference, re-resolves the locale, relabels the tray menu in place and replies with
  `{ preference, system }`; reasons and update text follow when they are next read.
- The autostart entry carries an English `Comment=` and a localized `Comment[zh_TW]=`, so the system's startup list
  shows the description in its own language. The rules are in [Internationalization](../../../docs/i18n.md).

## Desktop environment support

Updated: 2026-10-17. Verified on real machines: full use of Ubuntu 22.04 GNOME Wayland (through XWayland), and on the
same x86 VM, window layering and global shortcuts of GNOME Xorg signed in over xrdp (interaction with each layer not yet
tested); both with a single display. A Raspberry Pi 5 with labwc was also checked on the device (see below). There are
also isolated headless labwc automated tests, which are not a real desktop acceptance.
The following describes the program's behaviour; anything not tested on a real machine is not thereby supported.

Common to all desktops:

- New workspaces and offline notes whose master-key migration is complete need no keyring; the local key is stored with
  0600/0700 permissions.
  Google tokens, saved backup passwords and the first migration of old data need libsecret and an unlocked Secret
  Service; a locked one pauses only the related features.
- Only a DEB is provided (Debian/Ubuntu family). Fedora, Arch and openSUSE need the tar.gz and their own installation of
  Python 3.10+, GTK 3,
  WebKitGTK 4.1, PyGObject and cryptography; distributions without WebKitGTK 4.1 (such as Ubuntu 20.04 and Debian 11)
  cannot run it.
- The tray needs AppIndicator/StatusNotifier or a legacy system tray; without one, closing the main window quits the app.
  Ubuntu provides one by default; plain GNOME does not. The GNOME AppIndicator extension logged `unable to update icon`
  once on Ubuntu 22.04 (2026-10-13).
- Global shortcuts: X11 sessions use Keybinder, which receives nothing under XWayland; on labwc the settings page writes
  the shortcuts into rc.xml keybinds (ADR-041);
  other Wayland desktops need the GlobalShortcuts portal, which GNOME 42 and the wlroots portal (sway, wayfire) lack.
- Attachment thumbnails from installed thumbnailers and opening with the default app have not been checked on a real
  Linux desktop, and text fitting with "…" has not been checked in WebKitGTK (as of 2026-10-17).

Per desktop:

- GNOME Wayland: native Wayland has no desktop notes; they appear only after choosing XWayland at the first start or in
  the settings.
  Through XWayland there is no persistent Desktop layer or Top layer, so notes show only on the Wallpaper layer and cannot
  be operated; adjust mode is an overlay, during which other programs cannot be clicked. This is currently the only
  environment fully tested on a real machine.
- GNOME Xorg: three layers, Wallpaper, Desktop and Top; the Desktop layer is above the desktop icons and allows text
  selection, the Top layer can take focus, and adjust mode is an overlay (not tested on Xorg);
  the Wallpaper layer may show above the icons until the user has clicked the desktop. Only window layering, and global
  shortcuts actually triggering while the main window is in the tray, were verified, in an xrdp remote session;
  interaction with each layer and a local Xorg sign-in are not tested.
  Over xrdp, WebKit logs `libEGL warning: DRI2: failed to authenticate` at start (2026-10-13).
- KDE Plasma Wayland: KWin supports layer-shell, so the three-layer path applies; the Plasma desktop is also on the
  layer-shell background layer,
  so Wallpaper layer notes may be covered by the desktop or have an undefined order. Not tested.
- X11 desktops (KDE X11, Xfce, Cinnamon, MATE, LXQt, LXDE): only the Desktop layer and the Top layer; the wallpaper
  preference falls back to the Desktop layer.
  The file manager draws the icons with a desktop-type window, so Desktop layer notes may be covered and not clickable,
  similar to GNOME's DING. Not tested; the adjust overlay has not been checked on a real machine either (as of
  2026-10-14).
- Raspberry Pi OS (labwc, wayfire): the originally intended main target. The default pcmanfm desktop draws the wallpaper
  and the icons on the same surface,
  so there are only the Desktop layer and the Top layer, and the wallpaper preference shows on the Desktop layer; with
  swaybg (no desktop icons) there are three layers.
  Papers that prefer the Wallpaper layer show on the Desktop layer and sit above the desktop shortcuts, as designed; the
  group-settings text for unsupported layers was not checked in a screenshot on the device (2026-10-14).
  Adjust mode is an overlay, during which panels and other programs cannot be clicked, as on all layer-shell desktops.
  A Pi 5 with labwc confirmed on the device that the adjust overlay stays complete after moving the mouse; wayfire and
  multiple displays are not yet accepted.
  `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` is confirmed on the device; full DMA-BUF was not re-checked there (2026-10-14).
  XDG autostart works under labwc, and the in-app DEB update to 0.2.7 worked through pkexec (observed 2026-10-17).
  The real Secret Service unlock dialog, password entry and a reboot with the manual-sync unlock are not yet verified (as
  of 2026-10-17).
- sway, Hyprland and other layer-shell compositors: the three layers work, but there are usually no desktop icons; sway
  has no global shortcuts portal,
  and the tray depends on the panel. Not tested.
- Other Wayland desktops without layer-shell support: no desktop notes; the XWayland option is offered only on GNOME,
  and other desktops must set `GDK_BACKEND=x11` themselves.

Not yet verified on any Linux desktop: multiple displays, HiDPI/fractional scaling (blurrier under XWayland), and Chinese
input methods in WebKitGTK.
Real Google sign-in and Drive sync: the Desktop client shared with Windows has existed since 2026-10-06, and user reports
from 2026-10-15 to 2026-10-17 show real sign-in and sync in use on the Pi and other Linux installs. No structured
cross-device acceptance is recorded.
