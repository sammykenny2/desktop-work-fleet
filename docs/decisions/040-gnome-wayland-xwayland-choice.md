# ADR-040: Choosing XWayland on GNOME Wayland

## Status

Accepted, 2026-10-13. The maintainer asked for a setting and a question at first launch; this resolves the decision that
[ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md) deferred.

## Context

GNOME Wayland has no layer-shell, so a native Wayland start has no desktop notes; the wallpaper layer and the adjust
overlay of ADR-039 work only with `GDK_BACKEND=x11` through XWayland. Clicking the icon in the application menu starts
the app on native Wayland, so the user has to remember to add the environment variable by hand. Switching to XWayland
also moves input methods and scaling in the main window to XWayland, so the app should not switch automatically without
the user knowing. GDK reads `GDK_BACKEND` when it loads, so the choice must take effect before GTK starts and cannot
live only in the web page.

## Decision

- The data directory (by default `$XDG_DATA_HOME/WorkFleet`, or `--data`) holds `display-backend.txt` with the value
  `x11` or `wayland`, written through a temporary file, fsync and rename; the directory permission is 0700.
- `host.py` reads it before loading GTK: in a GNOME Wayland session (`XDG_SESSION_TYPE=wayland`, both `WAYLAND_DISPLAY`
  and `DISPLAY` present, `XDG_CURRENT_DESKTOP` containing GNOME) where the user has not set `GDK_BACKEND`, the choice
  `x11` sets `GDK_BACKEND=x11` and marks with `WORK_FLEET_GDK_BACKEND` that Work Fleet set it. The user's own
  `GDK_BACKEND` always takes precedence.
- When no choice has been made yet, the session is native GNOME Wayland and there is no desktop presentation capability,
  a native dialog asks once, before any data is opened. Choosing to switch to XWayland saves the choice and restarts
  right away; choosing to keep the current mode saves it and the question is not asked again; closing the dialog keeps
  the current mode for this run and asks again next time.
- On GNOME Wayland, the Desktop page of Settings shows a "Show desktop notes through XWayland" switch; after a change, a
  "Restart now" button appears. The restart uses the normal close flow to save drafts and close the data, waits until
  the data lock is released, then `execve`s the same host, adding or removing the `GDK_BACKEND` the app set itself
  according to the new choice. If the data lock is still held, it does not restart and asks the user to open the app
  again manually. A restart request is ignored while the close flow is in progress.
- When the user has set `GDK_BACKEND`, the settings row is still shown but disabled, with an explanation that the
  environment variable decides.
- Other desktops and sessions neither show this setting nor ask.

## Consequences

### Positive

- Starting from the menu also gives desktop notes after the first confirmation, without remembering an environment
  variable.
- The user decides the trade-off for input methods and scaling explicitly and can change it back in Settings later.

### Negative

- The detection assumes that `DISPLAY` points to a working XWayland; if GNOME disables XWayland, choosing XWayland
  leaves the app unable to open a display, and the preference file must be deleted or `GDK_BACKEND=wayland` set.
- The restart replaces the current process with `execve`, and the WebKit child processes end as the original IPC closes;
  a restart with a non-default `--data` path is untested.

### Neutral

- This applies only to GNOME, because it was tested only on GNOME; KDE and other desktops that support layer-shell do
  not need it.

## Alternatives Considered

### Alternative 1: Always switch GNOME Wayland to XWayland automatically

- **Pros**: no question is needed.
- **Cons**: input methods and scaling change without the user knowing.
- **Why rejected**: the maintainer asked for confirmation.

### Alternative 2: Add the environment variable to the desktop entry

- **Pros**: no code is needed.
- **Cons**: users should not modify files owned by the DEB, and the choice could not be switched inside the app.
- **Why rejected**: poor maintainability, and it does not meet the requirement to switch in Settings.

## References

- [ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md).
- [GDK_BACKEND](https://docs.gtk.org/gtk3/running.html).

---

*Decision made: 2026-10-13*
*Decision makers: Maintainer*
