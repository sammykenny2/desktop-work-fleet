# Windows desktop channels and logical coordinates

Reviewed: 2026-10-04. The decision is in [ADR-018](../decisions/018-single-owner-desktop-views.md); test results are in
the git history and verification procedures in [testing](../testing.md), with current status in
[PROGRESS](../../PROGRESS.md).

## Official evidence

Microsoft explains that DPI-aware window/mouse coordinates must be converted explicitly to and from logical drawing
units; physical pixels cannot be used directly as DIPs.
See [DPI and device-independent pixels](https://learn.microsoft.com/en-us/windows/win32/learnwin32/dpi-and-device-independent-pixels).
After the multi-display APIs return monitor bounds, SetWindowPos can position windows; the primary work area cannot
replace the work areas of all displays.
See [Positioning objects on multiple display monitors](https://learn.microsoft.com/en-us/windows/win32/gdi/positioning-objects-on-multiple-display-monitors).

The ZoomFactor of the WPF CompositionControl publicly forwards the WebView controller's zoom setting.
See [WebView2CompositionControl.ZoomFactor](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.wpf.webview2compositioncontrol.zoomfactor).
This proves the API exists; it does not prove that this product's text, dragging and native hit-testing are all
correct under mixed DPI.

## This product's inferences and adoption

One renderer per display/per layer limits the size of any single surface, while the DOM still controls the
front-to-back order of cards within a layer.
The primary display's DPI is used as one unified reference scale, and all native bounds/work areas are projected into
continuous coordinates.
The WebView zoom on each display compensates for its system DPI, so the two halves of one card crossing a display
edge are not drawn at different pixel sizes.
The cost is that per-display DPI preferences cannot each change the font size of the same paper; device acceptance and
later settings must handle this explicitly.

Frames/commands flow only in process memory, and a completed frame lease is not rewritten by a newer version.
A draft flush is a non-blocking event handshake; if the native dispatch waited until the draft was saved before
replying, the following storage.commit could not pass through the same channel, causing a deadlock. The final write
needs a separate admission/execution lane.

## Verification boundaries

The real WPF probe uses a synthetic profile and off-screen display descriptions, while keeping real
WebView2/SQLite/DPAPI/IPC.
DOM CompositionEvent verifies the handler and the exit barrier; it cannot count as evidence that a real Windows IME
candidate window passes.
Likewise, synthetic commands/PointerEvents cannot prove real mouse capture, dragging across monitors, Win+D or
virtual desktops.
Native cross-process region hit-test evidence is still in the [previous research](2026-10-04-windows-composition-and-input.md).
