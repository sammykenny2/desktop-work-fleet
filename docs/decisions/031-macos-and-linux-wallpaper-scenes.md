# ADR-031: macOS and Linux wallpaper scenes and layer restore

## Status

Accepted, 2026-10-05. Updates the two-layer limit of ADR-023/025; test results are in the git history and `docs/testing.md`.
The Linux X11 scene size, the GNOME layer mapping, the DMA-BUF default and the wallpaper layer on the pcmanfm desktop are
updated by [ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md).

## Context

Windows already provides three layers; macOS and Linux still created only desktop/floating, and the wallpaper preference fell
back.
The maintainer asked for all three platforms to catch up and to continue from the native test results the reference project
already had.
The Pi/labwc records already confirmed the problems with three-layer switching, dragging, saving, redrawing and input shape;
the environment must not be treated as unknown again.

## Decision

- macOS adds a wallpaper visual panel per display at the public `desktopWindow + 1`, above the wallpaper and below
  `desktopIconWindow`. desktop stays at `desktopIconWindow + 1` and floating at `.floating`.
  The three layers share the same owner projection, with at most 16 displays and 48 scenes; topology reuse includes the third
  layer.
- Linux layer-shell adds BACKGROUND; desktop uses BOTTOM and floating uses TOP.
  `wallpaperPlacement: background` states that this is the background band. When pcmanfm draws the wallpaper and the icons on
  the same surface, BACKGROUND notes may still sit above the icons; the app does not claim that the protocol can insert anything
  into that surface.
  X11 keeps desktop/floating, the wallpaper preference explicitly falls back, and no fake third layer is added.
- Wallpaper frames forbid interactive, draggable and editing; both native surfaces also refuse input and focus.
  While a chosen group or All is being operated, the shared controller moves it to floating temporarily; on exit it restores the
  current resident preference, and the geometry does not change.
- The GTK input shape is kept on the widget so that allocation cannot overwrite it; every update queues a draw, and a pause
  clears the region and the keyboard request. layer-shell explicitly uses the viewport's size request and does not rely on
  an ordinary window resize.
- On Linux the DMA-BUF renderer is disabled unless the user sets otherwise. After map, configure and frame application, one
  merged redraw event is sent; the renderer changes the root opacity briefly and restores it after two animation frames, which
  clears leftover images in transparent WebKit.
- A new Mac native probe that uses the actual sources and an isolated Linux/labwc probe are added; the synthetic projection
  comes from the shared Workspace and InteractionController. No UI, code, assets or data formats of the reference product were
  copied.

## Consequences

Windows, macOS and Linux layer-shell all have code wiring for three native layers; the Linux background band does not mean
that every desktop can place notes below the icons.
The scope and known limits of the reference tests are kept, and the user's wallpaper files and desktop settings are not changed.
The Mac source probe can be compiled in a graphical session with the Xcode command-line tools, without the Google SDK;
the local Windows machine has no Apple SDK, so Swift and WindowServer tests that were not run cannot be recorded as passed.
Linux headless compositor tests do not replace acceptance on the Pi/V3D, pcmanfm-pi, a physical Chinese input method or
multiple displays.

## Alternatives Considered

Keeping the two-layer fallback does not meet the feature parity requirement. Calling layer-shell BACKGROUND alone "below the
icons" would misreport.
Compositing notes into the user's wallpaper file would introduce a different save and wallpaper-restore flow, beyond the scope
of continuing from the existing native results.
A data owner per card and a switch to the reference product's Tauri/Rust architecture are not adopted.

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md), [ADR-030](030-windows-explorer-wallpaper-layer.md).
- [Reference check for this decision](../research/2026-10-05-desktop-layer-reference-follow-through.md).
- [CGWindowLevelKey](https://developer.apple.com/documentation/coregraphics/cgwindowlevelkey).
- [wlr-layer-shell original protocol](https://github.com/swaywm/wlr-protocols/blob/master/unstable/wlr-layer-shell-unstable-v1.xml).
- [GtkLayerShell](https://wmww.github.io/gtk-layer-shell/), [Gtk widget input shape](https://docs.gtk.org/gtk3/method.Widget.input_shape_combine_region.html).

*Decision made: 2026-10-05*
