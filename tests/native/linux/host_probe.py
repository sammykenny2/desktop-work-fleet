"""ADR-043 on the real GTK owner in isolated X11 and labwc sessions: main window bounds, startup settings and a hidden sign-in start.

Usage: host_probe.py OUTPUT MODE, MODE one of place, restore, hidden, hidden-tray, data-failure, actions (X11) or wayland, wayland-restore (labwc). Each
mode is its own process so GApplication registers afresh; the data, bundle and XDG config folders live under OUTPUT. Only data-failure opens the
workspace store: a database that is not SQLite explains itself, and its set-aside opens empty data (SPEC-006 DO).
hidden-tray needs a private session bus: it plays a panel whose StatusNotifierWatcher starts late."""
import json
import os
from pathlib import Path
import sys
import time

OUTPUT = Path(sys.argv[1]).absolute()
MODE = sys.argv[2]
ROOT = Path(__file__).resolve().parents[3]
os.environ["XDG_CONFIG_HOME"] = str(OUTPUT / "config")
# The first launch must find no preferences file, so the display language stays auto and follows this: English text.
os.environ["LANGUAGE"] = "en"
sys.path.insert(0, str(ROOT / "src/native/linux"))
import host
import hostsettings
import text
from gi.repository import Gio, GLib, Gtk

WATCHER = """<node><interface name="org.kde.StatusNotifierWatcher">
<method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method>
<method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method>
<property name="RegisteredStatusNotifierItems" type="as" access="read"/>
<property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
<property name="ProtocolVersion" type="i" access="read"/>
</interface></node>"""


def spin(predicate, seconds=10, message="timed out"):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        while GLib.MainContext.default().pending():
            GLib.MainContext.default().iteration(False)
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError(message)


