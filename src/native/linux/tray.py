"""System tray with availability feedback; never hide the only reachable management window."""
import gi
from gi.repository import Gtk


class Tray:
    def __init__(self, app_id, main, action, quit_app, menu_active, icon=None):
        self.main, self.action, self.menu_active = main, action, menu_active
        self.available = self.closed = False
        self.indicator = self.icon = None
        self.menu = Gtk.Menu()
        for title, target in (("開啟 Work Fleet", "show"), ("快速記錄", "@capture"), ("操作所有群組", "@all"), ("顯示／隱藏桌面便箋", "@toggle")):
            item = Gtk.MenuItem.new_with_label(title)
            item.connect("activate", lambda _item, value=target: self.dispatch(value))
            self.menu.append(item)
        self.menu.append(Gtk.SeparatorMenuItem())
        quit_item = Gtk.MenuItem.new_with_label("保存並結束")
        quit_item.connect("activate", lambda *_: (self.menu_active(False), quit_app()))
        self.menu.append(quit_item)
        self.menu.connect("show", lambda *_: self.menu_active(True))
        self.menu.connect("hide", lambda *_: self.menu_active(False))
        self.menu.show_all()
        self.menu.hide()
        for namespace in ("AyatanaAppIndicator3", "AppIndicator3"):
            try:
                gi.require_version(namespace, "0.1")
                module = getattr(__import__("gi.repository", fromlist=[namespace]), namespace)
                self.indicator = module.Indicator.new(app_id, app_id, module.IndicatorCategory.APPLICATION_STATUS)
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
            self.connection(self.icon.is_embedded())

    def connection(self, connected):
        if self.closed:
            return
        self.available = connected
        if not connected and not self.main.get_visible():
            self.main.set_focus_on_map(False)
            self.main.show_all()

    def dispatch(self, target):
        self.menu_active(False)
        if target == "show":
            self.main.present()
        else:
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
