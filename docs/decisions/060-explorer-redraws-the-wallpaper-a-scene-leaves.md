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
- This app's attached scene leaves black there: its WPF host is transparent, which a non-layered child draws as black.
  A black remnant on a black wallpaper looks like the wallpaper, and the screen-pixel probes, which require a black
  background, passed. On any other wallpaper the old paper positions show black.
- Before ADR-035 the host was white, so the same remnant would have been white. That is consistent with the reported
  white blocks and with their seeming gone afterwards, but it is an inference: the earlier build was not measured and
  ADR-035 does not record which layer the blocks were on.
- Explorer's private 0x052C message to Progman, already sent in bounded attempts to create the wallpaper host:
  (13, 0) and (0, 0) change nothing; (13, 1) makes Explorer draw the wallpaper again in about 40 ms, keeps the same
  host windows and does not cover children still attached.

## Decision

- `NativeShellLayers.RepaintWallpaper` sends 0x052C (13, 1) to Progman, only while a wallpaper host is known and
  alive, with the same bounded `SendMessageTimeout` (abort if hung, 250 ms) as host discovery.
- `DesktopSurface.SetShellParent` takes the repaint for the wallpaper host; where a shown scene uncovers its parent (a
  hide, including one by dispose, by a failed region change or of windows that died, and a dropped or moved paper), a
  wallpaper scene asks Explorer to repaint instead of invalidating the host. A dropped paper's repaint waits for the
  end of the dispatcher operation, so `scene.applied` dropping the last paper and hiding the scene sends one;
  disposing a hidden scene sends none. The desktop layer keeps the immediate `RedrawWindow` of ADR-035, and ADR-035's
  clipping, pixel-copy and hide ordering stay.
- `DesktopCoordinator` passes the repaint for wallpaper views only, so a machine whose scenes never use the wallpaper
  layer never sends the message.
- `--wallpaper` gains a remnant check that reads the wallpaper host itself. It reads the wallpaper as Explorer draws
  it, marks the host around the test spot with a sentinel colour the host loses only by drawing the wallpaper, shows
  two papers, drops one (the other must stay drawn), hides the scene, shows it again, drops the last paper and hides it
  in one operation, and disposes it. After each step the old positions and the spot beside the papers must show the
  wallpaper as first read, and the scene must have asked for exactly one repaint. Every step is checked and every
  failure reported. It does not depend on a solid
  wallpaper or on windows covering the spot, fails when the mark covers a shown paper (a host that does not clip its
  children) or when the layout, scaled with the display, does not fit the scene, and always ends with a repaint so no
  mark stays.

## Consequences

### Positive

- Old paper positions on the wallpaper layer show the wallpaper on any wallpaper, measured on the build where
  ADR-035's report came from. The probe fails at every step without the repaint (the sentinel stays beside the papers),
  at the hide without Hide's own repaint, and on the repaint count when a dropped paper and the hide each send one or a
  hidden scene's dispose sends one.

### Negative

- It relies on undocumented Explorer behaviour measured on one build, at 100% scaling with a solid black wallpaper.
  The modern shell (24H2 and later, wallpaper `WorkerW` under Progman), picture wallpapers (a visible redraw is
  possible), slideshows (which can change during the probe and fail it) and multiple monitors are unverified; the
  probe's layout is checked only arithmetically above 100%.
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
