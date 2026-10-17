# 2026-10-04 Windows transparent scenes and native input

Reviewed: 2026-10-04. This document keeps official capabilities, adoption inferences and test scope apart; the
decision is in [ADR-017](../decisions/017-windows-composition-surface-and-input.md). Current status is in
[PROGRESS](../../PROGRESS.md); history and verification evidence are in the git history and [testing](../testing.md).

## Official evidence

- Microsoft's [WPF integration documentation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/platforms/wpf)
  presents `WebView2CompositionControl` as a composable WPF control that solves the HWND airspace problem.
  The [official design](https://github.com/MicrosoftEdge/WebView2Feedback/blob/main/specs/WPF_WebView2CompositionControl.md)
  explains that it captures its own browser visual for WPF to display, forwards pointer input and keeps the keyboard
  controller.
  The documentation also lists limits such as a lower frame rate/protected media; this product plays no DRM content.
- [Layered windows](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features#layered-windows)
  hit-test by alpha/shape; zero alpha lets the pointer pass through, and with `WS_EX_TRANSPARENT` the whole surface
  passes through.
  This differs from `HTTRANSPARENT` in
  [WM_NCHITTEST](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest), which only continues
  hit-testing with windows beneath it on the same thread.
- [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)
  separates topmost, ordinary z-order and activation; a local cross-process probe showed that `HWND_TOP` is not enough
  to guarantee floating.
  The public topmost/bottom and `SWP_NOACTIVATE` are used; Explorer's private WorkerW topology is not borrowed.
- After [SetWindowRgn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowrgn)
  succeeds, the OS owns the region; on failure the caller must free it.
  [CombineRgn](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-combinergn)
  provides Boolean operations such as OR/DIFF, which can express occlusion by passive papers in front.
- [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey)
  reports registration failures, requires old registrations to be removed explicitly, and provides `MOD_NOREPEAT`;
  F12 and Win combinations are reserved keys.
  This product also excludes common editing keys and actually unregisters while paused, so input keeps going to the
  editor/IME.
- [EnumDisplayMonitors](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumdisplaymonitors)
  and [GetMonitorInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getmonitorinfow)
  are used for the monitor/work-area inventory;
  [GetDpiForWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdpiforwindow)
  returns the window's DPI according to its awareness. The app and the probes use the same PerMonitorV2 manifest.

## Adoption and failure fixes

One composition browser plus a passive WPF mirror of the same visual are used, so the native input region contains
only operable papers.
If both surfaces draw overlapping content, semi-transparent pixels accumulate; so the mirror draws only the
complement of the input region.
Regions are first clipped to logical bounds, then converted to physical pixels by the HWND DPI, with floor at the top
left and ceil at the bottom right.
The balanced back-to-front block composition is:

```text
covered(A behind B) = covered(A) ∪ covered(B)
input(A behind B) = (input(A) − covered(B)) ∪ input(B)
```

ORing card by card into an increasingly complex region once took several seconds at 20,000 cells; the balanced
composition keeps the same final coverage semantics.
Closing one side's window once left the other surface behind; a paired lifecycle now hides/finally releases both
together.
The WebView's own captured image is never used to obtain other apps' screens, and no desktop capture permission is
needed.

## Dependencies and redistribution

WebView2 composition needs the Windows .NET projection; a plain `net8.0-windows` lacks that assembly and failed in
testing.
The project uses an explicit `net8.0-windows10.0.19041.0` instead and, through
[WindowsSdkPackageVersion](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props#windowsdkpackageversion),
pins the targeting pack `10.0.19041.56`, rather than manually putting unknown DLLs into the build.

That package's SHA-512:
`s3ZqfV9sY1k+SsFuEzJ9c20deuLVKW60BhU4I/jHktb9CRlCq37EwmvqYf68OeNiUW+tQdSpSxYVhM7CDbzl4A==`.
This is an SDK targeting-pack pin; ordinary NuGet runtime dependencies keep their hashes in `packages.lock.json`.
The output keeps `Microsoft.Windows.SDK.NET.dll` and `WinRT.Runtime.dll` unchanged.
The official [redistributable list](https://learn.microsoft.com/en-us/legal/windows-sdk/redist#microsoftwindowssdknetref)
explicitly allows redistributing these files with programs that call WinRT.
The original RTF of the [SDK license](https://aka.ms/WinSDKLicenseURL) and the
[MIT license of the matching C#/WinRT revision](https://github.com/microsoft/CsWinRT/blob/8649ee3eeb2445ca2a36d80d878ef60b96a6c65d/LICENSE)
are kept in `src/native/licenses`. A license inventory is not store approval.

## Verification boundaries

`CompositionProbe` loads synthetic HTML, not notes or the product bridge; it uses real WebView2/WPF/Win32.
A separate process of our own serves as the OS hit-test target, which avoids false passes caused by same-thread
`HTTRANSPARENT`.
It checks alpha, the live mirror, the complementary input/mirror regions, mixed occlusion, floating-layer switching,
closing and large numbers of regions.
`PlatformProbe` uses real shortcut registration conflicts and unregistration; the callback is verified with synthetic
`WM_HOTKEY` messages to our own HWND.
Neither injects real keyboard/mouse input, takes the foreground or reads other apps' content.

These probes do not prove real WebView pointer capture, IME, mixed DPI, plugging/unplugging, Show Desktop, virtual
desktops, sleep/wake or draft consistency across several renderers. Later data coordination must keep a single
Workspace owner and must not let each scene commit its own copy.
