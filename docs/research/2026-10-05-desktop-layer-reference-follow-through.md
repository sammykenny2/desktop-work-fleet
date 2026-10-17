# Desktop layers: following through on the reference's native results

Date: 2026-10-05. The source is the auxiliary reference checkout provided by the maintainer; its location is not
written into this repo.
This is a check of behavior and failure evidence; no reference source, UI, assets or schema were ported into this
product.

## Evidence read

- The Linux 2026-10-02 layer-shell problem report, including the 2026-10-03 input shape/tray additions, device
  results and unresolved items.
- The Linux 2026-10-02 report on Debian packaging, command-line operation and known limits.
- The macOS 2026-04-14 desktop/wallpaper split fix; the Windows 2026-04-14 Explorer layer semantics fix.
- The layers, geometry, size request, input shape, queue draw and redraw entry points of the Linux native layer
  surface.
- This project's existing SPEC-003, ADR-023/025/030 and the cross-platform feasibility research.

## Reference test results, not this product passing

The Linux test environment is a Pi 5, Raspberry Pi OS/Debian 13 arm64, labwc 0.20.2/wlroots 0.20,
pcmanfm-pi 1.11, WebKitGTK 2.54 and gtk-layer-shell 0.9.0.
The reports contain real desktop screenshots, Wayland protocol traces, virtual pointer/uinput and independent
GTK/WebKit reproductions.
Desktop BOTTOM, operation TOP and background BACKGROUND were switched; four fast/slow drags matched the pointer
movement, in-place editing accepted input and saved, the picture was complete after layer switches/reshowing, and
everyday pass-through reached pcmanfm.

The fixes relevant to this product are the DMA-BUF/V3D corruption, transparent WebKit damage, size request,
GTK allocation overwriting the GdkWindow input shape, and the need to produce a frame after updating the region.
This product uses one shared scene per display and cards move inside the renderer, so no native surfaces are moved;
the reference's one-window-per-card margin moves and pointer settle algorithm are not needed. Viewport-local pointer
conversion is still used.

Unresolved in the reports: pcmanfm combines wallpaper and icons, so BACKGROUND cannot be inserted below the icons;
a dual-display Pi and some transparency effects were not tested. GNOME/X11 do not use this layer-shell backend.
External reports on shortcuts and the tray do not mean this product's portal/system tray has passed on the Pi.

## This product's decisions and verification

[ADR-031](../decisions/031-macos-and-linux-wallpaper-scenes.md) adds a third layer on the Mac and Linux BACKGROUND,
and fixes the input shape and redraws at the same time. The new tests use this product's native sources and synthetic
projections from the shared core directly.
Results and versions are in the git history, unverified boundaries in [testing](../testing.md), and current status in
[PROGRESS](../../PROGRESS.md).
