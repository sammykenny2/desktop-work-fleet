"""System tray with availability feedback; never hide the only reachable management window."""
from gi.repository import Gdk, GLib, Gtk

from statusnotifier import StatusNotifier
from text import t


def entries(main_visible=False, adjusting=False, ready=False, updates=False, shortcuts=()):
    """Product action order, also checked against the Windows and macOS menu fixture."""
    keys = {item["target"]: item["key"] for item in reversed(shortcuts) if item.get("status") == "available"}
    row = lambda action, key, enabled=True: {"action": action, "key": key, "enabled": enabled, "shortcut": keys.get(action)}
    rows = [row("show", "tray.open")]
    if main_visible:
        rows.append(row("@hide", "tray.hideMain", ready))
    rows += [None, row("@capture", "tray.quickCapture", ready), row("@toggle", "tray.toggleDesktop", ready),
             row("@stop", "tray.finishAdjusting", ready) if adjusting else row("@all", "tray.adjustAll", ready), None]
    if updates:
        rows += [row("update", "tray.checkUpdates"), None]
    rows.append(row("exit", "tray.saveAndQuit"))
    return rows


class Tray:
    def __init__(self, app_id, main, action, quit_app, menu_active, icon=None, reveal=None, update=None, changed=None, state=None):
        self.main, self.action, self.menu_active = main, action, menu_active or (lambda _active: None)
        self.reveal, self.changed = reveal, changed
        self.state = state or (lambda: {"main_visible": main.get_visible(), "ready": True})
        self.quit_app, self.update = quit_app, update
        self.tracking = False
        self.available = self.closed = self.ever_connected = False
        self.indicator = self.icon = None
        self.notifier_available = False
        self.menu = Gtk.Menu()
        # Each item keeps its text.py key, so a language change relabels the menu in place.
        self.items = []
        # Keep node IDs stable for D-Bus clients even when rows are hidden or the adjustment state changes.
        self.slots = []
        for key in ("tray.open", "tray.hideMain", None, "tray.quickCapture", "tray.toggleDesktop", "tray.adjustAll", None,
                    "tray.checkUpdates", None, "tray.saveAndQuit"):
            item = self.item(key) if key else Gtk.SeparatorMenuItem()
            if key:
                item.connect("activate", self.selected)
            else:
                self.menu.append(item)
            self.slots.append((item, key))
        self.menu.connect("show", lambda *_: self.set_menu_active(True))
        self.menu.connect("hide", lambda *_: self.set_menu_active(False))
        self.menu.show_all()
        self.menu.hide()
        self.refresh()
        # A legacy X11 tray is also usable when no StatusNotifier host is present. Never show two icons.
        display = Gdk.Display.get_default()
        if display is not None and display.__gtype__.name == "GdkX11Display":
            self.icon = Gtk.StatusIcon.new_from_file(str(icon)) if icon is not None else Gtk.StatusIcon.new_from_icon_name(app_id)
            self.icon.set_title(t("common.appName"))
            self.icon.set_tooltip_text(t("common.appName"))
            self.icon.connect("activate", lambda *_: self.dispatch("show"))
            self.icon.connect("popup-menu", lambda _icon, button, timestamp: self.menu.popup(None, None, Gtk.StatusIcon.position_menu, self.icon, button, timestamp))
            self.icon.connect("notify::embedded", lambda *_: self.connection(self.notifier_available or self.icon.is_embedded()))
            self.icon.set_visible(True)
            self.available = self.ever_connected = self.icon.is_embedded()
        try:
            self.indicator = StatusNotifier(app_id, self.menu, lambda: self.dispatch("show"), self.popup,
                                            self.set_menu_active, self.notifier_connection, icon)
        except GLib.Error:
            # Without a session bus the legacy tray is still usable; without either, closing cannot strand the window.
            self.indicator = None

    def notifier_connection(self, connected):
        self.notifier_available = connected
        if self.icon is not None:
            self.icon.set_visible(not connected)
        self.connection(connected or bool(self.icon and self.icon.is_embedded()))

    def popup(self, x, y):
        # Panels normally import Menu over D-Bus; ContextMenu is the native fallback for hosts that request it.
        self.menu.popup(None, None, lambda *_: (x, y, False), None, 3, Gtk.get_current_event_time())

    def item(self, key):
        item = Gtk.MenuItem.new_with_label(t(key))
        self.items.append((item, key))
        self.menu.append(item)
        return item

    def relabel(self):
        """Redraws the menu in the current display language; the indicator exports label changes by itself."""
        if self.closed:
            return
        self.refresh()
        if self.icon is not None:
            self.icon.set_title(t("common.appName"))
            self.icon.set_tooltip_text(t("common.appName"))
    def refresh(self):
        if self.closed:
            return
        state = {**self.state(), "updates": self.update is not None}
        rows = entries(**state)
        visible = {row["key"]: row for row in rows if row}
        # The one adjustment slot changes its label and action without changing its exported node ID.
        if "tray.finishAdjusting" in visible:
            visible["tray.adjustAll"] = visible["tray.finishAdjusting"]
        self.items = []
        for index, (item, key) in enumerate(self.slots):
            if key is None:
                item.set_visible(index == 2 or index == 6 or index == 8 and self.update is not None)
                continue
            row = visible.get(key)
            item.set_visible(row is not None)
            if row is None:
                continue
            item.set_label(t(row["key"])); item.set_sensitive(row["enabled"])
            item.tray_action = row["action"]
            shortcut = row["shortcut"]
            item.shortcut_parts = [] if not shortcut else [{"Ctrl": "Control", "Meta": "Super"}.get(part, part) for part in shortcut.split("+")]
            child = item.get_child()
            if child is not None:
                chord = "" if not shortcut else "".join("<" + part + ">" for part in item.shortcut_parts[:-1]) + item.shortcut_parts[-1]
                accel, modifiers = Gtk.accelerator_parse(chord)
                child.set_accel(accel, modifiers)
            self.items.append((item, row["key"]))
        if self.indicator is not None:
            self.indicator.relabel()

    def set_menu_active(self, active):
        if active and not self.tracking:
            self.refresh()
        self.tracking = active
        self.menu_active(active)

    def selected(self, item):
        if not item.get_visible() or not item.get_sensitive():
            return
        self.set_menu_active(False)
        if item.tray_action == "update":
            self.update()
        elif item.tray_action == "exit":
            self.quit_app()
        else:
            self.dispatch(item.tray_action)

    def connection(self, connected):
        if self.closed:
            return
        was, self.available = self.available, connected
        if connected != was and self.changed is not None:
            self.changed(connected)
        # Only a tray that was there and went away strands a hidden window. At sign-in the panel may start after Pin It Anywhere,
        # and the indicator reports the missing watcher at once; the host's bounded wait covers that (ADR-043).
        if connected:
            self.ever_connected = True
        elif self.ever_connected and not self.main.get_visible():
            if self.reveal is not None:
                self.reveal()
            else:
                self.main.set_focus_on_map(False)
                self.main.show_all()

    def dispatch(self, target):
        self.set_menu_active(False)
        self.action(target, Gtk.get_current_event_time(), None)

    def hide(self):
        if not self.available or self.closed:
            return False
        self.main.hide()
        return True

    def close(self):
        self.closed = True
        self.available = False
        if self.indicator is not None:
            self.indicator.close()
        if self.icon is not None:
            self.icon.set_visible(False)
        self.menu.destroy()
