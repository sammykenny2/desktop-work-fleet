"""X11 keybinder or desktop-portal shortcuts; no keyboard hooks or input taps."""
import hashlib
import re
import gi
from gi.repository import Gdk, Gio, GLib

import protocol as p


def parse(key):
    parts, order = key.split("+"), ["Ctrl", "Alt", "Shift", "Meta"]
    if len(parts) not in range(2, 6) or len(set(parts)) != len(parts) or not re.fullmatch(r"[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])", parts[-1]):
        return None, "invalid"
    mods = parts[:-1]
    if any(value not in order for value in mods) or mods != [value for value in order if value in mods] or not any(value in mods for value in ("Ctrl", "Alt", "Meta")):
        return None, "invalid"
    if "Ctrl" in mods and "Alt" in mods and len(parts[-1]) == 1:
        return None, "typing"
    if ("Ctrl" in mods or "Meta" in mods) and "Alt" not in mods and parts[-1] in ("A", "C", "X", "V", "Z", "Y"):
        return None, "editing"
    if "Meta" in mods and parts[-1] in ("L", "D") or "Alt" in mods and parts[-1] == "F4":
        return None, "reserved"
    names = {"Ctrl": "Control", "Alt": "Alt", "Shift": "Shift", "Meta": "Super"}
    name = parts[-1] if parts[-1].startswith("F") and len(parts[-1]) > 1 else parts[-1].lower()
    return "".join("<" + names[value] + ">" for value in mods) + name, "available"


