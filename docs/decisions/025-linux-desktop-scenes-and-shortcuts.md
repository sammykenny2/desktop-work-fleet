# ADR-025: Linux desktop scenes, shortcuts and tray

## Status

Accepted, 2026-10-05; the code is wired in. Later native scene tests are in the git history and `docs/testing.md` (current
status in `PROGRESS.md`); the full host, portal and tray have not yet passed acceptance on real machines.

The BACKGROUND third layer, the widget input shape, full redraws and the native scene regression entry points are updated by
[ADR-031](031-macos-and-linux-wallpaper-scenes.md); the actual results are in the git history and `docs/testing.md`.

## Context

SPEC-003 requires desktop layers, pass-through on empty areas, a chosen group or All, shortcuts and the display life cycle.
The GTK owner of ADR-024 holds the only Workspace; scenes use the shared renderer and do not add a second card authority.

## Decision

- Per display, one transparent GTK/WebKit window each for desktop and floating; X11 uses window layer hints,
  Wayland uses GtkLayerShell BOTTOM/TOP. When no usable backend exists, the reason is reported and the main window stays.
- A fixed scene document and an owner mailbox; scenes only get the projection, draft commands and short-lived input intents,
  with no database, Google or backup capability. Transfers are bound to source, size and SHA-256; operations from old scenes
  or accounts become invalid.
- The native input region is clipped in paper order: non-interactive papers cover the interactive area beneath them, and
  empty areas do not intercept desktop events. Input is applied only after the frame is confirmed; on a display change, input
  is revoked first and the owner is told to save drafts and apply the topology.
- The WebView that holds the editor is kept; workspace, monitor and sleep/wake changes all use the same topology flow.
  Focus requests need recent native input or a shortcut intent; Wayland uses the activation token provided by the portal.
- X11 prefers Keybinder 3; other cases use the GlobalShortcuts portal. The actual trigger description is shown in Settings.
  App focus, composition or editor blocking, and native dialogs release the global registrations; they are registered again
  on resume.
- The tray uses Ayatana/AppIndicator or Gtk.StatusIcon; the main window is hidden only after the tray is confirmed reachable.
  When the tray disconnects, the main window comes back; quitting uses the shared save flow. Since 2026-10-06 the window
  close button only hides the main window when the tray is available. Native menus and file choosers block global shortcuts.

## Consequences

The Linux host is connected to the shared desktop protocol; the distribution provides the related GI runtimes and portal
backends.
The compositor can refuse layers or focus; without a backend, desktop features are not claimed as supported.
Re-creating the portal session may show the system authorization dialog again; this behavior and real X11/Wayland input
have not been run.
The source tar.gz does not mean that native operation, Debian installation or a full five-platform release is complete.

## Alternatives Considered

One window per card would change the shared stacking order and the editing life cycle. Permanently intercepting the whole
desktop violates pass-through on empty areas.
Keeping global shortcuts registered and only ignoring the callback cannot release the keys for text input, so real
unregistration is used.

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md), [ADR-024](024-linux-native-owner-and-storage.md).
- [Linux host](../../src/native/linux/README.md).
- [GtkLayerShell](https://wmww.github.io/gtk-layer-shell/).
- [GlobalShortcuts portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html).

*Decision made: 2026-10-05*
