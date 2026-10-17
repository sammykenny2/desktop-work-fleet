# ADR-049: Windows scenes attached to Explorer render WPF in software

## Status

Accepted, 2026-10-15. After reading the `host.log` and analysis of the 0.2.5 crash after sign-in, the user said: "Do 1
and 2 first."
Item 1 is writing the wait's decision inputs into `host.log` (the
[ADR-046](046-windows-sign-in-scenes-wait-for-settled-displays.md) revision); item 2 is this decision.

Revised 2026-10-16: it had no effect. The user reported "it still crashes after a reboot". The installed 0.2.7, which
contains this decision, crashed in the same way when the built-in display turned off after sign-in; the details are
under Negative in Consequences. The change is still in the code; whether to keep it, revert it or switch approaches is
still to be decided (an open item in PROGRESS.md; the 2026-10-16 handoff is in the git history).

2026-10-16 follow-up: an isolated verification with WPF 10, which includes the display-loss protection, is in
[ADR-050](050-windows-wpf-display-loss-runtime.md). The partial software rendering of this decision stays for now; a
runtime upgrade or passing ordinary probes is not taken as proof that the sign-in crash is fixed.

## Context

- Booted at 2026-10-15 15:09; 0.2.5 crashed after a sign-in start. `host.log` recorded:
  - Two displays at start: the closed built-in display (1920×1080) as primary, and the external 4K on the right.
  - The ADR-046 wait did not take effect, and the scenes were attached to Explorer after 2.8 seconds; the inputs of the
    decision were not logged.
  - About 100 seconds after start, Windows turned off the built-in display (topology=1), and nothing happened then.
  - 30 seconds later, the same external display was renumbered from `\\.\DISPLAY2` to `\\.\DISPLAY1` (topology=3).
  - 140 ms later the render thread failed (`UCEERR_RENDERTHREADFAILURE`, thrown in `HwndTarget.UpdateWindowPos`).
    The 8 Explorer child windows were moved out first, then the process ended; there was no automatic reopen (ADR-045
    revision).
  - There were no driver timeouts or display-related system events at the same time.
- 0.2.3 met the same DISPLAY2→DISPLAY1 renumbering on 2026-10-15 00:13 without a crash.
  So the failure depends on timing; it does not always happen when a given change occurs.
- The ADR-046 wait delays at most until 5 seconds after the first change; the fatal change this time was the second one,
  30 seconds later.
- Microsoft's notes ([WPF render thread failures](https://learn.microsoft.com/en-us/troubleshoot/developer/dotnet/framework/general/wpf-render-thread-failures)):
  - Each WPF process has only one render thread.
  - The exception and stack on the UI thread are only symptoms; the real cause stayed on the render thread and is lost.
  - The most common cause is the display driver together with WPF hardware rendering. The advice is to disable
    hardware acceleration first, either per window (`HwndTarget.RenderMode`) or for the whole process.
- The scenes attached to Explorer are the desktop layer and the wallpaper layer, and each scene has two WPF windows:
  - InputWindow hosts the windowed WebView2; VisualWindow has no content.
  - Explorer's desktop window has no redirection surface, so what WPF draws in these two windows never appears on screen
    (see the notes on the `DesktopSurface` constructor). The notes are drawn by the browser's own child windows.
  - Yet each of these two windows holds its own Direct3D render target.
- The 8 windows were: 2 displays at boot × desktop layer and wallpaper layer × 2 windows per scene. After the built-in
  display was turned off, its scenes were only hidden and stayed attached to Explorer.

## Decision

- The two WPF windows of non-layered scenes (the kind attached to Explorer) set `HwndTarget.RenderMode` to
  `SoftwareOnly` when the HWND is created, before attaching to Explorer.
- The floating layer keeps default rendering: it is a layered window, and the `WebView2CompositionControl` output is
  composed by WPF. The main window also keeps the default.
- Writing the decision inputs to `host.log` is covered by the 2026-10-15 revision of ADR-046.

## Consequences

### Positive

- Work Fleet windows inside Explorer no longer hold Direct3D state, so WPF does not rebuild GPU resources for them on
  display changes.
- The picture is unchanged. One run before and one after the change gave the same results for the real-Explorer
  wallpaper-layer and desktop-layer pixel checks (`--wallpaper`) and the Explorer-style host check (`--host-check`).

### Negative

