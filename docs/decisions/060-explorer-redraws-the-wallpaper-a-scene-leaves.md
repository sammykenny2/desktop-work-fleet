# ADR-060: Explorer redraws the wallpaper a scene leaves

## Status

Accepted, 2026-10-31, at the maintainer's request after the same defect was found in Cats Bot.
Supplements [ADR-035](035-windows-attached-scene-background-lifecycle.md) and [ADR-030](030-windows-explorer-wallpaper-layer.md).

## Context

ADR-035 recorded white blocks at old paper positions on a black wallpaper on Windows 11 23H2, shipped clipping, no
pixel copying, hide-before-move and an asynchronous `RedrawWindow` of the parent, and left the cause unconfirmed. The
maintainer later saw no blocks, and the screen-pixel probes passed.

On 2026-10-31 the maintainer's machine (Windows 11 23H2, build 22631, classic shell: the icons in a top-level `WorkerW`,
the wallpaper in a sibling `WorkerW`, solid black background) was measured by reading each Explorer window's own
content with `PrintWindow(PW_RENDERFULLCONTENT)`, first for a Cats Bot note and then for this app's scene:

- The wallpaper host keeps whatever a child last drew where the child leaves it: hidden, region shrunk, reparented or
  destroyed. It does not draw the wallpaper there again by itself, and `RedrawWindow` with
  `RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN` (also with `RDW_UPDATENOW | RDW_FRAME`) on the wallpaper host, the
  icons host, its list view or Progman does not replace it. The icons host has no such problem.
- This app's attached scene leaves black there: its WPF host is transparent, which a non-layered child draws as black
  (before ADR-035 the host was white, hence the reported white blocks). A black remnant on a black wallpaper looks
  like the wallpaper, so the blocks seemed gone and the screen-pixel probes, which require a black background, passed.
  On any other wallpaper the old paper positions show black.
- Explorer's private 0x052C message to Progman, already sent in bounded attempts to create the wallpaper host:
  (13, 0) and (0, 0) change nothing; (13, 1) makes Explorer draw the wallpaper again in about 40 ms, keeps the same
  host windows and does not cover children still attached.

## Decision

- `NativeShellLayers.RepaintWallpaper` sends 0x052C (13, 1) to Progman, only while a wallpaper host is known and
  alive, with the same bounded `SendMessageTimeout` (abort if hung, 250 ms) as host discovery.
- `DesktopSurface.SetShellParent` takes the repaint for the wallpaper host; where the scene uncovers its parent (hide,
  a dropped or moved paper, dispose), a wallpaper scene asks Explorer to repaint instead of invalidating the host. The
  desktop layer keeps the `RedrawWindow` of ADR-035, and ADR-035's clipping, pixel-copy and hide ordering stay.
- `DesktopCoordinator` passes the repaint for wallpaper views only, so a machine whose scenes never use the wallpaper
  layer never sends the message.
- `--wallpaper` gains a remnant check that reads the wallpaper host itself: it marks the host around the test spot
  with a sentinel colour the host loses only by drawing the wallpaper, shows two papers, drops one and hides the
  scene, and requires each old position to match the host beside it. It does not depend on the wallpaper colour or
  on windows covering the spot, and always ends with a repaint so no mark stays.

## Consequences

### Positive

- Old paper positions on the wallpaper layer show the wallpaper on any wallpaper, measured on the build where
  ADR-035's report came from, and the probe fails without the fix (black where the dropped paper was, the sentinel
  beside it).

### Negative

- It relies on undocumented Explorer behaviour measured on one build. The modern shell (24H2 and later, wallpaper
  `WorkerW` under Progman), picture and slideshow wallpapers (a visible redraw is possible) and multiple monitors are
  unverified.
- A hung Explorer makes the request time out, and that remnant stays until the next one.
- Each repaint blocks the WPF dispatcher for about 40 ms.

### Neutral

- No Explorer style, registry value, wallpaper setting or Explorer restart is involved.

## Alternatives Considered

### Keep the asynchronous redraw of the parent (ADR-035)

Measured not to replace the remnant on the wallpaper host.

### Re-apply the wallpaper with `SPI_SETDESKWALLPAPER`

Changes global desktop state on every hide; ADR-035 already rejected it, and (13, 1) repairs the area without it.

### Make the attached host draw nothing

The remnant would then be whatever the windowed WebView drew; the wallpaper host would still never draw the wallpaper
there, so the colour would only change.

## References

- [ADR-035](035-windows-attached-scene-background-lifecycle.md), [ADR-030](030-windows-explorer-wallpaper-layer.md)
- [Testing](../testing.md), `--wallpaper`
- [RedrawWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-redrawwindow),
  [PrintWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow)

*Decision made: 2026-10-31*
