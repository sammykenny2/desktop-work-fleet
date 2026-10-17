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

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [WM_DISPLAYCHANGE](https://learn.microsoft.com/en-us/windows/win32/gdi/wm-displaychange)
- [WM_DPICHANGED](https://learn.microsoft.com/en-us/windows/win32/hidpi/wm-dpichanged)
- [WM_POWERBROADCAST](https://learn.microsoft.com/en-us/windows/win32/power/wm-powerbroadcast-messages)

*Decision made: 2026-10-05*
