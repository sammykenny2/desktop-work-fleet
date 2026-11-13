"""A StatusNotifierItem with a primary action and an exported flat tray menu.

Older AppIndicator libraries consume primary clicks as menu requests. Export the public
D-Bus interfaces directly with Gio, which the host already needs, on a dedicated connection.
"""
from gi.repository import Gio, GLib, Gtk
from text import t

ITEM = "org.kde.StatusNotifierItem"
WATCHER = "org.kde.StatusNotifierWatcher"
MENU = "com.canonical.dbusmenu"
ITEM_PATH = "/StatusNotifierItem"
MENU_PATH = "/TrayMenu"

ITEM_XML = """<node><interface name="org.kde.StatusNotifierItem">
<property name="Category" type="s" access="read"/><property name="Id" type="s" access="read"/>
<property name="Title" type="s" access="read"/><property name="Status" type="s" access="read"/>
<property name="WindowId" type="u" access="read"/><property name="IconName" type="s" access="read"/>
<property name="IconThemePath" type="s" access="read"/><property name="IconPixmap" type="a(iiay)" access="read"/>
<property name="OverlayIconName" type="s" access="read"/><property name="OverlayIconPixmap" type="a(iiay)" access="read"/>
<property name="AttentionIconName" type="s" access="read"/><property name="AttentionIconPixmap" type="a(iiay)" access="read"/>
<property name="AttentionMovieName" type="s" access="read"/><property name="ToolTip" type="(sa(iiay)ss)" access="read"/>
<property name="ItemIsMenu" type="b" access="read"/><property name="Menu" type="o" access="read"/>
<method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
<method name="SecondaryActivate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
<method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
<method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
<signal name="NewStatus"><arg type="s"/></signal>
<signal name="NewTitle"/><signal name="NewToolTip"/>
</interface></node>"""

MENU_XML = """<node><interface name="com.canonical.dbusmenu">
<property name="Version" type="u" access="read"/><property name="TextDirection" type="s" access="read"/>
<property name="Status" type="s" access="read"/><property name="IconThemePath" type="as" access="read"/>
<method name="GetLayout"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="as" direction="in"/>
<arg type="u" direction="out"/><arg type="(ia{sv}av)" direction="out"/></method>
<method name="GetGroupProperties"><arg type="ai" direction="in"/><arg type="as" direction="in"/>
<arg type="a(ia{sv})" direction="out"/></method>
<method name="GetProperty"><arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
<method name="Event"><arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="in"/><arg type="u" direction="in"/></method>
<method name="EventGroup"><arg type="a(isvu)" direction="in"/><arg type="ai" direction="out"/></method>
<method name="AboutToShow"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
<method name="AboutToShowGroup"><arg type="ai" direction="in"/><arg type="ai" direction="out"/><arg type="ai" direction="out"/></method>
<signal name="LayoutUpdated"><arg type="u"/><arg type="i"/></signal>
<signal name="ItemsPropertiesUpdated"><arg type="a(ia{sv})"/><arg type="a(ias)"/></signal>
</interface></node>"""


