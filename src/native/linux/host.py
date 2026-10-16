#!/usr/bin/env python3
"""Native GTK owner. Usage: python3 host.py --assets PATH --config PATH [--data PATH]."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import mimetypes
import os
from pathlib import Path
import secrets
import sys
import tempfile
import threading
import time
from urllib.parse import unquote, urlsplit

# host.log measures sign-in timings from here, before the slow GTK and WebKit imports.
STARTED = time.monotonic()

import hostsettings
import renderer
import updater as updates
import xwayland

# The Pi keeps WebKit's DMA-BUF renderer on shared-memory buffers; an explicit user setting wins. This must happen
# before importing WebKit.
renderer.configure(os.environ)
# GNOME Wayland shows desktop papers only through XWayland, when the user chose it; GDK reads this at import.
xwayland.configure(os.environ, xwayland.data_directory(sys.argv[1:], os.environ))

import gi
gi.require_version("Gdk", "3.0")
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, Gio, GLib, Gtk, WebKit2

from database import Database, Vault
from service import Service
from attachments import AttachmentFiles
from desktop import Desktop
from surface import backend
from tray import Tray
import protocol as p

ORIGIN = "workfleet://app"
DOCUMENT = ORIGIN + "/app/index.html"


class LocalWeb:
    def __init__(self, assets, document, receive, failed):
        self.assets, self.document, self.receive = assets, document, receive
        self.key = secrets.token_urlsafe(32)
        context = WebKit2.WebContext.new_ephemeral()
        security = context.get_security_manager()
        security.register_uri_scheme_as_secure("workfleet")
        security.register_uri_scheme_as_cors_enabled("workfleet")
        context.register_uri_scheme("workfleet", self.resource)
        self.context = context
        self.manager = WebKit2.UserContentManager()
        self.manager.register_script_message_handler("workFleetNative")
        self.manager.connect("script-message-received::workFleetNative", self.message)
        script = "(() => { const key=" + p.encode(self.key).decode() + "; const channel=globalThis.webkit.messageHandlers.workFleetNative; Object.defineProperty(globalThis,'workFleet',{value:{postMessage(text){channel.postMessage({key,value:JSON.parse(text)});}},writable:false,configurable:false}); })();"
        self.manager.add_script(WebKit2.UserScript.new(script, WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
        self.web = WebKit2.WebView(web_context=context, user_content_manager=self.manager)
        settings = self.web.get_settings()
        settings.set_enable_developer_extras(False)
        settings.set_javascript_can_open_windows_automatically(False)
        settings.set_enable_html5_database(False)
        settings.set_enable_html5_local_storage(False)
        self.web.connect("decide-policy", self.policy)
        self.web.connect("permission-request", lambda _web, request: (request.deny(), True)[1])
        self.web.connect("web-process-terminated", lambda *_: failed())
        self.closed = False

    def resource(self, request):
        uri = urlsplit(request.get_uri())
        data, media = b"Resource unavailable", "text/plain"
        try:
            path = unquote(uri.path)
            p.require(uri.scheme == "workfleet" and uri.netloc == "app" and not uri.query and not uri.fragment and request.get_http_method() == "GET" and ".." not in Path(path).parts and "\\" not in path, "native-assets", "封裝資產位置無效。")
            file = (self.assets / path.lstrip("/")).resolve(strict=True)
            file.relative_to(self.assets)
            p.require(file.is_file() and file.stat().st_size <= 16 * 1024 * 1024, "native-assets", "封裝資產容量無效。")
            data = file.read_bytes()
            media = "text/javascript" if file.suffix == ".js" else mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        except (OSError, ValueError, p.Failure):
            pass
        stream = Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(data))
        request.finish(stream, len(data), media)

    def message(self, _manager, result):
        if self.closed or self.web.get_uri() != self.document:
            return
        try:
            raw = result.get_js_value().to_json(0)
            p.require(len(raw.encode("utf-8")) <= 1024 * 1024 + 256, "message-size", "原生訊息容量超限。")
            value = p.decode(raw)
            p.require(value.get("key") == self.key and isinstance(value.get("value"), dict), "invalid-request", "訊息來源無效。")
            self.receive(value["value"])
        except Exception:
            pass

    def post(self, value):
        if not self.closed and self.web.get_uri() == self.document:
            self.web.evaluate_javascript("globalThis.workFleet?.onmessage?.({data:" + p.encode(value).decode("ascii") + "});", -1, None, None, None, None, None)

    def event(self, name, **values):
        self.post({"v": 1, "event": name, **values})

    def policy(self, _web, decision, kind):
        if kind in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION, WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            action = decision.get_navigation_action()
            uri = action.get_request().get_uri()
            if kind == WebKit2.PolicyDecisionType.NAVIGATION_ACTION and uri == self.document:
                return False
            if action.is_user_gesture() and urlsplit(uri).scheme in ("http", "https"):
                Gio.AppInfo.launch_default_for_uri(uri, None)
            decision.ignore()
            return True
        return False

    def load(self, callback):
        # Block all network subresources before the first document starts.
        folder = Path(GLib.get_user_cache_dir()) / "WorkFleet" / "filters"
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.filters = WebKit2.UserContentFilterStore.new(str(folder))
        rules = GLib.Bytes.new(b'[{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}}]')

        def saved(store, result, *_):
            try:
                self.manager.add_filter(store.save_finish(result))
                if not self.closed:
                    self.web.load_uri(self.document)
                    callback(None)
            except Exception as error:
                callback(error)
        self.filters.save("local-assets-v1", rules, None, saved, None)

    def close(self):
        self.closed = True
        self.manager.unregister_script_message_handler("workFleetNative")
        self.web.stop_loading()


class FleetApp(Gtk.Application):
    def __init__(self, assets, config, directory, launched_at_login=False, default_data=None):
        self.assets, self.config, self.directory = assets, config, directory
        self.default_data = default_data or directory
        # ADR-043: startup behaviour and the main window's bounds belong to this data directory, not to a profile.
        self.preferences, existed = hostsettings.read_preferences(directory)
        self.first_run = not existed
        self.hidden_start = launched_at_login and not self.preferences["openMainAtLogin"]
        # A hidden sign-in start waits this long for the tray before showing the main window: the panel that hosts the tray can
        # start in the same second as Work Fleet, as wf-panel-pi does on Raspberry Pi OS, and register its watcher later (ADR-043).
        self.tray_wait = hostsettings.tray_wait(config)
        self.placement = hostsettings.read_placement(directory)
        self.placement_dirty = self.tracking = self.pending_maximize = False
        self.placement_timer = None
        self.x11 = False
        super().__init__(application_id=config.get("appId") or "app.workfleet.preview", flags=Gio.ApplicationFlags.FLAGS_NONE)
        self.connect("activate", self.activate)
        self.connect("shutdown", self.shutdown)
        # labwc keybinds written from the shortcut settings run `gapplication action <app id> shortcut "'<key>'"`.
        shortcut = Gio.SimpleAction.new("shortcut", GLib.VariantType.new("s"))
        shortcut.connect("activate", lambda _action, value: self.desktop.shortcut(value.get_string()) if self.desktop is not None else None)
        self.add_action(shortcut)
        self.window = self.view = self.service = None
        self.desktop = self.tray = self.display = None
        self.restart = False
        self.native_dialogs = 0
        self.tray_menu = False
        self.storage = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fleet-storage")
        self.network = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fleet-google")
        self.previews = ThreadPoolExecutor(max_workers=2, thread_name_prefix="fleet-preview")
        self.epoch = self.admitted = 0
        self.closing = self.stopped = False
        self.vault = Vault(config.get("appId") or "app.workfleet.preview")
        self.launched_at_login = launched_at_login
        # ADR-044: checks and downloads run on a worker thread; their state reaches the page through the main loop.
        self.updater = updates.Updater(directory, config, hostsettings.version(assets, __file__), hostsettings.distribution(assets),
                                       lambda state: GLib.idle_add(self.publish_update, state), self.record_update_check,
                                       self.preferences.get("lastUpdateCheck"))

    def activate(self, _application):
        if self.window is not None:
            # Launching Work Fleet again shows the running one, including after a hidden sign-in start.
            self.show_main()
            return
        self.window = Gtk.ApplicationWindow(application=self, title="Work Fleet")
        icon = self.assets.parent / "Icons" / ((self.config.get("appId") or "app.workfleet.preview") + ".png")
        if icon.is_file():
            self.window.set_icon_from_file(str(icon))
        self.x11 = "x11" in type(Gdk.Display.get_default()).__name__.lower()
        self.window.set_default_size(1180, 800)
        self.apply_placement()
        self.window.connect("delete-event", self.window_close)
        self.window.connect("configure-event", lambda *_: self.window_changed())
        self.window.connect("window-state-event", lambda _window, event: self.window_changed(event.new_window_state))
        self.window.add(Gtk.Label(label="正在開啟安全工作空間…"))
        self.reveal()
        self.log(f"start version={hostsettings.version(self.assets, __file__)} distribution={hostsettings.distribution(self.assets)} "
                 f"pid={os.getpid()} launchedAtLogin={self.launched_at_login} hidden={self.hidden_start}")
        # How long the tray takes at sign-in is the evidence for trayWaitSeconds in config/startup.json.
        self.tray = Tray(self.config.get("appId") or "app.workfleet.preview", self.window, self.tray_action, self.close_requested, self.menu_active,
                         icon if icon.is_file() else None, reveal=lambda: self.show_main(activate=False),
                         update=self.tray_update if self.updater.capable else None,
                         changed=lambda available: self.log(f"tray available={available} uptime={self.uptime()}"))
        self.log(f"tray available={self.tray.available} uptime={self.uptime()}")
        if self.hidden_start:
            # A tray that never connects would leave the hidden window unreachable, so it shows after the wait.
            GLib.timeout_add_seconds(self.tray_wait, self.hidden_fallback)
        if self.first_run:
            self.first_preferences()
        marker = self.directory / "profile.txt"
        try:
            profile = marker.read_text("utf-8").strip()
        except FileNotFoundError:
            profile = "local"
        if not (profile == "local" or profile.startswith("google:") and p.is_account(profile[7:])):
            profile = "local"
        current = "x11" if "x11" in type(Gdk.Display.get_default()).__name__.lower() else "wayland"
        self.display = xwayland.DisplayChoice(self.directory, os.environ, current)
        # Asked before any data opens, so choosing XWayland can start again at once without closing anything.
        if self.display.ask() and backend() is None:
            self.ask_display(profile)
        else:
            self.open_store(profile)

    def reveal(self):
        """Shows the main window, or on a hidden sign-in start only realizes it so the page still loads."""
        if self.hidden_start:
            child = self.window.get_child()
            if child is not None:
                child.show_all()
            self.window.realize()
            return
        self.window.show_all()
        self.take_maximize()

    def take_maximize(self):
        if self.pending_maximize:
            self.pending_maximize = False
            self.window.maximize()

    def hidden_fallback(self):
        if self.hidden_start and (self.tray is None or not self.tray.available):
            self.log(f"no tray within {self.tray_wait}s; showing the main window")
            self.show_main(activate=False)
        return False

    def log(self, text):
        hostsettings.append_log(self.directory, text)

    @staticmethod
    def uptime():
        return f"{time.monotonic() - STARTED:.1f}s"

    def show_main(self, timestamp=None, activate=True):
        if self.window is None:
            return
        if self.hidden_start or not self.window.get_visible():
            self.hidden_start = False
            self.validate_placement()
            if not activate:
                self.window.set_focus_on_map(False)
            self.window.show_all()
            self.window.set_focus_on_map(True)
            self.take_maximize()
        if activate:
            self.window.present_with_time(timestamp or Gdk.CURRENT_TIME)

    def work_areas(self):
        display = Gdk.Display.get_default()
        monitors = [display.get_monitor(index) for index in range(display.get_n_monitors())]
        primary = display.get_primary_monitor() or (monitors[0] if monitors else None)
        ordered = [primary] + [monitor for monitor in monitors if monitor is not primary] if primary is not None else monitors
        areas = []
        for monitor in ordered:
            area = monitor.get_workarea()
            areas.append({"x": area.x, "y": area.y, "width": area.width, "height": area.height})
        return areas or [{"x": 0, "y": 0, "width": 1180, "height": 800}]

    def apply_placement(self):
        """Saved bounds before the window maps; Wayland compositors place windows themselves, so only size counts there."""
        saved = self.placement
        if saved is not None and not self.x11:
            saved = {**saved, "x": None, "y": None}
        resolved = hostsettings.resolve(saved, self.work_areas(), 1180, 800)
        self.window.set_default_size(resolved["width"], resolved["height"])
        self.window.resize(resolved["width"], resolved["height"])
        if self.x11 and resolved["x"] is not None:
            self.window.move(resolved["x"], resolved["y"])
        self.pending_maximize = resolved["maximized"]
        self.placement = resolved if self.x11 else {**resolved, "x": None, "y": None}
        self.tracking = True

    def validate_placement(self):
        """A hidden window waits in the tray for days; a display may be gone when it shows again."""
        if not self.x11 or self.window.is_maximized() or not self.window.get_realized():
            return
        x, y = self.window.get_position()
        width, height = self.window.get_size()
        current = {"x": x, "y": y, "width": width, "height": height, "maximized": False}
        resolved = hostsettings.resolve(current, self.work_areas(), 1180, 800)
        if resolved != current:
            self.window.resize(resolved["width"], resolved["height"])
            self.window.move(resolved["x"], resolved["y"])

    def window_changed(self, state=None):
        if not self.tracking or self.window is None or not self.window.get_visible():
            return False
        if state is None:
            gdk = self.window.get_window()
            state = gdk.get_state() if gdk is not None else Gdk.WindowState(0)
        # A minimize, including the adjust overlay stepping aside, never changes the saved bounds or maximized flag.
        if state & (Gdk.WindowState.ICONIFIED | Gdk.WindowState.WITHDRAWN | Gdk.WindowState.FULLSCREEN):
            return False
        if state & Gdk.WindowState.MAXIMIZED:
            if self.placement is not None and not self.placement["maximized"]:
                self.placement = {**self.placement, "maximized": True}
                self.schedule_placement()
            return False
        width, height = self.window.get_size()
        x, y = self.window.get_position() if self.x11 else (None, None)
        current = {"x": x, "y": y, "width": width, "height": height, "maximized": False}
        if current != self.placement:
            self.placement = current
            self.schedule_placement()
        return False

    def schedule_placement(self):
        self.placement_dirty = True
        if self.placement_timer is not None:
            GLib.source_remove(self.placement_timer)
        self.placement_timer = GLib.timeout_add(500, self.flush_placement)

    def flush_placement(self):
        if self.placement_timer is not None:
            GLib.source_remove(self.placement_timer)
            self.placement_timer = None
        if self.placement_dirty and self.placement is not None:
            try:
                hostsettings.write_placement(self.directory, self.placement)
                self.placement_dirty = False
            except OSError:
                pass
        return False

    def reset_placement(self):
        if self.placement_timer is not None:
            GLib.source_remove(self.placement_timer)
            self.placement_timer = None
        self.placement_dirty = False
        try:
            hostsettings.remove_placement(self.directory)
        except OSError as error:
            raise p.Failure("placement-reset", "無法清除主視窗位置，請稍後重試。") from error
        self.placement = None
        if self.window.is_maximized():
            self.window.unmaximize()
        self.apply_placement()
        self.pending_maximize = False

    def hide_to_tray(self):
        if self.tray is None:
            return False
        self.flush_placement()
        return self.tray.hide()

    def startup_command(self):
        return hostsettings.launch_command(self.assets, self.directory, self.default_data)

    def first_preferences(self):
        """A first launch applies the sign-in default once; later launches never re-create an entry the user removed."""
        try:
            command, _reason = self.startup_command()
            path = hostsettings.autostart_path(os.environ)
            if self.preferences["startAtLogin"] and command is not None and not path.exists():
                hostsettings.write_autostart(path, command, self.config.get("appId") or "app.workfleet.preview")
            hostsettings.write_preferences(self.directory, self.preferences)
        except OSError:
            pass

    def describe_preferences(self):
        command, reason = self.startup_command()
        if command is None:
            start = {"available": False, "enabled": False, "preference": self.preferences["startAtLogin"], "state": "unavailable", "reason": reason, "systemSettings": False}
        else:
            state = hostsettings.autostart_state(hostsettings.autostart_path(os.environ))
            start = {"available": True, "enabled": state == "enabled", "preference": self.preferences["startAtLogin"], "state": state, "reason": None, "systemSettings": False}
        return {"startAtLogin": start,
                "closeToTray": {"available": self.tray is not None and self.tray.available, "enabled": self.preferences["closeToTray"]},
                "openMainAtLogin": {"available": command is not None, "enabled": self.preferences["openMainAtLogin"]},
                "launchedAtLogin": self.launched_at_login}

    def shell_invoke(self, method, args):
        if method == "host.preferences.get":
            return self.describe_preferences()
        if method == "host.preferences.set":
            name, value = p.text(args, "name", 32), p.boolean(args, "value")
            p.require(name in hostsettings.DEFAULTS, "invalid-request", "沒有這個啟動行為設定。")
            if name == "startAtLogin":
                path = hostsettings.autostart_path(os.environ)
                try:
                    if value:
                        command, reason = self.startup_command()
                        p.require(command is not None, "startup-unavailable", reason or "這台電腦目前不支援登入時啟動。")
                        hostsettings.write_autostart(path, command, self.config.get("appId") or "app.workfleet.preview")
                    else:
                        hostsettings.remove_autostart(path)
                except PermissionError as error:
                    raise p.Failure("startup-foreign", "這個登入啟動項目不是 Work Fleet 建立的，請在系統設定中移除。") from error
                except OSError as error:
                    raise p.Failure("startup-write", "無法更新登入啟動項目，請稍後重試。") from error
            changed = hostsettings.change(self.preferences, name, value)
            try:
                hostsettings.write_preferences(self.directory, changed)
            except OSError as error:
                raise p.Failure("preferences-write", "無法保存啟動行為設定，請稍後重試。") from error
            self.preferences = changed
            return self.describe_preferences()
        if method == "host.preferences.openSystem":
            raise p.Failure("startup-settings", "這個桌面環境沒有可開啟的登入項目設定。")
        if method == "update.state":
            return self.updater.snapshot()
        if method == "update.check":
            self.updater.check()
            return self.updater.snapshot()
        if method == "update.download":
            self.updater.download()
            return self.updater.snapshot()
        if method == "update.install":
            self.begin_install()
            return self.updater.snapshot()
        if method == "host.window.resetPlacement":
            self.reset_placement()
            return None
        raise p.Failure("unsupported-method", "原生主機沒有此操作。")

    def record_update_check(self, time):
        changed = {**self.preferences, "lastUpdateCheck": time}
        try:
            hostsettings.write_preferences(self.directory, changed)
            self.preferences = changed
        except OSError:
            pass

    def publish_update(self, state):
        if self.view is not None and not self.stopped:
            self.view.event("update-state", state=state)
        return False

    def begin_install(self):
        """pkexec installs the verified DEB while Work Fleet runs; on success the usual close saves drafts and restarts it."""
        p.require(self.updater.status == "downloaded" and not self.closing, "update-not-ready", "還沒有下載好的更新。")
        self.updater.install(lambda ok: GLib.idle_add(self.installed, ok))

    def installed(self, ok):
        if ok and not self.closing:
            self.restart = True
            self.close_requested()
        elif not ok and self.updater.error is not None:
            self.message(Gtk.MessageType.WARNING, str(self.updater.error))
        return False

    def message(self, kind, text, question=False, answer=None):
        dialog = Gtk.MessageDialog(transient_for=self.window if self.window is not None and self.window.get_visible() else None, modal=True,
                                   message_type=kind, buttons=Gtk.ButtonsType.YES_NO if question else Gtk.ButtonsType.CLOSE, text="Work Fleet 更新")
        dialog.format_secondary_text(text)
        self.dialog_opened()

        def responded(dialog, response):
            dialog.destroy()
            self.dialog_closed()
            if answer is not None:
                answer(response == Gtk.ResponseType.YES)
        dialog.connect("response", responded)
        dialog.show()

    def tray_update(self):
        """The tray asks once: a fresh check, then a native answer; updating saves and restarts like the settings page."""
        self.updater.check(done=lambda: GLib.idle_add(self.tray_checked))

    def tray_checked(self):
        status, current = self.updater.status, self.updater.current_text
        if status in ("update_available", "downloaded"):
            pending = self.updater.pending
            text = f"有新版本 {pending['version']}（目前 {current}）。" + (f"\n\n{pending['summary']}" if pending["summary"] else "") \
                + "\n\n要現在更新並重新啟動 Work Fleet 嗎？安裝需要系統密碼，未保存的文字會先保存。"
            self.message(Gtk.MessageType.QUESTION, text, True, lambda yes: yes and self.tray_download())
        elif status == "up_to_date":
            self.message(Gtk.MessageType.INFO, f"Work Fleet {current} 已是最新版本。")
        else:
            self.message(Gtk.MessageType.WARNING, str(self.updater.error) if self.updater.error else "更新沒有完成，請稍後再試。")
        return False

    def tray_download(self):
        if self.updater.status == "downloaded":
            self.begin_install()
            return
        self.updater.download(done=lambda: GLib.idle_add(self.tray_downloaded))

    def tray_downloaded(self):
        if self.updater.status == "downloaded":
            try:
                self.begin_install()
            except p.Failure as error:
                self.message(Gtk.MessageType.WARNING, str(error))
        else:
            self.message(Gtk.MessageType.WARNING, str(self.updater.error) if self.updater.error else "更新沒有完成，請稍後再試。")
        return False

    def ask_display(self, profile):
        dialog = Gtk.MessageDialog(transient_for=self.window, modal=True, message_type=Gtk.MessageType.QUESTION,
                                   buttons=Gtk.ButtonsType.NONE, text="要改用 XWayland 顯示桌面便箋嗎？")
        dialog.format_secondary_text("GNOME Wayland 沒有 Work Fleet 需要的桌面圖層，桌面便箋要經 XWayland 才能顯示；"
                                     "改用後主畫面的輸入法與縮放也會改走 XWayland。之後可在設定的「桌面」頁變更。")
        dialog.add_buttons("維持目前方式", Gtk.ResponseType.REJECT, "改用 XWayland 重新啟動", Gtk.ResponseType.ACCEPT)
        dialog.set_default_response(Gtk.ResponseType.ACCEPT)
        self.dialog_opened()

        def answered(dialog, response):
            dialog.destroy()
            self.dialog_closed()
            xwayland_chosen = response == Gtk.ResponseType.ACCEPT
            # Closing the dialog without an answer keeps this run as it is and asks again next time.
            if response in (Gtk.ResponseType.ACCEPT, Gtk.ResponseType.REJECT):
                try:
                    self.display.choose(xwayland_chosen)
                except OSError:
                    xwayland_chosen = False
            if xwayland_chosen:
                self.restart = True
                self.quit()
            else:
                self.open_store(profile)
        dialog.connect("response", answered)
        dialog.show()

    def menu_active(self, active):
        self.tray_menu = active
        self.update_native_block()

    def update_native_block(self):
        if self.desktop is not None:
            self.desktop.menu_active(self.tray_menu or self.native_dialogs > 0)

    def dialog_opened(self):
        self.native_dialogs += 1
        self.update_native_block()

    def dialog_closed(self):
        self.native_dialogs = max(0, self.native_dialogs - 1)
        self.update_native_block()

    def tray_action(self, target, timestamp, token):
        if target == "show":
            self.show_main(timestamp)
            return
        if target == "@capture" or self.desktop is None:
            self.show_main(timestamp)
        if self.desktop is not None:
            self.desktop.action(target, timestamp, token)

    def close_desktop(self):
        desktop, self.desktop = self.desktop, None
        if desktop is not None:
            desktop.close()

    def ui(self, work):
        done, result = threading.Event(), {}

        def invoke():
            try:
                p.require(not self.stopped, "native-closed", "原生工作階段已結束。")
                result["value"] = work()
            except Exception as error:
                result["error"] = error
            finally:
                done.set()
            return False
        GLib.idle_add(invoke)
        p.require(done.wait(110), "native-unavailable", "原生介面未回應，請保留資料後重試。")
        if "error" in result:
            raise result["error"]
        return result.get("value")

    def choose_directory(self):
        done, result = threading.Event(), {}

        def show():
            if done.is_set() or self.stopped:
                return False
            picker = Gtk.FileChooserNative.new("選擇備份資料夾", self.window, Gtk.FileChooserAction.SELECT_FOLDER, "選擇", "取消")
            result["picker"] = picker
            self.dialog_opened()

            def response(dialog, code):
                if done.is_set():
                    return
                result["path"] = dialog.get_filename() if code == Gtk.ResponseType.ACCEPT else None
                dialog.destroy()
                self.dialog_closed()
                done.set()
            picker.connect("response", response)
            picker.show()
            return False
        GLib.idle_add(show)
        if not done.wait(110):
            done.set()
            def cancel():
                if result.get("picker") is not None:
                    result["picker"].destroy()
                    self.dialog_closed()
                return False
            GLib.idle_add(cancel)
            raise p.Failure("backup-cancelled", "選擇備份位置逾時，請重試。")
        return result.get("path")

    def open_store(self, profile, persist=False):
        current = self.epoch

        def open_native():
            old = self.service
            if old is not None:
                old.close()
            database = Database(self.directory, profile, self.vault)
            try:
                service = Service(database, self.vault, self.config, self.choose_directory, lambda uri: self.ui(lambda: Gio.AppInfo.launch_default_for_uri(uri, None)))
                service.attachment_files = AttachmentFiles(ui=self.ui)
                if persist:
                    with tempfile.NamedTemporaryFile(dir=self.directory, prefix="profile-", delete=False) as stream:
                        filename = stream.name
                        stream.write(profile.encode("utf-8"))
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.replace(filename, self.directory / "profile.txt")
                    descriptor = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
                    try:
                        os.fsync(descriptor)
                    finally:
                        os.close(descriptor)
                return service
            except Exception:
                database.close()
                raise

        future = self.storage.submit(open_native)

        def ready():
            if current != self.epoch or self.stopped:
                if not future.exception():
                    self.storage.submit(future.result().close)
                return False
            try:
                self.service = future.result()
                self.service.display = self.display
                self.service.identity = {"appVersion": hostsettings.version(self.assets, __file__), "distribution": hostsettings.distribution(self.assets)}
                self.service.shell = lambda method, args: self.ui(lambda: self.shell_invoke(method, args))
                self.service.updates = self.updater.capable
                self.close_desktop()
                if self.view is not None:
                    self.view.close()
                self.view = LocalWeb(self.assets, DOCUMENT, self.receive, self.process_failed)
                self.view.context.connect("download-started", self.download)
                child = self.window.get_child()
                if child is not None:
                    self.window.remove(child)
                self.window.add(self.view.web)
                try:
                    desktop = Desktop(self.assets, LocalWeb, self.view.event, self.window, self.hide_to_tray)
                    self.desktop = desktop
                    self.service.desktop = lambda method, args: self.ui(lambda: desktop.invoke(method, args))
                    desktop.connect(self.view.web, "button-press-event", desktop.input)
                    desktop.connect(self.view.web, "key-press-event", desktop.input)
                    self.update_native_block()
                except Exception as error:
                    self.close_desktop()
                    self.service.desktop = None
                    self.service.desktop_reason = str(error) if isinstance(error, p.Failure) else "桌面呈現目前無法啟動；仍可在主畫面保存便箋。"
                self.reveal()
                self.view.load(lambda error: self.failure(error) if error else None)
            except Exception as error:
                self.failure(error)
            return False
        future.add_done_callback(lambda _: GLib.idle_add(ready))

    def receive(self, value):
        try:
            p.require(not self.stopped and self.service is not None and self.admitted < 32 and p.number(value, "v", 1) == 1 and p.is_uuid(value.get("id")) and isinstance(value.get("params"), dict), "invalid-request", "原生訊息無效。")
            method = p.text(value, "method", 64)
            self.admitted += 1
            session, current, view = self.service, self.epoch, self.view
            # Account changes/exit must not wait behind a password window in the serial network queue.
            if method in ("google.signIn", "google.open", "google.local", "google.signOut", "storage.reset", "host.closeReady"):
                session.google.cancel_unlock()
            if method == "host.ready":
                # Vault work is optional and starts only after the owner can show/edit its workspace.
                self.network.submit(session.secrets.migrate_pending)
            worker = self.previews if method == "attachment.preview" else self.network if method.startswith("google.") or method in ("backup.key.create", "backup.encrypt") else self.storage
            deadline = time.monotonic() + Vault.UNLOCK_TIMEOUT if method == "google.unlockVault" else None
            request_cancelled = session.google.request_unlock() if method == "google.unlockVault" else None
            future = worker.submit(session.invoke, method, value["params"], deadline, request_cancelled)

            def complete():
                self.admitted -= 1
                if current != self.epoch or self.stopped:
                    return False
                try:
                    result = future.result()
                    view.post({"v": 1, "id": value["id"], "ok": True, "result": result})
                    # A reset reopens the same, now empty, profile the same way an account switch opens another one.
                    if method in ("google.open", "google.local", "google.signOut", "storage.reset"):
                        self.epoch += 1
                        self.close_desktop()
                        self.open_store(result["profileId"], persist=True)
                    elif method == "host.closeCancel":
                        self.closing = self.restart = False
                    elif method == "host.restart" and not self.closing:
                        # The usual close saves drafts and closes the data first; main() then starts again.
                        self.restart = True
                        self.close_requested()
                    elif self.closing and session.close_ready:
                        self.quit()
                except Exception as error:
                    failure = error if isinstance(error, p.Failure) else p.Failure("native-unavailable", "原生操作未完成，請保留草稿後重試。")
                    view.post({"v": 1, "id": value["id"], "ok": False, "error": {"code": failure.code, "message": str(failure)}})
                return False
            future.add_done_callback(lambda _: GLib.idle_add(complete))
        except Exception:
            pass

    def window_close(self, *_):
        # The title-bar close keeps Work Fleet in the tray unless that setting is off; the tray's exit item saves and quits.
        if self.preferences["closeToTray"] and self.hide_to_tray():
            return True
        return self.close_requested()

    def close_requested(self, *_):
        if self.closing:
            return True
        self.closing = True
        self.flush_placement()
        if self.service is not None and self.service.ready and self.view is not None:
            self.view.event("host-close-requested")
        else:
            self.quit()
        return True

    def download(self, _context, download):
        if self.closing or self.stopped:
            download.cancel()
            return
        received = [0]

        def data_received(_download, length):
            received[0] += length
            if received[0] > p.BACKUP:
                download.cancel()
        download.connect("received-data", data_received)

        def destination(_download, suggested):
            picker = Gtk.FileChooserNative.new("保存檔案", self.window, Gtk.FileChooserAction.SAVE, "保存", "取消")
            picker.set_current_name(Path(suggested or "work-fleet-export").name[:240])
            picker.set_do_overwrite_confirmation(True)
            self.dialog_opened()

            def selected(dialog, code):
                file = dialog.get_file() if code == Gtk.ResponseType.ACCEPT else None
                if file is None:
                    download.cancel()
                else:
                    download.set_allow_overwrite(True)
                    download.set_destination(file.get_uri())
                dialog.destroy()
                self.dialog_closed()
            picker.connect("response", selected)
            picker.show()
            return True
        download.connect("decide-destination", destination)

    def failure(self, error):
        message = str(error) if isinstance(error, p.Failure) else "無法開啟工作空間，請保留 App 資料與本機金鑰後重試。"
        dialog = Gtk.MessageDialog(transient_for=self.window, modal=True, message_type=Gtk.MessageType.ERROR, buttons=Gtk.ButtonsType.CLOSE, text="Work Fleet")
        dialog.format_secondary_text(message)
        self.dialog_opened()
        def dismissed(dialog, _response):
            dialog.destroy()
            self.dialog_closed()
        dialog.connect("response", dismissed)
        dialog.show()

    def process_failed(self):
        self.epoch += 1
        self.close_desktop()
        if self.service is not None:
            self.service.ready = False
        if self.view is not None:
            self.view.close()
        if self.window is not None and not self.window.get_visible():
            self.window.set_focus_on_map(False)
            self.window.show_all()
        self.failure(p.Failure("native-view", "畫面程序已停止；已確認保存的資料仍保留，請重新開啟。"))

    def shutdown(self, _application):
        self.flush_placement()
        self.stopped = True
        self.vault.close()
        self.epoch += 1
        self.close_desktop()
        if self.tray is not None:
            self.tray.close()
        if self.view is not None:
            self.view.close()
        if self.service is not None:
            self.service.google.close()
            self.storage.submit(self.service.close)
        self.previews.shutdown(wait=False, cancel_futures=True)
        self.network.shutdown(wait=False, cancel_futures=True)
        self.storage.shutdown(wait=False)


def main():
    parser = argparse.ArgumentParser(description="Work Fleet Linux native host")
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--data", type=Path, default=xwayland.data_directory([], os.environ))
    # Written into the XDG autostart entry, so a sign-in launch can stay in the tray.
    parser.add_argument(hostsettings.LOGIN_ARGUMENT, dest="login", action="store_true")
    args = parser.parse_args()
    config = p.decode(args.config.read_bytes())
    directory = args.data.expanduser().absolute()
    application = FleetApp(args.assets.resolve(strict=True), config, directory, args.login, xwayland.data_directory([], os.environ))
    code = application.run([sys.argv[0]])
    if not application.restart:
        return code
    # Storage finishes closing before the new process takes the data lock; the new display choice applies there.
    application.storage.shutdown(wait=True)
    if not xwayland.data_unlocked(directory):
        print("Work Fleet closed but its data is still in use; open it again to apply the display choice.", file=sys.stderr)
        return code
    environment = dict(os.environ)
    xwayland.configure(environment, directory)
    # A restart is not a sign-in launch, so it never starts hidden again.
    os.execve(sys.executable, [sys.executable, *(value for value in sys.argv if value != hostsettings.LOGIN_ARGUMENT)], environment)


if __name__ == "__main__":
    raise SystemExit(main())
