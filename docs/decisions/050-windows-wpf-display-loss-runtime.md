# ADR-050: Windows uses WPF 10 with the display-loss protection

## Status

Accepted, 2026-10-16. The user first asked for the implementation and build in a worktree; after installing it, three
reboots did not crash again, and the user then authorized merging into main and cleaning up.
The app version stays 0.2.7 and nothing is published; the field test supports adopting this fix, but does not mean
that crashes in every sign-in timing are ruled out.
This decision updates ADR-015's Windows .NET target and ADR-036's bundled runtime version.

## Context

- The latest handoff commit 5465296 records that ADR-049 did not prevent the 0.2.7 sign-in crash. The real host.log
  shows that the built-in primary display was turned off and that 0x88980406 UCEERR_RENDERTHREADFAILURE occurred
  339 ms after the new configuration was applied.
- The module information in that minidump confirms that WPF 8.0.31 and WebView2 SDK 1.0.4258.31 were loaded.
- The IL of the actual WebView2 WPF assembly confirms that GraphicsItemD3DImage derives from D3DImage and uses
  adapter 0 when it creates the D3D9 device.
  The SDK also already clears the back buffer and recreates the device on display changes; existing issues alone do not
  justify claiming that upgrading WebView2 fixes the crash.
- In the WPF 8.0.31 source commit 27c84022a86fcaa600315f4686cde97874615a24,
  CInteropDeviceBitmap::GetDisplayFromUserDevice does not handle GetAdapterMonitor returning NULL.
  WPF #10394 falls back to the current primary display in that case; this round confirmed that v10.0.13 contains the
  fix and that release/8.0 and release/9.0 do not.
- This is a strong root-cause candidate, but the original WPF failure record was not recovered from the dump; it still
  has to be compared with the same sign-in/display-switch flow.
