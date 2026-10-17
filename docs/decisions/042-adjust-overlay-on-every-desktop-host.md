# ADR-042: Adjust mode is an overlay on every desktop host

## Status

Accepted, 2026-10-14. After using the overlay on a Raspberry Pi 5 with labwc, the maintainer asked for the same
behavior on every platform with desktop layers. This updates the overlay scope in
[ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md), which was limited to GNOME XWayland and layer-shell, and
requires that a main window already minimized before adjust mode starts stays minimized when it ends.

## Context

ADR-039 introduced the adjust overlay for GNOME XWayland: the top-layer scene dims the whole work area and receives
every click, with "Stack, Spread, Undo, Done" on top, and the main window steps aside during adjustment. Layer-shell
later switched to the overlay too, but GNOME Xorg, other X11 desktops, Windows and macOS still dragged in place with
the main window untouched. macOS scene commands also rejected the `interaction.done` and `layout.arrange` sent by the
overlay toolbar.

The main window used to step aside whenever any adjustment started and to come back whenever it ended. If the user had
minimized the main window and entered adjust mode with a global shortcut, it popped up when adjustment ended.
Wayland does not tell the app that a window was minimized (GTK's iconified state does not change), so the window state
cannot decide this; the overlay takes keyboard focus when it appears, so focus must also be read before the overlay
appears.

## Decision

- Every desktop host reports `adjustOverlay` (the top-layer scene's view reports it too). The shared scene and the main
  window use it to show the overlay and toolbar, and accept `interaction.done` and `layout.arrange`. Always-on layers
  are unaffected: only GNOME XWayland still keeps just the wallpaper layer always on.
  - Linux: X11 and layer-shell both use the overlay; X11 covers the work area and layer-shell the whole screen, as in
    ADR-039.
  - Windows: the frame parses `operationScope`; the top-layer scene in adjustment uses the whole viewport as its input
    region, shows even with no notes, and enables its input window when it appears so Esc works at once.
  - macOS: the frame parses `operationScope`; during adjustment a transparent hit panel covering the whole screen
    forwards clicks. When it appears, the nonactivating scene panel becomes the key window, so Esc works at once
    without bringing the app to the front; keyboard focus is handed back at the end.
- The main window reads `document.hasFocus()` at the moment adjustment starts (before the overlay appears). Only when
  the main window has focus does it request `desktop.mainVisible(false)`, and it requests `desktop.mainVisible(true)`
  at the end; a main window that is minimized, in the tray or behind another program is left alone and not called back
  afterwards. The host also restores only a main window it put away itself.
  - Linux X11 hides it (into the tray when there is one) and restores the position; layer-shell minimizes it and calls
    it back with xdg-activation, showing it again if that is refused.
  - Windows minimizes it, and on restore returns it to its previous normal or maximized state and activates it.
  - macOS minimizes it to the Dock, and on restore expands it and brings it to the front.

## Consequences

### Positive

- Adjust mode looks and works the same on every desktop platform, and the overlay buttons also work on macOS.
- A main window the user minimized is not called up by adjust mode.

### Negative

- During adjustment, other programs, the taskbar and the menu bar cannot be clicked; if the scene hangs, the mouse
  comes back only when the app exits or reloads.
- When the main window is visible but not focused and adjust mode is entered with a global shortcut, the main window
  stays in place, dimmed by the overlay.
- The first Windows and macOS changes were written on the Raspberry Pi and were neither compiled nor run on a real
  device at the time. On 2026-10-16 Windows received the first-handshake fix and a native regression run; macOS still
  needs a build and a real-device run, and the shared renderer and test sources cannot count as each platform being
  accepted.
  On 2026-10-17 the user reported having used macOS adjust mode on a real Mac with no problems found; native full-screen
  apps and Spaces switching are untested.

### Neutral

- The browser preview, which has no desktop layers, has no overlay; adjustment still happens in the main window.

## Alternatives Considered

### Alternative 1: Use the overlay only on Linux

- **Pros**: Windows and macOS need no change and keep their existing accepted behavior.
- **Cons**: The same product adjusts differently on different platforms, and macOS cannot use the overlay toolbar.
- **Why rejected**: The maintainer asked for the same behavior on every platform with desktop layers.

### Alternative 2: Decide from the window state whether the main window is minimized

- **Pros**: Does not depend on focus, and the main window can step aside even when behind another program.
- **Cons**: Wayland does not expose the minimized state; each platform would decide differently.
- **Why rejected**: Focus is a signal every host can read reliably.

## 2026-10-16 Windows first-handshake fix

On Windows, `desktop.info` and later viewport updates carried `adjustOverlay`, but the first `scene.info`, built as a
separate reply, left the field out. Adjusting right after opening therefore showed only movable notes and no floating
toolbar. All three now share `ViewInfo`; Linux and macOS already shared their own view info.

All three platforms use the same "Stack, Spread, Undo, Done" from `src/desktop/scene.js`, for both Adjust all and Adjust
this group. Done saves drafts before leaving, and adjustment must not exit during IME composition; Esc, per SPEC-003,
first cancels the current drag or edit and then exits adjustment.
Whether the main window steps aside and comes back is still decided by focus when adjustment starts, and a main window
that was already minimized stays minimized.

Windows gained a real WPF/WebView2 first-adjustment regression that checks the toolbar, Arrange/Undo, Done, Esc,
drafts/IME and an already minimized main window; the Mac layer probe gained capability and full-viewport input/release
checks. Current status and unverified boundaries are in PROGRESS.md and [docs/testing.md](../testing.md); the run
results are in the git history.

## References

- [ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md), [ADR-041](041-labwc-shortcuts-through-rc-xml-keybinds.md),
  [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md).