class Shortcuts:
    def __init__(self, mode, action, changed):
        self.mode, self.action, self.changed = mode, action, changed
        self.bindings, self.registrations, self.active = [], [], {}
        self.generation = 0
        self.suspended = self.closed = False
        self.keybinder = self.bus = self.session = None
        self.requests, self.subscriptions = {}, []
        if mode == "x11":
            try:
                gi.require_version("Keybinder", "3.0")
                from gi.repository import Keybinder
                Keybinder.init()
                # Cooked matching turns Shift+letter into the capital and treats Shift as used, so Ctrl+Shift chords such as
                # the defaults are grabbed but never reach their handler; raw matching compares keycode and modifiers.
                Keybinder.set_use_cooked_accelerators(False)
                self.keybinder = Keybinder
            except (ValueError, ImportError):
                pass
        if self.keybinder is None:
            try:
                self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
                for name in ("Activated", "ShortcutsChanged"):
                    self.subscriptions.append(self.bus.signal_subscribe("org.freedesktop.portal.Desktop", "org.freedesktop.portal.GlobalShortcuts", name, "/org/freedesktop/portal/desktop", None, Gio.DBusSignalFlags.NONE, self.signal, None))
            except GLib.Error:
                self.bus = None

    def configure(self, args):
        values = args.get("bindings")
        p.require(isinstance(values, list) and len(values) <= 32, "shortcut-settings", "此裝置最多設定 32 組快捷鍵。")
        keys, bindings = set(), []
        for value in values:
            p.require(isinstance(value, dict), "shortcut-settings", "快捷鍵設定無效。")
            key, target = p.text(value, "key", 80), p.text(value, "target", 128)
            p.require(key not in keys and re.fullmatch(r"@(?:all|capture|toggle)|[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", target) is not None and target not in ("__proto__", "constructor", "prototype"), "shortcut-settings", "快捷鍵身分或目標無效。")
            keys.add(key)
            chord, status = parse(key)
            identifier = "wf_" + hashlib.sha256((key + "\0" + target).encode()).hexdigest()[:32]
            bindings.append({"key": key, "target": target, "chord": chord, "status": status, "id": identifier})
        self.bindings = bindings
        self.refresh()
        return {"registrations": self.registrations}

    def statuses(self, registered=None):
        registered = registered or {}
        self.registrations = []
        for binding in self.bindings:
            status = binding["status"]
            if status == "available":
                status = "suspended" if self.suspended else "available" if binding["id"] in registered else "unavailable"
            result = {"key": binding["key"], "target": binding["target"], "status": status}
            if registered.get(binding["id"]):
                result["triggerDescription"] = registered[binding["id"]]
            self.registrations.append(result)
        self.changed(self.registrations)

    def suspend(self, value):
        if self.closed or value == self.suspended:
            return
        self.suspended = value
        self.refresh()

    def refresh(self):
        self.generation += 1
        self.clear()
        self.statuses()
        if self.closed or self.suspended:
            return
        if self.keybinder is not None:
            registered = {}
            generation = self.generation
            for binding in self.bindings:
                if binding["chord"] is None:
                    continue

                def invoke(*_, entry=binding):
                    if generation == self.generation and not self.suspended and not self.closed:
                        self.action(entry["target"], int(self.keybinder.get_current_event_time()), None)
                if self.keybinder.bind(binding["chord"], invoke, None):
                    self.active[binding["chord"]] = binding
                    registered[binding["id"]] = binding["key"]
            self.statuses(registered)
            for result in self.registrations:
                if result["status"] == "unavailable" and parse(result["key"])[0] is not None:
                    result["status"] = "conflict"
            self.changed(self.registrations)
        elif self.bus is not None and any(value["chord"] for value in self.bindings):
            self.create_portal()

    def request(self, method, variant, token, callback):
        bus, generation = self.bus, self.generation
        sender = bus.get_unique_name()[1:].replace(".", "_")
        path = f"/org/freedesktop/portal/desktop/request/{sender}/{token}"

        def response(_connection, _sender, _path, _interface, _signal, parameters, _data):
            self.remove_request(path)
            if generation != self.generation or self.closed:
                return
            code, results = parameters.unpack()
            callback(results if code == 0 else None)

        subscription = bus.signal_subscribe("org.freedesktop.portal.Desktop", "org.freedesktop.portal.Request", "Response", path, None, Gio.DBusSignalFlags.NONE, response, None)
        timer = GLib.timeout_add_seconds(110, lambda: (self.remove_request(path), callback(None) if generation == self.generation and not self.closed else None, False)[2])
        self.requests[path] = (subscription, timer)

        def completed(connection, result, _data):
            try:
                returned = connection.call_finish(result).unpack()[0]
                p.require(returned == path, "shortcut-portal", "系統快捷鍵請求身分無效。")
            except (GLib.Error, p.Failure):
                self.remove_request(path)
                if generation == self.generation and not self.closed:
                    callback(None)
        bus.call("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop", "org.freedesktop.portal.GlobalShortcuts", method, variant, GLib.VariantType.new("(o)"), Gio.DBusCallFlags.NONE, 30000, None, completed, None)

    def create_portal(self):
        token = "r" + p.identifier().replace("-", "")
        options = {"handle_token": GLib.Variant("s", token), "session_handle_token": GLib.Variant("s", "s" + p.identifier().replace("-", ""))}

        def created(result):
            if result is None or not isinstance(result.get("session_handle"), str):
                self.statuses()
                return
            self.session = result["session_handle"]
            token = "r" + p.identifier().replace("-", "")
            values = []
            for binding in self.bindings:
                if binding["chord"]:
                    names = {"@all": "調整所有群組", "@capture": "快速記錄", "@toggle": "顯示／隱藏桌面便箋"}
                    parts = binding["key"].split("+")
                    mods = {"Ctrl": "CTRL", "Alt": "ALT", "Shift": "SHIFT", "Meta": "LOGO"}
                    trigger = "+".join([mods[value] for value in parts[:-1]] + [parts[-1] if len(parts[-1]) > 1 else parts[-1].lower()])
                    values.append((binding["id"], {"description": GLib.Variant("s", names.get(binding["target"], "調整指定群組")), "preferred_trigger": GLib.Variant("s", trigger)}))

            def bound(result):
                registered = {} if result is None else {key: value.get("trigger_description", "") for key, value in result.get("shortcuts", [])}
                self.statuses(registered)
            self.request("BindShortcuts", GLib.Variant("(oa(sa{sv})sa{sv})", (self.session, values, "", {"handle_token": GLib.Variant("s", token)})), token, bound)
        self.request("CreateSession", GLib.Variant("(a{sv})", (options,)), token, created)

    def signal(self, _connection, _sender, _path, _interface, name, parameters, _data):
        if self.closed or self.suspended:
            return
        values = parameters.unpack()
        if values[0] != self.session:
            return
        if name == "ShortcutsChanged":
            self.statuses({key: value.get("trigger_description", "") for key, value in values[1]})
        else:
            binding = next((value for value in self.bindings if value["id"] == values[1]), None)
            if binding is not None:
                self.action(binding["target"], int(values[2]) & 0xffffffff, values[3].get("activation_token"))

    def remove_request(self, path):
        value = self.requests.pop(path, None)
        if value is not None:
            self.bus.signal_unsubscribe(value[0])
            GLib.source_remove(value[1])

    def clear(self):
        if self.keybinder is not None:
            for chord in self.active:
                self.keybinder.unbind(chord)
        self.active.clear()
        if self.bus is not None:
            for path in list(self.requests):
                self.bus.call("org.freedesktop.portal.Desktop", path, "org.freedesktop.portal.Request", "Close", None, None, Gio.DBusCallFlags.NONE, 1000, None, None, None)
                self.remove_request(path)
            if self.session is not None:
                self.bus.call("org.freedesktop.portal.Desktop", self.session, "org.freedesktop.portal.Session", "Close", None, None, Gio.DBusCallFlags.NONE, 1000, None, None, None)
                self.session = None

    def close(self):
        self.closed = True
        self.generation += 1
        self.clear()
        if self.bus is not None:
            for token in self.subscriptions:
                self.bus.signal_unsubscribe(token)
        self.subscriptions.clear()
