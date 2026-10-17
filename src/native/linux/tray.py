"""System tray with availability feedback; never hide the only reachable management window."""
import gi
from gi.repository import Gtk

from text import t


class Tray:
    def __init__(self, app_id, main, action, quit_app, menu_active, icon=None, reveal=None, update=None, changed=None):
        self.main, self.action, self.menu_active = main, action, menu_active
        self.reveal, self.changed = reveal, changed
        self.available = self.closed = self.ever_connected = False
        self.indicator = self.icon = None
        self.menu = Gtk.Menu()
        # Each item keeps its text.py key, so a language change relabels the menu in place.
        self.items = []
        for key, target in (("tray.open", "show"), ("tray.quickCapture", "@capture"), ("tray.adjustAll", "@all"), ("tray.toggleDesktop", "@toggle")):
            item = self.item(key)
            item.connect("activate", lambda _item, value=target: self.dispatch(value))
        if update is not None:
            update_item = self.item("tray.checkUpdates")
            update_item.connect("activate", lambda *_: (self.menu_active(False), update()))
        self.menu.append(Gtk.SeparatorMenuItem())
        quit_item = self.item("tray.saveAndQuit")
        quit_item.connect("activate", lambda *_: (self.menu_active(False), quit_app()))
        self.menu.connect("show", lambda *_: self.menu_active(True))
        self.menu.connect("hide", lambda *_: self.menu_active(False))
        self.menu.show_all()
        self.menu.hide()
        for namespace in ("AyatanaAppIndicator3", "AppIndicator3"):
            try:
                gi.require_version(namespace, "0.1")
                module = getattr(__import__("gi.repository", fromlist=[namespace]), namespace)
                self.indicator = module.Indicator.new(app_id, app_id, module.IndicatorCategory.APPLICATION_STATUS)
                # Panels such as wf-panel-pi show the title on hover; without one libayatana uses the program name, host.py.
                self.indicator.set_title("Work Fleet")
                if icon is not None:
                    # Portable bundles are not in the icon theme; let the indicator find <app_id>.png beside the bundle.
                    self.indicator.set_icon_theme_path(str(icon.parent))
                self.indicator.set_menu(self.menu)
                self.indicator.connect("connection-changed", lambda _indicator, connected: self.connection(bool(connected)))
                self.indicator.set_status(module.IndicatorStatus.ACTIVE)
                self.passive = module.IndicatorStatus.PASSIVE
                break
            except (ValueError, ImportError, TypeError):
                self.indicator = None
        if self.indicator is None:
            self.icon = Gtk.StatusIcon.new_from_file(str(icon)) if icon is not None else Gtk.StatusIcon.new_from_icon_name(app_id)
            self.icon.set_title("Work Fleet")
            self.icon.set_tooltip_text("Work Fleet")
            self.icon.connect("activate", lambda *_: self.dispatch("show"))
            self.icon.connect("popup-menu", lambda _icon, button, timestamp: self.menu.popup(None, None, Gtk.StatusIcon.position_menu, self.icon, button, timestamp))
            self.icon.connect("notify::embedded", lambda *_: self.connection(self.icon.is_embedded()))
            self.icon.set_visible(True)
            # Embedding is asynchronous: the start only records it, and a hidden sign-in start waits for it (ADR-043).
            self.available = self.ever_connected = self.icon.is_embedded()

    def item(self, key):
        item = Gtk.MenuItem.new_with_label(t(key))
        self.items.append((item, key))
        self.menu.append(item)
        return item

    def relabel(self):
        """Redraws the menu in the current display language; the indicator exports label changes by itself."""
        if self.closed:
            return
        for item, key in self.items:
            item.set_label(t(key))

    def connection(self, connected):
        if self.closed:
            return
        was, self.available = self.available, connected
        if connected != was and self.changed is not None:
            self.changed(connected)
        # Only a tray that was there and went away strands a hidden window. At sign-in the panel may start after Work Fleet,
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
        self.menu_active(False)
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
            self.indicator.set_status(self.passive)
        if self.icon is not None:
            self.icon.set_visible(False)
        self.menu.destroy()
