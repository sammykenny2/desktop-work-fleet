# ADR-039: Layer mapping under GNOME desktop icons and X11 scene size

## Status

Accepted, 2026-10-13. The maintainer chose this approach after reports from a real Ubuntu 22.04 GNOME machine; it updates the
Linux X11 two-layer description of ADR-031.
The same day, the DMA-BUF default of ADR-031 was also updated: the renderer is disabled only on Raspberry Pi/V3D.
Revised the same day: the top layer locks other windows on GNOME, so the maintainer chose that groups stay resident only on
the wallpaper layer, and adjust mode became an overlay that covers the work area while the main window is hidden.
Revised again the same day: tests on GNOME Xorg showed none of these limits, so it uses three layers there; wallpaper-only
residency and the overlay apply only to GNOME Wayland sessions (XWayland).
Revised 2026-10-14: on Raspberry Pi OS with labwc, the maintainer chose that all layer-shell desktops also adjust through the
overlay; the resident layers stay at three, and the main window is hidden in the same way.
Revised again the same day: with the DMA-BUF renderer disabled on the Pi, the whole scene vanished as soon as the mouse moved
over it; the Pi now keeps the DMA-BUF renderer and uses shared-memory buffers.
Third revision the same day: after the maintainer confirmed that wallpaper-layer notes cover the shortcuts on the pcmanfm
desktop, the maintainer chose not to offer the wallpaper layer in that environment and not to draw notes into the wallpaper
image.
Fourth revision the same day: on layer-shell the main window changed position after it was restored, so it is minimized
instead of hidden; shortcuts are in [ADR-041](041-labwc-shortcuts-through-rc-xml-keybinds.md).
The maintainer then asked that a main window that was already minimized before adjust mode started stays minimized after it
ends; all overlay environments now move only a main window that had focus when adjusting started.
The overlay was later extended to every desktop host (including GNOME Xorg, other X11 desktops, Windows and macOS), see
[ADR-042](042-adjust-overlay-on-every-desktop-host.md); it supersedes the GNOME Xorg "no overlay" description below.

## Context

Ubuntu 22.04's default GNOME Shell 42 (Mutter) on Wayland does not provide wlr-layer-shell,
`GtkLayerShell.is_supported()` is false, and the Linux host reports `desktop-unsupported`; the group layer settings are
not shown because there is no desktop presentation capability. The maintainer started the app through XWayland with
`GDK_BACKEND=x11` and reported two problems:

- The scene windows were only 200×200. `xwininfo` showed a 1024×768 screen with the work area starting at +70+27; the
  top-layer window was at +70+27 but stayed 200×200, and the captured window content showed only the top-left corner of
  the notes. The scene window is set as not resizable, so GTK 3 sizes it by its size request and ignores `resize()`;
  ADR-031 set the viewport size request only in the layer-shell branch. With the size request added, the top-layer
  window that spans the whole screen became `1024x768+0+27`: Mutter pushes the top edge of a normal window below the top
  bar, so the notes sat 27 pixels lower than they should. The earlier 200×200 window at +70+27 was the same work-area
  restriction, not a position the code asked for.
- On the desktop layer the notes were visible but text could not be selected; it behaved like the wallpaper layer.
  Ubuntu's desktop icons are drawn by the DING extension as a full-screen transparent normal window, which calls
  `lower()` whenever it is raised (`emulateX11WindowType.js`), and the whole desktop area receives input. X11
  desktop-type windows are in Mutter's DESKTOP layer, below the normal window layer, so they sit below DING: the notes
  are visible through DING's transparent areas, but DING receives the clicks. This was inferred from Mutter's layer
  rules and DING's source code; X11 tools cannot see Wayland windows, and DING's stacking position was not observed
  directly.

`keep_below` only reaches the BOTTOM layer, which is still below DING; an ordinary X11 client also cannot restack itself
relative to Wayland windows. An interactive desktop layer on GNOME can only be arranged by mechanisms inside the Shell,
such as a GNOME Shell extension.

