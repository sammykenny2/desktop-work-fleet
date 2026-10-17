"""ADR-043 on the real GTK owner in isolated X11 and labwc sessions: main window bounds, startup settings and a hidden sign-in start.

Usage: host_probe.py OUTPUT MODE, MODE one of place, restore, hidden, hidden-tray (X11) or wayland, wayland-restore (labwc). Each mode is its own
process so GApplication registers afresh; the data, bundle and XDG config folders live under OUTPUT. The workspace store is not opened.
hidden-tray needs the Ayatana AppIndicator typelib and a private session bus: it plays a panel whose StatusNotifierWatcher starts late."""
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
host.FleetApp.open_store = lambda self, profile, persist=False: None
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
    check(app.tray.indicator is not None, "the Ayatana AppIndicator tray is in use")
    # The panel starts after Work Fleet, as at a real sign-in: the indicator first reports that no watcher is there.
    settle(1)
    check(not app.window.get_visible(), "a tray that is not there yet does not show the hidden window")
    ownership = own_watcher()
    spin(lambda: app.tray.available, message="the tray connects once the panel's watcher appears")
    titles = []
    bus = Gio.bus_get_sync(Gio.BusType.SESSION)
    bus.call(bus.get_unique_name(), "/org/ayatana/NotificationItem/app_workfleet_hostprobe", "org.freedesktop.DBus.Properties", "Get",
             GLib.Variant("(ss)", ("org.kde.StatusNotifierItem", "Title")), GLib.VariantType("(v)"), Gio.DBusCallFlags.NONE, -1, None,
             lambda source, result: titles.append(source.call_finish(result).unpack()[0]))
    spin(lambda: titles, message="the tray item answers for its title")
    check(titles == ["Work Fleet"], f"the tray shows the product name on hover, not the program name ({titles})")
    # timeout_add_seconds may fire up to a second late, so this settles past the latest moment the wait can end.
    settle(WAIT + 1.5 - 1)
    check(not app.window.get_visible(), "the tray connected within the wait, so the window stays hidden after it")
    Gio.bus_unown_name(ownership)
    spin(lambda: app.window.get_visible(), message="losing the tray shows the hidden window")
    check(True, "losing the tray shows the hidden window")
    # The data folder, and so host.log, is shared with the earlier X11 modes; only this run's entries count.
    log = (data / "host.log").read_text("utf-8").rsplit(" start version=", 1)[-1]
    check("launchedAtLogin=True hidden=True" in log and " tray available=False uptime=" in log and " tray available=True uptime=" in log,
          "host.log records the sign-in start and when the tray came and went")
    app.shutdown(app)
else:
    raise SystemExit("unknown mode")
print("PASS Linux host", MODE)