def settle(seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        while GLib.MainContext.default().pending():
            GLib.MainContext.default().iteration(False)
        time.sleep(0.02)


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print("PASS", message)


def own_watcher():
    """A minimal panel tray on the session bus; returns the name ownership to release."""
    bus = Gio.bus_get_sync(Gio.BusType.SESSION)
    values = {"RegisteredStatusNotifierItems": GLib.Variant("as", []), "IsStatusNotifierHostRegistered": GLib.Variant("b", True),
              "ProtocolVersion": GLib.Variant("i", 0)}
    bus.register_object("/StatusNotifierWatcher", Gio.DBusNodeInfo.new_for_xml(WATCHER).interfaces[0],
                        lambda _bus, _sender, _path, _interface, _method, _args, invocation: invocation.return_value(None),
                        lambda _bus, _sender, _path, _interface, name: values[name], None)
    return Gio.bus_own_name_on_connection(bus, "org.kde.StatusNotifierWatcher", Gio.BusNameOwnerFlags.NONE, None, None)


# A packaged bundle layout, so the sign-in command and version come from it rather than from this checkout.
bundle = OUTPUT / "bundle"
(bundle / "Assets").mkdir(parents=True, exist_ok=True)
(bundle / "run-work-fleet.sh").write_text("#!/bin/bash\n", "utf-8")
(bundle / "package.json").write_text('{"version": "9.8.7"}', "utf-8")
data = OUTPUT / "data"
real_open_store = host.FleetApp.open_store
host.FleetApp.open_store = lambda self, profile, persist=False, set_aside=False: None
# A shorter wait than config/startup.json, delivered the same way: through the public config.
WAIT = 3
app = host.FleetApp(bundle / "Assets", {"appId": "app.workfleet.hostprobe", "startup": {"trayWaitSeconds": WAIT}}, data,
                    launched_at_login=MODE.startswith("hidden"), default_data=data)
app.register(None)
autostart = hostsettings.autostart_path(os.environ)

if MODE == "place":
    app.activate(app)
    spin(lambda: app.window.get_mapped(), message="main window mapped")
    settle(0.5)
    width, height = app.window.get_size()
    check((width, height) == (1180, 800), f"default size {width}x{height}")
    check(autostart.is_file() and "Exec=" + hostsettings._quote(str(bundle / "run-work-fleet.sh")) + " --launch-at-login" in autostart.read_text("utf-8"),
          "first launch writes the sign-in entry for the bundle launcher")
    check(hostsettings.read_preferences(data)[1], "first launch records the preferences file")
    app.window.move(100, 80)
    app.window.resize(900, 640)
    spin(lambda: hostsettings.read_placement(data) == {"x": 100, "y": 80, "width": 900, "height": 640, "maximized": False}, message=f"moved bounds saved: {hostsettings.read_placement(data)}")
    check(True, "moved bounds saved")
    app.window.maximize()
    spin(lambda: (hostsettings.read_placement(data) or {}).get("maximized") is True, message="maximized flag saved")
    check(hostsettings.read_placement(data) == {"x": 100, "y": 80, "width": 900, "height": 640, "maximized": True}, "maximized keeps the restore bounds")
    app.window.iconify()
    settle(1)
    check(hostsettings.read_placement(data)["maximized"] is True, "minimizing keeps the saved state")
    app.window.deiconify()
    app.window.unmaximize()
    spin(lambda: hostsettings.read_placement(data) == {"x": 100, "y": 80, "width": 900, "height": 640, "maximized": False}, message=f"unmaximize clears the flag: {hostsettings.read_placement(data)}")
    check(True, "unmaximize clears the flag")
    update = app.shell_invoke("update.state", {})
    check(update["status"] == "unavailable" and "DEB" in update["reason"] and update["currentVersion"] == "9.8.7",
          "a bundle run reports why in-app updates are unavailable")
    check(app.shell_invoke("update.check", {})["status"] == "unavailable", "checking does nothing without update support")
    described = app.shell_invoke("host.preferences.get", {})
    check(described["startAtLogin"] == {"available": True, "enabled": True, "preference": True, "state": "enabled", "reason": None, "systemSettings": False}, "settings show the sign-in entry")
    app.shell_invoke("host.preferences.set", {"name": "startAtLogin", "value": False})
    check(not autostart.exists() and hostsettings.read_preferences(data)[0]["startAtLogin"] is False, "turning sign-in off removes the entry")
    app.shell_invoke("host.preferences.set", {"name": "closeToTray", "value": False})
    check(app.window_close() is True and app.closing, "close saves and quits when keeping in the tray is off")
    app.closing = False
    app.shell_invoke("host.window.resetPlacement", {})
    spin(lambda: app.window.get_size() == (1180, 800), message="reset applies the default size")
    check(hostsettings.read_placement(data) is None, "reset removes the saved bounds")
    app.window.move(200, 150)
    app.window.resize(1000, 700)
    spin(lambda: hostsettings.read_placement(data) == {"x": 200, "y": 150, "width": 1000, "height": 700, "maximized": False}, message="bounds saved for the next launch")
    labels = lambda: [item.get_label() for item, _key in app.tray.items]
    check(app.describe_language()["preference"] == "auto" and app.describe_language()["system"][0] == "en" and labels()[0] == "Open Work Fleet",
          "the tray starts in the system's English")
    answer = app.shell_invoke("host.language.set", {"preference": "zh-TW"})
    check(answer["preference"] == "zh-TW" and hostsettings.read_preferences(data)[0]["language"] == "zh-TW", "the display language is stored")
    check(labels()[0] == text.ZH_TW["tray.open"] and app.shell_invoke("update.state", {})["reason"] == text.ZH_TW["update.debOnly"],
          "the tray menu and host reasons switch to Traditional Chinese at once")
    # Later modes start with the preference stored as English.
    app.shell_invoke("host.language.set", {"preference": "en"})
    check(labels()[0] == "Open Work Fleet" and hostsettings.read_preferences(data)[0]["language"] == "en", "and back to English")
    app.shutdown(app)
elif MODE == "restore":
    app.activate(app)
    spin(lambda: app.window.get_mapped(), message="main window mapped")
    settle(0.5)
    check(app.window.get_position() == (200, 150) and app.window.get_size() == (1000, 700), f"reopened at saved bounds {app.window.get_position()} {app.window.get_size()}")
    check(not autostart.exists(), "a later launch does not re-create a removed sign-in entry")
    app.shutdown(app)
elif MODE == "wayland":
    # labwc places windows itself: only the size and maximized state are kept, and nothing is moved.
    app.activate(app)
    spin(lambda: app.window.get_mapped(), message="main window mapped")
    settle(0.5)
    check(not app.x11, "running on Wayland")
    app.window.resize(900, 640)
    spin(lambda: hostsettings.read_placement(data) == {"x": None, "y": None, "width": 900, "height": 640, "maximized": False}, message=f"size saved without a position: {hostsettings.read_placement(data)}")
    check(True, "size saved without a position")
    app.window.maximize()
    spin(lambda: (hostsettings.read_placement(data) or {}).get("maximized") is True, message="maximized flag saved")
    check(hostsettings.read_placement(data)["width"] == 900, "maximized keeps the restore size")
    app.window.unmaximize()
    spin(lambda: hostsettings.read_placement(data) == {"x": None, "y": None, "width": 900, "height": 640, "maximized": False}, message="unmaximize clears the flag")
    check(True, "unmaximize clears the flag")
    app.shutdown(app)
elif MODE == "wayland-restore":
    app.activate(app)
    spin(lambda: app.window.get_mapped(), message="main window mapped")
    settle(0.5)
    check(app.window.get_size() == (900, 640), f"reopened at the saved size {app.window.get_size()}")
    app.shutdown(app)
elif MODE == "hidden":
    app.activate(app)
    settle(1.5)
    check(not app.window.get_visible() and app.window.get_realized(), "a sign-in start stays hidden while the page loads")
    # This session has no tray, so the hidden window must appear after the bounded wait.
    spin(lambda: app.window.get_visible(), seconds=8, message="no tray: the hidden window shows after the wait")
    check(True, "no tray: the hidden window shows after the wait")
    app.window.hide()
    app.activate(app)
    spin(lambda: app.window.get_visible(), message="launching again shows the running window")
    check(True, "launching again shows the running window")
    app.shutdown(app)
elif MODE == "hidden-tray":
    app.activate(app)
    check(app.tray.indicator is not None, "the StatusNotifier tray is in use")
    # The panel starts after Work Fleet, as at a real sign-in: the indicator first reports that no watcher is there.
    settle(1)
    check(not app.window.get_visible(), "a tray that is not there yet does not show the hidden window")
    ownership = own_watcher()
    spin(lambda: app.tray.available, message="the tray connects once the panel's watcher appears")
    titles = []
    bus = Gio.bus_get_sync(Gio.BusType.SESSION)
    destination = app.tray.indicator.bus.get_unique_name()
    bus.call(destination, "/StatusNotifierItem", "org.freedesktop.DBus.Properties", "Get",
             GLib.Variant("(ss)", ("org.kde.StatusNotifierItem", "Title")), GLib.VariantType("(v)"), Gio.DBusCallFlags.NONE, -1, None,
             lambda source, result: titles.append(source.call_finish(result).unpack()[0]))
    spin(lambda: titles, message="the tray item answers for its title")
    check(titles == ["Work Fleet"], f"the tray shows the product name on hover, not the program name ({titles})")
    def call(path, interface, method, args=None):
        results = []
        def finished(source, result):
            try:
                results.append(source.call_finish(result).unpack())
            except GLib.Error as error:
                results.append(error)
        bus.call(destination, path, interface, method, args, None, Gio.DBusCallFlags.NONE, 5000, None, finished)
        spin(lambda: results, message=f"tray method {method} answered")
        if isinstance(results[0], Exception):
            raise results[0]
        return results[0]

    check(call("/StatusNotifierItem", "org.freedesktop.DBus.Properties", "Get",
               GLib.Variant("(ss)", ("org.kde.StatusNotifierItem", "ItemIsMenu"))) == (False,), "left click is an action, not a menu request")
    revision, layout = call("/TrayMenu", "com.canonical.dbusmenu", "GetLayout", GLib.Variant("(iias)", (0, -1, [])))
    check(layout[2][0][1]["label"] == "Open Work Fleet", "the exported menu starts with Open Work Fleet")
    check(layout[2][-2][1]["type"] == "separator", "the exported menu keeps its separator")
    check(call("/TrayMenu", "com.canonical.dbusmenu", "GetProperty", GLib.Variant("(is)", (1, "label"))) == ("Open Work Fleet",),
          "the exported menu answers individual properties")
    subset = call("/TrayMenu", "com.canonical.dbusmenu", "GetGroupProperties", GLib.Variant("(aias)", ([1], ["label"])))[0]
    check(subset == [(1, {"label": "Open Work Fleet"})], "the exported menu filters group properties")
    call("/TrayMenu", "com.canonical.dbusmenu", "AboutToShow", GLib.Variant("(i)", (0,)))
    check(app.tray_menu and not app.window.get_visible(), "opening the tray menu holds shortcuts and keeps the main window hidden")
    call("/TrayMenu", "com.canonical.dbusmenu", "Event", GLib.Variant("(isvu)", (0, "closed", GLib.Variant("i", 0), 0)))
    check(not app.tray_menu, "dismissing the exported menu releases shortcuts")
    call("/StatusNotifierItem", "org.kde.StatusNotifierItem", "ContextMenu", GLib.Variant("(ii)", (10, 20)))
    spin(lambda: app.tray.menu.get_visible(), message="context activation opens the native menu")
    check(not app.window.get_visible(), "context activation leaves the main window hidden")
    app.tray.menu.popdown()
    spin(lambda: not app.tray_menu, message="the native menu releases shortcuts on dismissal")
    call("/StatusNotifierItem", "org.kde.StatusNotifierItem", "Activate", GLib.Variant("(ii)", (10, 20)))
    spin(lambda: app.window.get_visible(), message="left click opens the main window")
    check(not app.tray_menu, "left click opens the main window without a menu")
    app.window.hide()
    call("/TrayMenu", "com.canonical.dbusmenu", "Event", GLib.Variant("(isvu)", (1, "clicked", GLib.Variant("i", 0), 0)))
    spin(lambda: app.window.get_visible(), message="Open Work Fleet in the exported menu opens the main window")
    app.window.hide()
    text.set_locale("zh-TW"); app.tray.relabel()
    translated_revision, translated = call("/TrayMenu", "com.canonical.dbusmenu", "GetLayout", GLib.Variant("(iias)", (0, -1, [])))
    check(translated_revision > revision and translated[2][0][1]["label"] == text.ZH_TW["tray.open"], "the exported menu follows a language change")
    text.set_locale("en"); app.tray.relabel()
    # timeout_add_seconds may fire up to a second late, so this settles past the latest moment the wait can end.
    settle(WAIT + 1.5 - 1)
    check(not app.window.get_visible(), "the tray connected within the wait, so the window stays hidden after it")
    Gio.bus_unown_name(ownership)
    spin(lambda: app.window.get_visible(), message="losing the tray shows the hidden window")
    check(True, "losing the tray shows the hidden window")
    ownership = Gio.bus_own_name_on_connection(bus, "org.kde.StatusNotifierWatcher", Gio.BusNameOwnerFlags.NONE, None, None)
    spin(lambda: app.tray.available, message="the tray reconnects when the panel returns")
    check(app.window.get_visible(), "reconnecting a tray does not hide an open window")
    app.window.hide()
    bus.emit_signal(None, "/StatusNotifierWatcher", "org.kde.StatusNotifierWatcher", "StatusNotifierHostUnregistered", None)
    spin(lambda: not app.tray.available and app.window.get_visible(), message="losing the panel host while its watcher stays also restores the window")
    bus.emit_signal(None, "/StatusNotifierWatcher", "org.kde.StatusNotifierWatcher", "StatusNotifierHostRegistered", None)
    spin(lambda: app.tray.available, message="a returning panel host restores tray availability")
    # The data folder, and so host.log, is shared with the earlier X11 modes; only this run's entries count.
    log = (data / "host.log").read_text("utf-8").rsplit(" start version=", 1)[-1]
    check("launchedAtLogin=True hidden=True" in log and " tray available=False uptime=" in log and " tray available=True uptime=" in log,
          "host.log records the sign-in start and when the tray came and went")
    app.shutdown(app)
    check(app.tray.indicator.bus.is_closed(), "closing the tray disconnects its dedicated notifier bus")
    app.tray.indicator.close()
    Gio.bus_unown_name(ownership)
elif MODE == "actions":
    # The named actions a sway or wayfire keybinding runs, called over D-Bus the way gapplication action calls them.
    app.activate(app)
    spin(lambda: app.window.get_mapped(), message="main window mapped")
    check(set(hostsettings.NAMED_ACTIONS) | {"quit"} <= set(app.list_actions()), "every named action and quit is exported")
    bus = Gio.bus_get_sync(Gio.BusType.SESSION)

    def run(name):
        answered = []
        bus.call("app.workfleet.hostprobe", "/app/workfleet/hostprobe", "org.gtk.Actions", "Activate", GLib.Variant("(sava{sv})", (name, [], {})),
                 None, Gio.DBusCallFlags.NONE, -1, None, lambda source, result: answered.append(source.call_finish(result)))
        spin(lambda: answered, message=f"{name} answered over D-Bus")
    app.window.hide()
    run("show-main")
    spin(lambda: app.window.get_visible(), message="show-main shows the hidden main window")
    check(True, "show-main shows the hidden main window")
    routed = []
    app.tray_action = lambda target, _timestamp, _token: routed.append(target)
    for name in ("quick-capture", "toggle-desktop", "adjust-all", "done-adjusting", "region-3"):
        run(name)
    check(routed == ["@capture", "@toggle", "@all", "@stop", "@region3"], f"named actions run like their tray items ({routed})")
    quitting = []
    app.close_requested = lambda *_: quitting.append(True)
    run("quit")
    check(quitting == [True], "quit saves and quits like the tray item")
    app.shutdown(app)
elif MODE == "data-failure":
    host.FleetApp.open_store = real_open_store
    data.mkdir(parents=True, exist_ok=True)
    os.chmod(data, 0o700)
    for stale in data.glob("fleet.sqlite3*"):
        stale.unlink()
    (data / "fleet.sqlite3").write_bytes(b"these bytes are not a SQLite database")
    key = data / "storage-key"
    key.write_bytes(os.urandom(32))
    os.chmod(key, 0o600)
    explained = []
    explain = host.FleetApp.data_failure
    host.FleetApp.data_failure = lambda self, cause, profile: (explained.append(cause), explain(self, cause, profile))
    app.activate(app)
    shown = lambda: [window for window in Gtk.Window.list_toplevels() if isinstance(window, Gtk.MessageDialog) and window.get_visible()]
    spin(lambda: explained and shown(), seconds=30, message="the damaged database explains itself")
    secondary = shown()[0].get_property("secondary-text")
    check(explained == ["data-damaged"] and text.EN["dataFailure.damaged"] in secondary and str(data) in secondary,
          f"the explanation names the cause and the folder ({explained}, {secondary!r})")
    shown()[0].response(2)
    spin(lambda: shown() and shown()[0].get_property("secondary-text") == text.EN["dataFailure.confirm"], message="the set-aside asks first")
    check(not list(data.glob("set-aside-*")), "nothing moves before the confirmation")
    shown()[0].response(Gtk.ResponseType.OK)
    spin(lambda: app.service is not None, seconds=30, message="empty data opens after the set-aside")
    folders = list(data.glob("set-aside-*"))
    check(len(folders) == 1 and (folders[0] / "fleet.sqlite3").read_bytes() == b"these bytes are not a SQLite database"
          and (folders[0] / "storage-key").read_bytes() != (data / "storage-key").read_bytes(),
          "the damaged database and its key moved into one set-aside folder, and the new data has its own key")
    app.shutdown(app)
else:
    raise SystemExit("unknown mode")
print("PASS Linux host", MODE)