After dragging, or after stack, spread or undo moved notes, ghosting stayed at the old place; the ghost was visible when
the scene window itself was captured and disappeared after a forced full-window redraw. A standalone transparent WebKit
window reproduces it by moving one note: with `WEBKIT_DISABLE_DMABUF_RENDERER=1` (the Linux default of ADR-031) the old
position keeps a ghost, and clearing to transparent first in the draw handler of the window or the WebView does not
help; when the variable is unset or set to `0`, so the DMA-BUF renderer is used, there is no ghost. The maintainer
started the app with `WEBKIT_DISABLE_DMABUF_RENDERER=0` and confirmed that the ghosting was gone. This x86 VM has
neither the Pi's device-tree model nor the V3D driver.

After the Pi 5 with labwc switched to the adjust overlay, the maintainer reported that once the overlay appeared, merely
moving the mouse made the toolbar, the alignment guides and the notes vanish entirely, while the mouse was still blocked
and Esc still worked. Headless labwc reproduced it with synthetic GTK pointer events: entering alone did not make it
vanish, moving did; a GTK redraw could not bring it back, and a forced full-page WebKit redraw could. With the keyboard
switched back to ON_DEMAND it vanished the same way, and without the overlay, moving over resident top-layer notes also
made them vanish, so this is an existing WebKit problem when the DMA-BUF renderer is disabled; a resident compositing
layer, a fixed cursor and disabling hardware acceleration all had no effect. With the DMA-BUF renderer kept and
`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` set, the headless image stayed complete after mouse movement and moved notes left
no ghost; the maintainer confirmed on a real Pi 5 that adjust mode works normally again and reported no black blocks,
garbled display or ghosting.

The maintainer also confirmed that on the Pi 5 with labwc, wallpaper-layer notes cover the desktop shortcuts. Raspberry
Pi OS's `pcmanfm-pi` runs `pcmanfm --desktop` in the default setup, which draws the wallpaper image and the shortcuts on
the same background surface (already recorded in ADR-031); with `use_swaybg=1`, swaybg draws only the wallpaper and no
shortcuts. A wallpaper-layer scene can only sit entirely above that surface (covering the shortcuts) or below it (hidden
by the opaque wallpaper); the first is the same position as the desktop layer but without interaction, so it is useless.
Drawing the notes into the wallpaper image and handing it to pcmanfm would rewrite the user's wallpaper settings,
require restoring after crashes and reboots, handle every wallpaper mode and multiple displays, and write the note
content into an image as plaintext; the maintainer chose not to do it.

The top layer is limited too. After a group is set to the top layer or adjust mode starts, the user cannot click other
programs and cannot drag or resize the main window; this recovers when the top-layer window is hidden or the app quits,
and in the meantime the keyboard can still type into other programs. Continuous logging showed that the input shape
covered only the notes, with no X grab and no XDND. A standalone keep-above XWayland window (with only a central box
receiving input) was used for comparison:

- It works while it does not accept focus, and also after the box is pressed or dragged or while the main window holds
  focus.
- It locks after it takes focus; a bounding shape of only the box and the NORMAL type behave the same, and handing focus
  to the main window does not release it.
- After the app changed the top layer to never accept focus, entering adjust mode (main window holding focus, no drag
  yet) still locks; using DMA-BUF does too. The only remaining differences from the standalone window are the shared
  client and the WebKit content; the cause is undetermined.

The maintainer's definitions of the desktop layer and the top layer both include focus, so that text can be copied
quickly with the keyboard; therefore no resident top layer without focus is offered. Since adjust mode makes other
windows unclickable anyway, it becomes an explicit mode: an overlay covers the work area, the main window is hidden, and
the overlay carries the action buttons.

