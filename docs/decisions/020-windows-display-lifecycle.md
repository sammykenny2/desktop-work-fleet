# ADR-020: Windows display and sleep lifecycle

## Status

[ADR-030](030-windows-explorer-wallpaper-layer.md) raised the pool limit to 48 scenes across the three layers and
added recovery when the Explorer host restarts; the limit of 32 scenes across two layers below is the original
slice's limit.

Accepted

## Context

Plugging and unplugging displays, DPI, work area changes and waking up change desktop coordinates. Rebuilding the
renderer can lose text that is being composed with an IME.

## Decision

An owned top-level notification HWND receives the public WM_DISPLAYCHANGE, WM_SETTINGCHANGE and WM_POWERBROADCAST.
WM_DPICHANGED is passed to the coordinator by the existing surfaces. Notifications are coalesced for 350 ms and
then the displays are enumerated again; a failed read retries every 3 seconds.
On a notification, input regions and focus grants are cleared immediately. The owner cancels drags, rescues
unreachable notes through the existing LayoutStore and saves atomically,
and only then applies the native window positions and the new topology generation. Commands and presented frames
are both bound to a generation, and old coordinates can never reopen input.
The separate draft write channel keeps saving; a display change does not trigger a text flush or rebuild the DOM.

Each layer keeps a reusable scene pool, and unused windows are hidden; the two layers keep at most 32 live scenes
in total.
A scene that is being edited is assigned first to the display where the rescued paper sits, keeping the view ID,
draft and WebView.
Waking up creates no foreground intent and does not steal focus. When owner or native application fails, the
saved data is kept and the displays are enumerated again.

## Consequences

- The same workspace is still the only storage authority; there is no per-display copy of the data.
- While the environment changes, pointer operations on the desktop pause, and the text being edited is kept.
- Platform acceptance of physical plugging and unplugging, mixed DPI, sleep and real IME is tracked separately:
  current status is in [PROGRESS.md](../../PROGRESS.md), and verification procedures and unverified boundaries are
  in [docs/testing.md](../testing.md).

## Alternatives Considered

Rebuilding all WebViews on every notification: dropped, because it would break unfinished input and IME
composition.

## 2026-10-23 Scenes that grow past their creation size

WPF lays a window's content out no larger than the maximum track size of the last `WM_GETMINMAXINFO`. Windows sends that
message on a resize only to overlapped or thick-frame windows, and the scene windows become popup or child windows when
they are attached, so they keep the value from their creation. After a 1920x1080 start, the coordinator resized the scene
windows for a remote session at 2560x1306, but their content stayed at 1940x1100: adjust mode drew only that part of the
screen, and attached scenes had the same limit. Before every resize, `DesktopSurface` now sends the message again with the
largest scene size. The `--scene-growth` probe in [docs/testing.md](../testing.md) covers it.

## 2026-10-23 The reference DPI follows the primary display

The coordinator read the primary display's DPI once at startup and kept it as the reference of
[ADR-018](018-single-owner-desktop-views.md). A machine started on a 3840x2160 display at 150% and later switched to
2560x1306 at 100% still drew its papers at 150%, half as large again as after a restart on the same display. A
proposal now gives the owner work areas in the unit of its own primary display, and applying it takes that DPI as the
reference before the scenes are moved and zoomed. The running app then matches a restart on the new displays: papers
keep their logical placements, group regions follow the new primary work area, and the owner rescues papers that the
new work areas cannot reach. A scaling change alone now also changes the logical work area. Going from 100% to 150%
shrinks it to two thirds, and papers rescued into it stay there when the scaling goes back. With other displays
attached, any change of the primary display's DPI moves their logical rectangles too, so papers near an edge between
displays can be drawn on the neighbouring one; that case awaits real hardware. The `--reference-dpi` probe in
[docs/testing.md](../testing.md) covers a single display.

## 2026-10-24 The Top layer gets a new scene on a new display device

0.4.1 started in a 2560x1306 remote session at 100%, and the maintainer then switched to the local 3840x2160 display
at 150%. The device name changed from `\\.\DISPLAY1` to `\\.\DISPLAY5`, and the coordinator moved the same Top-layer
scene there. Its window, input region, DPI and the browser's render window were all correct, but its
`WebView2CompositionControl` showed nothing. Adjust mode therefore showed neither the tint nor the toolbar, while its
full-screen input region took every click, the main window's too, until Esc or Done in the tray. The attached scenes,
which host a windowed WebView, were unaffected. A restart fixed it, and a later scaling change alone on the same
display (150% to 125%) left adjust mode working.

A Top-layer scene is now reused only on the display device it was created on, as Windows names it (`\\.\DISPLAYn`). A
Top-layer slot that no view of that device fills gets a new view, and a Top-layer view left without a slot is closed
instead of kept in the pool. The owner gets the new view list from the applied displays and drops the old view without
reporting a loss. The view of a quick edit still being composed stays the exception: it is assigned first and carried
across, as above, and once its edit ends the displays are read and applied again, which replaces it. The attached
layers keep their pool. This still honours the alternative rejected above: the edited view, which can hold unfinished
input, is never rebuilt. The `--reference-dpi` probe changes the device name and checks the replacement; it cannot
make the composition blank, so a real remote-session switch awaits a real-machine check, as do a new adapter that
keeps the device name and a carried edit.

## 2026-10-24 The browser zoom follows the display's DPI

After a scaling change from 150% to 125% while Work Fleet ran, the attached scenes drew their papers at 125/150 of
their size: a white frame of the right size and place, with the paper shrunk towards the scene's top-left corner. The
scene windows kept 144 DPI, as did Explorer's desktop window, which never changed its DPI in these tests. Windows
inside it get that DPI whenever the scaling changes, and the DPI of the display they are created on otherwise. Neither
WebView2 control sets a rasterization scale, so the browser draws at the display's 120 DPI, while the zoom was the
reference over the window's 144 DPI. The browser zoom is now the reference over the DPI of the display under the scene.
Input regions keep the window's DPI, which matches the pixels SetRegion installs. On the maintainer's 4K display a
Debug build with this change ran beside the installed 0.4.1 under the same condition: the installed build drew the
shrunk papers again, while every scene of the Debug build reported a device pixel ratio of 1.25 and a 3072x1728
viewport. No probe can make Explorer's DPI differ from the display's.

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [WM_DISPLAYCHANGE](https://learn.microsoft.com/en-us/windows/win32/gdi/wm-displaychange)
- [WM_DPICHANGED](https://learn.microsoft.com/en-us/windows/win32/hidpi/wm-dpichanged)
- [WM_POWERBROADCAST](https://learn.microsoft.com/en-us/windows/win32/power/wm-powerbroadcast-messages)

*Decision made: 2026-10-05*
