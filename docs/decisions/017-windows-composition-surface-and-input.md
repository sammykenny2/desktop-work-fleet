# ADR-017: Windows transparent scenes, input regions and platform foundation

## Status

2026-10-05: [ADR-030](030-windows-explorer-wallpaper-layer.md) changed the resident layer to Explorer attachment.
The statements below about not using WorkerW, ordinary bottom windows and so on are historical limits of the
original slice; the remaining composition and input responsibilities stay.
2026-10-09: [ADR-035](035-windows-attached-scene-background-lifecycle.md) updated the white background / backing
bitmap and the teardown order of attached scenes; the 2026-10-06 description of the opaque host below is kept as
history and does not mean the 23H2 ghosting is fixed.

Accepted, 2026-10-04, limited to Windows scene surfaces, native input regions, shortcut registration and the
display inventory.
Desktop coordination between the main window and the shared controller still has to be integrated; this sub-slice
does not enable the `desktopPresentation` capability.
Tests of these primitives are not used to claim that C16 / C35 / C40-C43 / C46-C47 fully pass.

## Context

Within one system layer, the renderer must control card order and support interactive and pass-through papers
covering each other.
An ordinary WPF WebView2 is an HWND host, and a transparent whole window cannot directly prove per-card hit
testing across processes.
Real WebView2 pixels, OS hit testing and the surface lifecycle must be validated first, before connecting the data
authority.

## Decision

- Use `WebView2CompositionControl`; each scene has only one browser and two WPF layered windows.
  One contains the real WebView and the interactive regions; the other shows the same visuals through a
  `VisualBrush`.
  The passive surface uses `WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`.
  Composition of its own WebView visuals does not capture the desktop or other apps' screens.
- From the renderer's back-to-front list of papers, build a native region: interactive papers are added, and
  pass-through papers in front are subtracted.
  Balanced grouping combines `(covered, input)`, avoiding the quadratic cost of unioning large regions one paper at
  a time.
  The limit is 20,000 papers; invalid geometry does not change the current policy, and a failed native region
  allocation hides both surfaces.
- The visual surface's region is the whole scene minus the input region; together they cover everything and do
  not overlap.
  Semi-transparent paper pixels are drawn only once; rounded corners and transparent pixels are still subject to
  the layered window alpha hit-testing rules.
  At creation and on leaving interaction the input region is empty, so there is never an initialization gap that
  intercepts the whole screen.
- Floating uses `HWND_TOPMOST`; resident uses a non-topmost ordinary bottom window.
  All ordering and showing use a no-activate window policy and never obtain foreground rights.
  This is not a Wallpaper backend, and the results with Win+D, virtual desktops and exclusive full screen are not
  guaranteed.
  WorkerW private messages, cross-process parents and `HTTRANSPARENT` are not used to fake cross-process
  pass-through.
- The two windows are hidden and released together. Closing either surface directly emits a deferred, coalesced
  `CloseRequested` so the coordinator can save drafts;
  the notification happens after WPF Closing returns, so the handler can call `Dispose` synchronously without
  re-entering the close sequence.
  Without a handler, both surfaces are hidden and the browser is kept until `Dispose`. A native handle is not a
  card identity.
- `NativeShortcuts` owns a separate message-only HWND and uses `RegisterHotKey` / `MOD_NOREPEAT`.
  It reports per key whether it is available, conflicting, paused, reserved or invalid; no keyboard hook is
  installed.
  F12, Win combinations, Alt+F4 and common text editing keys are not registered.
  A reset first unregisters and clears old hotkeys already queued on that HWND; pause and release actually
  unregister.
  The controller integration must pause while this app's editor or IME owns input; ignoring shortcuts the OS has
  already consumed is not enough.
- `NativeDisplays` uses `EnumDisplayMonitors` / `GetMonitorInfo` to get the physical bounds and work area,
  and gets each display's DPI from a hidden owned HWND + `GetDpiForWindow`.
  The output is explicitly marked physical and does not pose as LayoutStore's logical coordinates; mapping and
  recovery after plugging and unplugging are connected to the coordinator separately.