- Sign-in crash history from `host.log` (the maintainer's laptop, Windows 11 build 26200):
  - 2026-10-14 21:14 on 0.2.1, 12.6 s after start, before display logging existed.
  - 2026-10-14 23:02 on 0.2.2, 1 s after the built-in display turned off.
  - 2026-10-15 15:13 on 0.2.5, 30 s after the built-in display turned off, when the external display was renumbered.
  - 2026-10-16 20:22 on 0.2.7, 0.3 s after the built-in display turned off.
  - ADR-045 also records a crash after sign-in on 0.2.0 (2026-10-14 14:12).
- Every crash with display logs was a start at sign-in with the built-in display on at start, as `\\.\DISPLAY1`,
  primary, 1920×1080 at 125%, and the 4K display as `\\.\DISPLAY2`.
- No crash: on 2026-10-15 15:13:04 the built-in display turned off 100 s after start; on 2026-10-15 00:13 and
  2026-10-16 03:31 only the 4K display was present at start and was renumbered.
  The 0.2.6 sign-in on 2026-10-16 02:41 started with only the external 4K display and the lid closed; the scenes
  attached 1.2 s after the hold and nothing crashed, but the crash condition did not occur, so it proved nothing about
  ADR-049.
- Other evidence: only Application Error 1000 (0x80131623) and .NET Runtime 1025 events; WER AppCrash reports without
  dumps (LocalDumps was off at the user's request); one GPU, NVIDIA GeForce GTX 1660 Ti, driver 32.0.16.1742, with the
  NVIDIA D3D9 (`nvd3dumx`) and D3D11 (`nvwgf2umx`) user-mode drivers loaded alongside d3d9, d3d11, dxgi and dcomp.
- An installed package cannot pretend to be a sign-in start: `HostShell.DetectLoginLaunch` trusts only StartupTask
  activation.
- A manual repro without rebooting (2026-10-16, installed 0.2.7) did not crash in three tries: it started with only the
  4K display, then the lid was opened (the built-in display became `\\.\DISPLAY2` and primary) and closed.
  Differences from the crashes: no built-in display at start, a different display number, the main window not hidden,
  and the lid closed 50 s to 2.5 min after start, while the crashes happened 13–43 s after start or at a later
  renumbering.

## Decision

- The Windows app, core and core/UI probes all target .NET 10 together; the WPF app keeps its existing Windows SDK
  target and install floor.
- The self-contained Core/Desktop runtime is pinned to 10.0.13, read from WindowsRuntimeVersion in the Windows
  Directory.Build.props.
  The app Version stays 0.2.7; the WebView2 and SQLite direct package versions and the desktop presentation are
  unchanged.
- Scripts, CI, IDE paths, lockfiles and the actual package licenses/notices are updated together; the package check
  requires the exact runtime pin and rejects older or mixed versions.
- Everyday development needs the .NET 10 SDK/Desktop runtime; MSIX/ZIP bundle the runtime, so recipients do not install
  .NET separately.
- The sign-in wait, CrashGuard and ADR-049 stay for now, so this experiment focuses on the WPF runtime.
  The host.log start line adds the actual Environment.Version, to tell apart test packages that are all 0.2.7.
- Build-WindowsApp explicitly disables the SDK's ASP.NET development certificate initialization; this desktop app does
  not use that certificate. The localhost ASP.NET development certificate that the first .NET 10 SDK run had created on
  the maintainer's machine was removed with the user's consent (2026-10-16).

## Consequences

### Positive

- Adopts the officially fixed display-loss handling, with no need to replace the floating layer or add a private API
  hook.
- Checks the runtime actually packaged, so swapping only the SDK cannot still ship WPF 8.

### Negative

- A .NET major upgrade still needs a full native regression and real-device acceptance on the supported Windows
  versions.
- Passing local probes does not mean the sign-in crash after a reboot is gone.

### Neutral

- No app version bump, no product install, no change to login items or the display configuration, no release
  dispatch.
- The package uses the worktree's local default configuration; the original checkout's .env was not copied, and Google
  sign-in is outside this package's verification scope.
- NuGet re-selected compatible framework assets, so System.Memory 4.5.3 is no longer a Windows lockfile dependency;
  direct package versions are unchanged.

## Alternatives Considered

### Update only the system .NET or a .NET 8 patch

- A self-contained app does not use the system-installed .NET, and the WPF 8 branch that was checked does not have the
  fix either.

### Rewrite the floating layer / disable the GPU entirely

- A bigger architectural change; the earlier whole-process software rendering experiment left the floating layer blank
  (ADR-049), so the official fix is verified first.

## 2026-10-16 field observations

The maintainer installed the signed test package and rebooted three times. On Windows 11 build 26200 the startup events
matched the installed `host.log`: all three were sign-in starts, with no automatic restart, on runtime 10.0.13; as of
23:20 there were no new WorkFleet error events after 22:10, and the last process was still alive.
The first start had the built-in primary display plus the external display; about ten minutes later the lid was
closed, removing the built-in display, and the new display configuration was applied without another render-thread
failure. The other two sign-ins already had only the external display. The installed app assembly has the same SHA-256
as this round's signed package.

This is a limited number of successful observations. The original failure condition, removing the built-in primary
display 13–43 seconds after start, has not been covered again, and .NET 10 has not been verified on 23H2.
The verification evidence is in the git history and [docs/testing.md](../testing.md). On this basis the maintainer
authorized the merge; the internal state of the original WPF failure is still not confirmed from a dump.

Still open (as of 2026-10-17):

- Proposed next repro, not yet done: open the lid so both displays are on, exit from the tray and reopen, close the
  main window to the tray at once, and close the lid about 10 s later; if it does not crash, retry with about 30 s.
  The built-in display returns to `\\.\DISPLAY1` only after a reboot.
- Candidate next steps if the crash returns, none started: in a Debug build change one thing at a time (for example
  software rendering for the main window, or no floating layer); replace the `WebView2CompositionControl` composition
  of the floating layer with a windowed WebView plus a region, which needs a new ADR; decide whether to revert ADR-049.
  Re-enabling the ADR-045 reopen, turning on LocalDumps and updating the GPU driver are the user's decisions.

## References

- [WPF #10394](https://github.com/dotnet/wpf/pull/10394), [issue and repro #9042](https://github.com/dotnet/wpf/issues/9042)
- [Matching WPF 8.0.31 source](https://github.com/dotnet/wpf/blob/27c84022a86fcaa600315f4686cde97874615a24/src/Microsoft.DotNet.Wpf/src/WpfGfx/core/hw/InteropDeviceBitmap.cpp)
- [Exact source commit of the packaged WPF](https://github.com/dotnet/dotnet/blob/4099f83977f4d29604a9aeb971fb0a7bc1d5f699/src/wpf/src/Microsoft.DotNet.Wpf/src/WpfGfx/core/hw/InteropDeviceBitmap.cpp)
- [WPF v10.0.13 source](https://github.com/dotnet/wpf/blob/v10.0.13/src/Microsoft.DotNet.Wpf/src/WpfGfx/core/hw/InteropDeviceBitmap.cpp)
- [WebView2 #5437](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5437)
- [Official .NET 10 release metadata](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json)
- [ADR-036](036-windows-self-contained-packaging.md), [ADR-049](049-windows-attached-scenes-render-in-software.md)

*Decision made: 2026-10-16*