class StatusNotifier:
    def __init__(self, app_id, menu, activate, popup, menu_active, connected, icon=None):
        self.menu, self.activate, self.popup = menu, activate, popup
        self.menu_active, self.connected = menu_active, connected
        self.closed, self.proxy, self.owner, self.registered = False, None, None, False
        self.revision = 1
        self.properties = {
            "Category": GLib.Variant("s", "ApplicationStatus"), "Id": GLib.Variant("s", app_id),
            "Title": GLib.Variant("s", t("common.appName")), "Status": GLib.Variant("s", "Active"),
            "WindowId": GLib.Variant("u", 0), "IconName": GLib.Variant("s", icon.stem if icon else app_id),
            "IconThemePath": GLib.Variant("s", str(icon.parent) if icon else ""),
            "ItemIsMenu": GLib.Variant("b", False), "Menu": GLib.Variant("o", MENU_PATH),
            "ToolTip": GLib.Variant("(sa(iiay)ss)", (app_id, [], t("common.appName"), "")),
        }
        for prefix in ("", "Overlay", "Attention"):
            self.properties[prefix + "IconPixmap"] = GLib.Variant("a(iiay)", [])
        for name in ("OverlayIconName", "AttentionIconName", "AttentionMovieName"):
            self.properties[name] = GLib.Variant("s", "")
        self.menu_properties = {"Version": GLib.Variant("u", 3), "TextDirection": GLib.Variant("s", "ltr"),
                                "Status": GLib.Variant("s", "normal"), "IconThemePath": GLib.Variant("as", [])}
        address = Gio.dbus_address_get_for_bus_sync(Gio.BusType.SESSION, None)
        self.bus = Gio.DBusConnection.new_for_address_sync(address,
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)
        self.bus.set_exit_on_close(False)
        self.bus.connect("closed", lambda *_: self.connection(False))
        self.bus.register_object(ITEM_PATH, Gio.DBusNodeInfo.new_for_xml(ITEM_XML).interfaces[0], self.item_call,
                                 lambda _bus, _sender, _path, _interface, name: self.properties.get(name), None)
        self.bus.register_object(MENU_PATH, Gio.DBusNodeInfo.new_for_xml(MENU_XML).interfaces[0], self.menu_call,
                                 lambda _bus, _sender, _path, _interface, name: self.menu_properties.get(name), None)
        self.watch = Gio.bus_watch_name_on_connection(self.bus, WATCHER, Gio.BusNameWatcherFlags.NONE, self.appeared, self.vanished)

    def connection(self, available):
        if not self.closed:
            if not available:
                self.menu_active(False)
            self.connected(available)

    def appeared(self, bus, _name, owner):
        self.owner, self.proxy, self.registered = owner, None, False
        Gio.DBusProxy.new(bus, Gio.DBusProxyFlags.NONE, None, owner, "/StatusNotifierWatcher", WATCHER, None,
                          self.proxy_ready, owner)

    def proxy_ready(self, _source, result, owner):
        try:
            proxy = Gio.DBusProxy.new_finish(result)
        except GLib.Error:
            return
        if self.closed or self.owner != owner:
            return
        self.proxy = proxy
        proxy.connect("g-properties-changed", lambda *_: self.update_connection())
        proxy.connect("g-signal", self.watcher_signal)
        proxy.call("RegisterStatusNotifierItem", GLib.Variant("(s)", (ITEM_PATH,)), Gio.DBusCallFlags.NONE,
                   5000, None, self.registration_ready, proxy)

    def registration_ready(self, proxy, result, _data):
        try:
            proxy.call_finish(result)
        except GLib.Error:
            return
        if not self.closed and self.proxy is proxy:
            self.registered = True
            self.update_connection()

    def update_connection(self):
        value = self.proxy.get_cached_property("IsStatusNotifierHostRegistered") if self.proxy else None
        self.connection(self.registered and bool(value and value.unpack()))

    def watcher_signal(self, proxy, _sender, name, _args):
        if self.proxy is proxy and name in ("StatusNotifierHostRegistered", "StatusNotifierHostUnregistered"):
            self.connection(self.registered and name == "StatusNotifierHostRegistered")

    def vanished(self, *_args):
        self.owner, self.proxy, self.registered = None, None, False
        self.connection(False)

    def item_call(self, _bus, _sender, _path, _interface, method, args, invocation):
        invocation.return_value(None)
        if self.closed:
            return
        if method == "Activate":
            self.menu_active(False)
            self.activate()
        elif method == "ContextMenu":
            self.popup(*args.unpack())

    def nodes(self):
        return {index: item for index, item in enumerate(self.menu.get_children(), 1)}

    def item_properties(self, node_id, names=()):
        if node_id == 0:
            values = {"children-display": GLib.Variant("s", "submenu")}
        else:
            item = self.nodes()[node_id]
            values = {"type": GLib.Variant("s", "separator")} if isinstance(item, Gtk.SeparatorMenuItem) else {
                "label": GLib.Variant("s", item.get_label().replace("_", "__"))}
            values.update(enabled=GLib.Variant("b", item.get_sensitive()), visible=GLib.Variant("b", item.get_visible()))
            if getattr(item, "shortcut_parts", None):
                values["shortcut"] = GLib.Variant("aas", [item.shortcut_parts])
        return {key: value for key, value in values.items() if not names or key in names}

    def event(self, node_id, event, _data, _time):
        if self.closed:
            return
        if node_id != 0 and node_id not in self.nodes():
            raise KeyError(node_id)
        if event in ("opened", "closed") and node_id == 0:
            self.menu_active(event == "opened")
        elif event == "clicked" and node_id:
            item = self.nodes()[node_id]
            if item.get_visible() and item.get_sensitive():
                self.menu_active(False)
                item.activate()

    def about_to_show(self, node_id):
        self.item_properties(node_id)
        before = self.revision
        if node_id == 0:
            self.menu_active(True)
        return self.revision != before

    def menu_call(self, _bus, _sender, _path, _interface, method, args, invocation):
        values = args.unpack()
        try:
            reply = None
            if method == "GetLayout":
                node_id, depth, names = values
                children = [GLib.Variant("(ia{sv}av)", (child, self.item_properties(child, names), []))
                            for child in self.nodes()] if node_id == 0 and depth != 0 else []
                reply = GLib.Variant("(u(ia{sv}av))", (self.revision, (node_id, self.item_properties(node_id, names), children)))
            elif method == "GetGroupProperties":
                ids, names = values
                reply = GLib.Variant("(a(ia{sv}))", ([(node_id, self.item_properties(node_id, names)) for node_id in (ids or [0, *self.nodes()]) if node_id == 0 or node_id in self.nodes()],))
            elif method == "GetProperty":
                reply = GLib.Variant("(v)", (self.item_properties(values[0])[values[1]],))
            elif method == "Event":
                self.event(*values)
            elif method == "EventGroup":
                errors = []
                for event in values[0]:
                    try:
                        self.event(*event)
                    except KeyError:
                        errors.append(event[0])
                reply = GLib.Variant("(ai)", (errors,))
            elif method == "AboutToShow":
                reply = GLib.Variant("(b)", (self.about_to_show(values[0]),))
            elif method == "AboutToShowGroup":
                errors, changed = [], []
                for node_id in values[0]:
                    try:
                        if self.about_to_show(node_id):
                            changed.append(node_id)
                    except KeyError:
                        errors.append(node_id)
                reply = GLib.Variant("(aiai)", (changed, errors))
            invocation.return_value(reply)
        except KeyError:
            invocation.return_dbus_error(MENU + ".Error.InvalidMenuItem", "The tray menu item or property does not exist.")

    def relabel(self):
        if not self.closed:
            self.properties["Title"] = GLib.Variant("s", t("common.appName"))
            tooltip = self.properties["ToolTip"].unpack()
            self.properties["ToolTip"] = GLib.Variant("(sa(iiay)ss)", (tooltip[0], tooltip[1], t("common.appName"), tooltip[3]))
            self.bus.emit_signal(None, ITEM_PATH, ITEM, "NewTitle", None)
            self.bus.emit_signal(None, ITEM_PATH, ITEM, "NewToolTip", None)
            self.revision += 1
            self.bus.emit_signal(None, MENU_PATH, MENU, "LayoutUpdated", GLib.Variant("(ui)", (self.revision, 0)))

    def close(self):
        if self.closed:
            return
        self.closed = True
        Gio.bus_unwatch_name(self.watch)
        if not self.bus.is_closed():
            self.bus.close_sync(None)