- It is not guaranteed to help; the cause of the render thread failure is still unknown. If the failing part is the GPU
  rendering of the floating layer or the main window, this change does not help.
  Two next steps to consider: software rendering for the whole process (the floating layer must be verified first), or
  enabling LocalDumps for WorkFleet.exe (needs the user's consent).
- Measured ineffective on 2026-10-16. 0.2.7 started at sign-in at 20:22:08:
  - Two displays, with the built-in display (`\\.\DISPLAY1`, 1920×1080) as primary; `lid open`, and the scenes
    attached 0.9 seconds later.
  - 37 seconds later `lid closed`, and 1.2 seconds after that only the external 4K remained (`\\.\DISPLAY2`,
    topology=1).
  - About 0.3 seconds after applying it, the render thread failed with the same stack as 0.2.5; the 8 Explorer child
    windows were moved out before the process ended.
  - No driver or display-related system events in the same period.
  - Only two things still render with the GPU: the floating layer, one per display (a layered window plus
    `WebView2CompositionControl`), and the main window hidden off screen at sign-in.
- Whole-process software rendering has been tried; see Alternative 1. The 2026-10-16 handoff is in the git history.
  LocalDumps has limited value: Microsoft says the render thread failure record can only be recovered with their
  internal debugger extensions and private symbols.
- Software rendering keeps its buffers in process memory. The `--wallpaper` probe has one 4K full-screen attached scene;
  with both windows shown:
  - Peak working set rose from 150 MB to 215 MB, about two 3840×2160 32-bit buffers.
  - Peak private bytes instead fell from 181 MB to 174 MB, roughly the same.
    Hardware render target buffers were already allocated in GPU memory (shared system memory for this integrated
    GPU), so they were not counted in the working set.
  - In the app, each display has two attached scenes, desktop layer and wallpaper layer, and both are shown once at
    start. One 4K display adds about 130 MB of working set, and more displays add more.
    Whether the buffers are released after hiding has not been measured.
- It can be verified only by real reboots; this kind of display switch at sign-in cannot yet be reproduced in tests.

### Neutral

- It applies to both manual and sign-in starts.
- The ADR-046 wait stays unchanged.

## Alternatives Considered

### Alternative 1: Software rendering for the whole process (`RenderOptions.ProcessRenderMode`)

- **Pros**: Covers every window.
- **Cons**: The floating layer needs WPF to compose WebView2's GPU-captured output, and its performance and display in
  software mode are not verified.
- **Why rejected**: First handle the windows whose picture cannot be affected; if it still crashes, evaluate this
  option.
- **2026-10-16 experiment**: in software mode the floating layer shows nothing, so this option cannot be used as is.
  - Method: set `RenderOptions.ProcessRenderMode = SoftwareOnly` at Debug UI probe startup and compare with the default
    mode. The experimental change was reverted and never committed.
  - `--composition`: passes in default mode; in software mode no note pixels appeared within 10 seconds
    (`Expected composition pixels did not appear: composition.png`).
  - The real-screen floating-layer check in `--wallpaper`: default mode
    `PASS on-screen floating at 190,145: rgb(224,80,160)`.
    In software mode the same point hit the application window behind and was SKIPped. A layered window does not
    accept hits where it is transparent, so presumably no note was drawn there.
  - The WPF assembly of WebView2 1.0.4258.31 contains strings such as `GraphicsCaptureSession`, `D3D11CreateDevice`,
    `D3DImage` and `SetBackBuffer`, which suggests that `WebView2CompositionControl` captures the browser output on the
    GPU and hands it to `D3DImage`. This is only a guess; its code was not read.

### Alternative 2: Lengthen or strengthen the ADR-046 wait

- **Pros**: No change to rendering.
- **Cons**: The second change came 30 seconds later, so the wait is only a race against time; and this time the wait
  did not even take effect.
- **Why rejected**: When Windows will change things again cannot be predicted.

### Alternative 3: Bring back the one reopen after a crash (ADR-045)

- **Pros**: The user is less likely to see the app disappear.
- **Cons**: The user disabled it precisely to find out whether it crashed at all.
- **Why rejected**: Out of scope this time; the user decides.

## References

- [ADR-045](045-windows-fatal-error-leaves-explorer-first.md): leaving Explorer first on a crash, `host.log`
- [ADR-046](046-windows-sign-in-scenes-wait-for-settled-displays.md): the sign-in wait for settled displays, and its 2026-10-15 revision
- [docs/testing.md](../testing.md): `--wallpaper`, `--host-check`, `--sign-in-hold`

---

*Decision made: 2026-10-15*
*Decision makers: User, Claude*