Later, a GNOME Xorg session over xrdp on the same VM (`XDG_SESSION_TYPE=x11`, no `WAYLAND_DISPLAY`) was compared with
standalone windows:

- After a keep-above window takes focus, the terminal and the main window can still be clicked and dragged; the XWayland
  lock does not happen.
- On Xorg, DING is an X11 desktop-type window. A desktop-type test window started above DING and was clickable, but once
  the user clicked the desktop, DING rose above it, and every click afterwards went to DING.
- A normal window with keep below sits in Mutter's BOTTOM layer, always above all desktop-type windows (including DING)
  and below normal windows; it was still clickable after the desktop was clicked, and the desktop icons outside the box
  worked as usual.
- Mutter ignores lower on a desktop-type window; at startup it is still above DING and goes below the icons only after
  DING is clicked and rises.

## Decision

- All X11 scene windows set the viewport size request as layer-shell does; X11 also keeps `move()`/`resize()`.
- The viewport of X11 scenes uses the screen's work area (GDK reads `_NET_WORKAREA`), while layer-shell still covers the
  whole screen, so the window lands at the requested position and is not moved away by the window manager.
- When `XDG_CURRENT_DESKTOP`, split on `:`, contains `GNOME` (case-insensitive) and the session is a GNOME Wayland
  session (`XDG_SESSION_TYPE=wayland` or `WAYLAND_DISPLAY` present) running through the X11 backend, the Linux host
  creates `wallpaper` and `floating` scenes, but `residentLayers` contains only `wallpaper`. The wallpaper layer uses an
  X11 desktop-type window with keep below, keeps the wallpaper's empty input region and input refusal, sits below the
  DING icons and passes the mouse through. `wallpaperPlacement` reports `desktop-window` and does not pretend to be the
  layer-shell background band.
- The same environment reports `adjustOverlay`. In adjust mode the top-layer scene on every display is shown with the
  whole work area as its input region and draws a dark gray overlay that is about 35% opaque; the notes being adjusted
  sit above the overlay and can be dragged. When it appears, it calls present to take focus, so the keyboard works. The
  overlay carries "Stack", "Spread", "Undo" and "Done": Stack and Spread apply directly to the range being adjusted and
  keep the sizes, Undo works as in the main window, and Done ends adjust mode.
- layer-shell desktops also report `adjustOverlay`, but there it is an interaction the maintainer chose rather than a
  limit; `residentLayers` stays at the three layers wallpaper, desktop and top. The overlay covers the whole screen,
  including panels. An on-demand layer surface gets the keyboard only after it is clicked, and `present()` has no effect
  on it, so during adjustment the top layer uses the EXCLUSIVE keyboard mode so that Esc works immediately, and returns
  to ON_DEMAND afterwards. Resident top-layer notes outside the adjusted range are drawn below the overlay, consistent
  with the other layers.
- GNOME Xorg sessions provide the three layers wallpaper, desktop and top, all of which can be resident; there is no
  overlay, and adjust mode is the same as on other X11 desktops. The desktop layer uses a normal window with keep below,
  stays reliably above DING, and allows text selection and focus; the wallpaper layer is still a desktop-type window
  that passes the mouse through, and from startup until the user clicks the desktop it may show above the icons; the top
  layer uses keep above and can take focus. Other X11 desktops keep the desktop-type desktop layer.
- When adjust mode starts, the main window is hidden, and it is restored however adjust mode ends; hiding waits until
  the overlay frame is published, and restoring waits until the frame without the overlay is published. The window
  manager rearranges a window that is shown again, so its position, size and maximized state are recorded before hiding
  and restored before showing. Only when the main window document had focus as adjust mode started (before the overlay
  appeared and took focus) does the main window get out of the way and come back afterwards; a main window that is
  minimized, in the tray or behind other programs stays as it is and is not brought back afterwards. Wayland does not
  tell the app that a window was minimized, so focus decides.