- The app and the UI probe both use `net8.0-windows10.0.19041.0` and a PerMonitorV2 manifest,
  pinning `WindowsSdkPackageVersion=10.0.19041.56`; the SQLite core's TFM does not change.
  The SDK projection and WinRT runtime are packaged unchanged per the official redistributable list, keeping
  licenses and sources.

## Consequences

### Positive

Card stacking order is decided by the shared renderer; mixed pass-through policies can be validated against other
processes, without the cost of one browser per card.
The same WebView can still update passive papers while the input region is empty, so two renderer states never
diverge.

### Negative

The regions of the two OS windows are updated separately and cannot be claimed as an atomic compositor
transaction.
CompositionControl has an extra copy cost; large numbers of regions still need measuring, and the speed of one
calculation is not a drag frame rate.
Coordination of drafts, capture, focus and authority between the shared renderer and the main window still needs
integration work.

### Neutral

Pixel and hit tests on a single 144 DPI display do not mean mixed DPI, real pointer capture, IME, display
plugging and unplugging or sleep are accepted.
The minimum TFM is not evidence of acceptance on the minimum OS on real hardware; this ADR does not decide the
backend for Mac/Linux/iOS/Android.

## Alternatives Considered

### A transparent full-screen HWND WebView

Cannot directly meet different pass-through policies for different papers; the shared UI still uses the existing
WebView2, and the desktop uses composition instead.

### Switching whole-window pass-through by cursor position

Polling has input races and cannot reliably express a pass-through card in front covering an interactive card
behind it; not adopted.

### One native window per card

Windows could evaluate it separately, but it cannot be the shared guarantee of controllable cross-platform
stacking order, and it multiplies native resource cost.

## 2026-10-06 revision: scenes attached under Explorer use windowed WebView2

Measurements on a real screen found that the desktop layer and the wallpaper layer never appeared on screen:
Explorer's Progman has no redirection surface (`WS_EX_NOREDIRECTIONBITMAP`), so the content of child windows drawn
through WPF has nowhere to be composited: per-pixel transparent content is invisible, and opaque content is only
black.
A host window created with the same styles reproduces this locally (`--host-window-dcomp` and `--host-child`).
- The top layer (a top-level window) keeps this record's composition WebView, input window and mirrored display
  window.
- The desktop layer and the wallpaper layer use windowed WebView2 instead: the browser draws into its own child
  window with DirectComposition.
  It cannot be mirrored into a second window, so the same opaque window handles both display and input, and its
  region keeps only the notes;
  the wallpaper layer receives no clicks beneath the icons, and notes on the desktop layer are clickable anyway, so
  no extra desktop icons are blocked.
- A windowed WebView2 created while the scene window is hidden stays black when shown later; an attached scene
  stays shown until WebView2 creation completes (region empty, so it neither displays nor takes input),
  and is hidden only after creation (`DesktopSurface.Start`). `--host-check` verifies this order automatically with
  a host that imitates Progman.
- The probe that only compared WPF pixels off-screen was not enough to verify this; the wallpaper layer probe now
  reads the real screen (skipped when covered by a window; `--wait-desktop` can wait).

## 2026-10-09 revision: native capture for floating drags

In real use on 23H2 the user found fast drags not smooth and positions snapping back. The floating WebView only had
DOM pointer capture
and no WPF mouse capture; a native probe added before the fix did fail at the capture check.
When the top layer receives a left button press it captures to its own WebView, and releases on button up, on
collapse, on topology pause and on release.
An unexpected loss of native capture tells the scene to cancel the gesture; it does not widen the normal input
region or inject global input.
The capture / region move / release regression after the fix has not been run, because the user asked to stop
testing and screenshots.

## References

- [Windows scene research](../research/2026-10-04-windows-composition-and-input.md)
- [ADR-007](007-desktop-scene-and-platform-host.md), [ADR-015](015-windows-native-storage-and-editor-host.md)
- [Test commands](../testing.md), [Current status](../../PROGRESS.md)
- [WPF Mouse.Capture](https://learn.microsoft.com/en-us/dotnet/api/system.windows.input.mouse.capture?view=windowsdesktop-8.0)
