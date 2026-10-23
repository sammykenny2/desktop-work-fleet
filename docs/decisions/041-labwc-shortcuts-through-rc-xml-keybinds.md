# ADR-041: labwc global shortcuts reach the app through rc.xml keybinds

## Status

Accepted, 2026-10-14. On a Raspberry Pi 5 with labwc, the maintainer reported that shortcuts could not switch layers
when the main window was not focused or was minimized. After comparing "the app writes rc.xml", "provide only a
configuration snippet" and "do nothing for now", the maintainer chose to have the app write it.
Revised 2026-10-23: for other compositors without a GlobalShortcuts portal (sway, wayfire), the maintainer chose named
GApplication actions (`quick-capture`, `region-1` and the others, `show-main`, `quit`) that the user binds in the
compositor's own configuration, documented in the user guide; Work Fleet writes no configuration for them.

## Context

On Linux X11, global shortcuts are registered through Keybinder; other environments use the XDG GlobalShortcuts portal
(the Linux README around ADR-039). labwc has no protocol for clients to register global shortcuts. This Pi runs
`xdg-desktop-portal` 1.20 with `-wlr` 0.7.1 and `-gtk` 1.15, and the portal on the session bus has no
`org.freedesktop.portal.GlobalShortcuts`. So on labwc, shortcuts work only while a Work Fleet window has focus.

labwc's own keybinds can run commands. Verified with a virtual keyboard on headless labwc 0.20.2: `C-S-1`, `C-S-d`,
`C-S-F5` and `C-A-0` all fire, and letters match the keysym without Shift. When a keybind runs
`gapplication action <app id> shortcut "'Ctrl+Shift+1'"`, the GTK Application on the same session bus receives the
string parameter `'Ctrl+Shift+1'`.
Raspberry Pi OS starts `labwc -m`, which merges the system `/etc/xdg/labwc/rc.xml` with the user configuration; this
Pi has no user rc.xml. Without `-m`, the user rc.xml replaces the system configuration.

## Decision

- Under layer-shell, the Linux host finds the running labwc from `LABWC_PID` and reads its cmdline for the merge mode
  and `--config-dir`; the default is `$XDG_CONFIG_HOME/labwc/rc.xml`. It is enabled only when the App ID is a valid
  D-Bus name. The portal is not used in this case.
- The app exports a `shortcut` action on D-Bus (the string parameter is a Work Fleet key, for example
  `Ctrl+Shift+1`). On receipt it finds the target from the current settings and follows the global shortcut's
  `desktop-action` path; it ignores the action while Settings is recording a shortcut or a native menu is open.
  labwc runs the keybind whatever has focus, so when Work Fleet itself has focus the shortcut takes the same path,
  and the focused window supplies the intent.
- rc.xml holds only keys, not groups; pointing a region shortcut at another group needs no rewrite.
- On labwc, the Shortcuts page in Settings shows the rc.xml state (not written, needs updating, matches the current
  keys) and a write button; it writes only when the user presses it.
  Writing replaces only the block between the `Work Fleet shortcuts: begin` and `end` comments; when there is no block,
  it goes at the start of `<keyboard>`, creating `<keyboard>` if needed.
  Both the original file and the result must be well-formed XML, or nothing changes; a file that is not UTF-8 is not
  changed either. Before the first change to an existing file it is copied to `rc.xml.work-fleet-backup`, and that
  backup is never overwritten afterwards. The write uses a temporary file in the same directory, fsync and an atomic
  replace that keeps the permissions, then runs `labwc --reconfigure`.
- When creating a new rc.xml: in merge mode it contains only the block; in non-merge mode it first copies
  `labwc/rc.xml` from the first `XDG_CONFIG_DIRS` entry, so the system keybinds are not lost.
- The keys written to labwc are the ones that can be registered (the same rules as Keybinder); keys reserved for text
  editing, `Ctrl+Alt` letters and the like are not written.
  A key that is not written shows "Not written to the labwc configuration", and the portal's re-register button no
  longer appears. The DEB recommends `libglib2.0-bin` (`gapplication`).

## Consequences

### Positive

- On labwc, shortcuts switch layers, adjust groups or show desktop notes from any program, without portal support.
- The user's existing rc.xml content, comments and keybinds stay unchanged; a malformed file is never overwritten, and
  the backup keeps the version from before the first change.

### Negative

- After changing a key, the user must press write again. After the app is removed, the block stays in rc.xml and the
  keys run a `gapplication` that cannot find the app.
- labwc intercepts these keys whatever has focus, so other programs never receive them; pressing one while typing also
  triggers it. While Settings records a new key, keys already written are intercepted by labwc.
- Other programs of the same user can trigger the `shortcut` action over the session bus; only keys in the current
  settings are accepted, with the same effect as pressing the shortcut.
- labwc does not always attach an activation token when it runs a command, so actions that bring the main window to
  the front (for example Quick capture) may fail to take focus while another program has focus.

### Neutral

- Tested on a real device only on one Pi 5 with labwc 0.20.2; `--config-dir`, non-merge mode and the `openbox_config`
  root element have only unit tests.
- Other wlroots compositors (sway, Hyprland, wayfire) still have no global shortcuts.

## Alternatives Considered

### Alternative 1: Provide only a configuration snippet

- **Pros**: The app does not modify the user's compositor configuration.
- **Cons**: The user must edit XML, convert the key syntax, and resynchronize by hand after every key change.
- **Why rejected**: The maintainer chose to have the app write it.

### Alternative 2: Do nothing for now

- **Pros**: No risk of modifying user configuration.
- **Cons**: On labwc, shortcuts work only while a Work Fleet window has focus, and layers cannot be switched once the
  main window is minimized.
- **Why rejected**: The Pi is the original primary target, and this is exactly the problem the maintainer reported.

### Alternative 3: Wait for the portal or listen to input ourselves

- **Pros**: Consistent with other desktops, or independent of labwc.
- **Cons**: The wlroots portal has no GlobalShortcuts; reading input devices needs extra permissions and breaks the
  no-keyboard-hook principle.
- **Why rejected**: The first has no timeline; the second is unacceptable.

## References

- [ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md), [ADR-040](040-gnome-wayland-xwayland-choice.md),
  [Linux README](../../src/native/linux/README.md).