- Wayland does not let an app choose window positions, and a window shown again is placed by the compositor (headless
  labwc centers it), so layer-shell minimizes instead, and the compositor keeps the position and size; on exit,
  `present()` brings it back through xdg-activation. labwc accepts only activations that carry a recent input serial; if
  the main window still has no focus after 600 ms, it is hidden and shown again, so the main window always comes back,
  though its position may change that time. Details, the full editor and Quick capture need the main window, so adjust
  mode ends first.
- The shared projection distinguishes the scene layers `layers` from the resident layers `residentLayers` (the same by
  default). When the layer a resident note asks for cannot be resident, the note goes to the desktop layer or the
  wallpaper layer and is listed in `fallbacks`; notes being adjusted can use any scene. Notes that land on the wallpaper
  layer are never interactive, draggable or editable. Saved group preferences are not rewritten and take effect again in
  a supported environment.
- Only when `/proc/device-tree/model` contains Raspberry Pi or `/sys/module/v3d` exists, and the user has set neither
  `WEBKIT_DISABLE_DMABUF_RENDERER` nor `WEBKIT_DMABUF_RENDERER_FORCE_SHM`, does the host default to
  `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`: the DMA-BUF renderer stays, without V3D's DMA-BUF buffers. Other machines keep
  WebKit's default, and the user's explicit setting still wins.
- Group shortcuts skip layers that cannot be resident, and entering adjust mode does not rewrite the resident layer;
  group settings disable layers that cannot be resident (except the current one), the settings page explains the actual
  fallback direction, and the shortcut description lists this machine's actual cycle order. Options for layers that
  cannot be resident state directly that they are not supported right now and which layer the notes will show on.
- When layer-shell starts and the same user's `pcmanfm --desktop` is connected to the same Wayland socket
  (`XDG_RUNTIME_DIR` and `WAYLAND_DISPLAY`), only the desktop layer and the top layer are created, and
  `wallpaperPlacement` reports `unavailable`; the wallpaper preference falls back to the desktop layer through the
  shared projection, and the original preference is kept. Detection happens only at startup; after switching to swaybg
  or restoring the pcmanfm desktop, the app must be reopened. No settings switch is offered, because the wallpaper layer
  has no benefit to weigh in this environment.

## Consequences

### Positive

- X11 notes are no longer cropped to 200×200 and are no longer pushed out of place by the taskbar; every X11 desktop
  benefits.
- The layer names on GNOME match the actual behavior; there is no longer a "Desktop layer" that is visible but cannot be
  clicked.
- Adjust mode on GNOME is visible and fully operable, and it does not lock other windows by surprise in normal use.
- The layer combinations of Windows, macOS and layer-shell do not change; adjust mode on layer-shell is as explicit as
  on GNOME, and the main window does not cover the notes being adjusted.

### Negative

- GNOME has no resident desktop layer or top layer; selecting, copying and editing text happen in adjust mode or the
  main window.
- When the main window is visible but not focused (for example behind other programs) and adjust mode is entered with
  the global shortcut, the main window stays in place, dimmed by the overlay; the notes being adjusted are still above
  it.
- The pcmanfm desktop has no wallpaper layer, so notes cannot sit below the shortcuts; other layer-shell desktops that
  draw desktop icons in the background layer (for example KDE Plasma) are neither tested nor detected.
- In adjust mode other programs cannot be clicked, by design; if a scene gets stuck, the mouse stays blocked until the
  app quits, while the keyboard can still operate other programs. During adjustment on layer-shell the panels cannot be
  clicked either, and the overlay holds the keyboard exclusively; if a scene gets stuck, both the mouse and the keyboard
  recover only when the app quits.
- Stack and Spread on the overlay offer no resize option; when it is needed, use the dialog in the main window.
- Parts of X11 notes outside the work area (under the taskbar or Dock) are clipped; when the work area changes (for
  example when the Dock hides automatically), the existing display change flow also resizes the scene windows.
