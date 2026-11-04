# Tray primary-click behavior

## Evidence

The maintainer requested primary-click opening of the main window on macOS and Linux, matching Windows.

- [AppKit NSStatusItem.menu](https://developer.apple.com/documentation/appkit/nsstatusitem/menu) disables the item's
  single-click action when a menu is attached. The button can instead send left/right mouse-up actions and open a
  separately held menu with [NSMenu.popUp](https://developer.apple.com/documentation/appkit/nsmenu/popup(positioning:at:in:)).
- The [StatusNotifierItem specification](https://specifications.freedesktop.org/status-notifier-item/latest-single/)
  separates Activate from ContextMenu and defines ItemIsMenu. The desktop panel ultimately maps physical input to these methods.
- [libayatana-appindicator 0.5.94](https://github.com/AyatanaIndicators/libayatana-appindicator/blob/0.5.94/src/app-indicator.c)
  lacks the primary-activation GObject signal. The newer upstream implementation provides that signal, but does not
  export ItemIsMenu. Depending on a new signal alone therefore does not fix older runtimes or every panel.
- [wf-panel-pi item.cpp](https://github.com/raspberrypi-ui/wf-panel-pi/blob/master/src/widgets/tray/item.cpp), inspected
  2026-11-05, defaults a missing ItemIsMenu to true. With false, an ordinary primary click calls Activate, and a context
  click opens the exported menu. Its icon loader uses IconName with IconThemePath, so the item supplies the icon's
  file stem and directory rather than an absolute IconName.

## Decision and boundaries

ADR-023 and ADR-025 own the decisions. Linux exports the small flat tray menu and the notifier item through the existing
Gio runtime, with no new library dependency. A dedicated bus connection removes the item on close. X11 retains its legacy
tray fallback; it stays hidden while a notifier host is connected. The implementation is independent protocol code;
the sources above were consulted for behavior and API constraints, with no copied implementation or assets.

The isolated Linux probe checks real Gio serialization and GTK actions, menu labels and lifecycle, late connection,
disappearance and reconnection. It is not acceptance of physical clicks on GNOME, KDE or Pi panels, nor of Wayland focus
policy. The macOS app compiles; real menu-bar click and dismissal acceptance is still needed.
