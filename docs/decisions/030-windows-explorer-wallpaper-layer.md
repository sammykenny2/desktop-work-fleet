# ADR-030: Windows Explorer wallpaper and icon host layering

## Status

Accepted, 2026-10-05. The Windows wallpaper layer is implemented at the user's request.
Replaces ADR-017's resident policy of ordinary bottom windows and the two-layer scene limit of ADR-018/020.
The extra composition and clipping styles of the app's own attached HWNDs and the background life cycle (2026-10-09) are in
[ADR-035](035-windows-attached-scene-background-lifecycle.md); Explorer styles and wallpaper settings are not modified.

## Context

The existing host had only desktop/floating scenes, and the wallpaper preference fell back to desktop.
An ordinary window at HWND_BOTTOM cannot tell the layers above and below the icons apart. The user asked for a real wallpaper
layer, with the group being operated temporarily on top and restored according to the current resident setting afterwards.

## Decision

- Windows uses three layers: desktop, floating and wallpaper. Each display has one scene per layer,
  using the single Workspace and the complementary input and visual windows; the limits are 16 displays and 48 scenes.
- desktop attaches to the Explorer host that owns SHELLDLL_DefView, above the icons.
  wallpaper attaches to the WorkerW child window under that host or, in the classic shell, to the WorkerW behind the icon host.
  It never picks an arbitrary WorkerW and never treats the icon host as the wallpaper host.
- Only when no existing wallpaper host is available does it ask Explorer to create one, with a bounded 0x052C message.
  This is a non-public Explorer protocol; the feature request of this round replaces the earlier restriction against using it.
  Wallpaper files, the registry and the user's desktop settings are not modified.
- Only the app's own windows have their WS_CHILD/WS_POPUP, parent, position and z-order changed.
  The compatibility manifest enables Windows 10 layered child window support.
  Before attaching, the host checks that parent and child DPI awareness match, so that a cross-process SetParent does not reset
  the app's DPI. Physical bounds are converted to parent client coordinates; showing and ordering do not activate windows.
  The renderer ZoomFactor and the input rect use the DPI of the actual HWND after attaching, so they are not misplaced by the
  monitor description.
- wallpaper always passes the mouse through and accepts no read-only text selection, dragging or editing; the shared policy,
  native frame validation and the input regions maintain this restriction together. While a group is being operated, it is
  projected to floating instead; the resident preference and geometry do not change.
  Afterwards the current setting applies: back to wallpaper, or to a layer chosen in the meantime.
- When the host is unavailable, the wallpaper capability is not reported; the main window states the temporary fallback and
  keeps the preference. TaskbarCreated, display and wake notifications and a low-frequency liveness check feed the existing
  topology update. Resident scenes destroyed by Explorer are retired and re-created; the floating editing scene is not attached
  to Explorer.

## Consequences

### Positive

The wallpaper and icon hosts are truly separated, and switching layers still uses the existing transaction, position and draft
barriers.
The management entry point does not delete notes when a host fails.

### Negative

Explorer's private structure may change with Windows updates; each layer adds WebView resources, so the DPI and life-cycle
checks must be maintained.

### Neutral

No external dependency, listener or reference application code is added. The layering behavior and known issues of the
reference project were consulted at the location the user provided; this design is implemented independently in C#. The
current status, including untested OS versions, is in `PROGRESS.md`; actual results are in the git history and
`docs/testing.md`.

## Alternatives Considered

- An ordinary bottom window, or wallpaper falling back to desktop: cannot meet the requirement of being below the icons.
- Modifying the wallpaper image: cannot support live note updates and group operations.
- One WebView per card: adds cost and loses the stable stacking order of the shared renderer.

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md), [PLAN-003](../plans/003-desktop-interaction-implementation.md)
- [ADR-017](017-windows-composition-surface-and-input.md), [ADR-018](018-single-owner-desktop-views.md)
- [SetParent](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent)
- [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)
- [Layered child windows](https://learn.microsoft.com/en-us/windows/win32/winmsg/using-windows)
- [Testing](../testing.md), [Current status](../../PROGRESS.md)

*Decision made: 2026-10-05*