- GNOME Wayland gets desktop notes only through XWayland; switching to XWayland also affects input methods and scaling
  in the main window, so the user chooses it at first launch or in Settings, see
  [ADR-040](040-gnome-wayland-xwayland-choice.md).
- GNOME 42 on Wayland has no GlobalShortcuts portal, and X11 global shortcuts under XWayland may not receive the keys
  either, so layers are switched mainly through the group settings.

### Neutral

- GNOME Xorg was verified only in an xrdp remote session; a local Xorg login, GNOME Flashback and other sessions that
  also declare `GNOME` are untested.
- File managers on other X11 desktops also draw icons with desktop-type windows, so their desktop layer may likewise be
  covered after the desktop is clicked; this is untested and left unchanged for now.
- The root cause of the top layer locking other windows on GNOME is still undetermined; the overlay is a design that
  takes this behavior as given.
- The ghosting comes from the shared-memory renderer and disappears with the DMA-BUF renderer.
- The layer-shell overlay was confirmed only on a real Raspberry Pi 5 with labwc; wayfire, sway, KDE Plasma Wayland and
  other compositors are untested.
- Linux machines other than the Pi use the DMA-BUF renderer, and GPU and driver compatibility was confirmed only on this
  x86 VM; other machines with the same garbling can set the environment variable themselves.
- The Pi's shared-memory buffers were confirmed only in short use on one Pi 5 (WebKitGTK 2.54); the Pi 4, wayfire and
  long use are untested. The V3D garbling that originally justified disabling DMA-BUF came from the reference project's
  reports and was not re-verified with full DMA-BUF this time.

## Alternatives Considered

### Alternative 1: GNOME Shell extension

- **Pros**: it could stack note windows between DING and normal windows and provide a real desktop layer.
- **Cons**: it needs separate development, signing and maintenance for each GNOME version, and its installation differs
  from the DEB dependencies.
- **Why rejected**: beyond the scope of this fix; it needs its own ADR if it is ever wanted.

### Alternative 2: Keep the desktop layer name

- **Pros**: no change to the shared projection.
- **Cons**: notes are visible but not interactive, the opposite of the description "above the icons, text can be
  selected".
- **Why rejected**: it misreports a capability, which is exactly the problem the maintainer reported.

### Alternative 3: Use a normal window with keep below

- **Pros**: no desktop-type window.
- **Cons**: it is still in Mutter's BOTTOM layer, below DING; DING also lowers itself to the bottom whenever it is
  raised.
- **Why rejected**: it cannot improve input.

### Alternative 4: A resident top layer or adjust mode that does not take focus

- **Pros**: keeps notes above all windows, or dragging on the desktop, without covering the whole desktop.
- **Cons**: without focus the keyboard cannot copy; tests showed that adjust mode without focus still locks other
  windows.
- **Why rejected**: it does not fit the maintainer's definition of the top layer and does not avoid the lock.

### Alternative 5: GNOME keeps only the wallpaper layer, with stack, spread and undo in the main window

- **Pros**: no top layer at all, so no window is ever locked.
- **Cons**: single notes cannot be dragged on the desktop, and nothing shows that arranging is in progress.
- **Why rejected**: after testing, the maintainer wanted to keep adjust mode and make it explicit with the overlay.

## References

- [ADR-031](031-macos-and-linux-wallpaper-scenes.md), [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md).
- [Platform feasibility research 5.5](../research/2026-10-04-desktop-interaction-platform-feasibility.md).
- [Desktops supported by gtk-layer-shell](https://github.com/wmww/gtk-layer-shell#supported-desktops).
- [Desktop Icons NG](https://gitlab.com/rastersoft/desktop-icons-ng).
- [GtkWindow resizable](https://docs.gtk.org/gtk3/method.Window.set_resizable.html).

---

*Decision made: 2026-10-13*
*Decision makers: Maintainer*
