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
from urllib.parse import unquote, urlsplit

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, Gio, GLib, Gtk, WebKit2

from database import Database, Vault
from service import Service
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
    def __init__(self, assets, config, directory):
        self.assets, self.config, self.directory = assets, config, directory
        super().__init__(application_id=config.get("appId") or "app.workfleet.preview", flags=Gio.ApplicationFlags.FLAGS_NONE)
        self.connect("activate", self.activate)
        self.connect("shutdown", self.shutdown)
        self.window = self.view = self.service = None
        self.storage = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fleet-storage")
        self.network = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fleet-google")
        self.epoch = self.admitted = 0
        self.closing = self.stopped = False
        self.vault = Vault(config.get("appId") or "app.workfleet.preview")

    def activate(self, _application):
        if self.window is not None:
            self.window.present()
            return
        self.window = Gtk.ApplicationWindow(application=self, title="Work Fleet")
        icon = self.assets.parent / "Icons" / ((self.config.get("appId") or "app.workfleet.preview") + ".png")
        if icon.is_file():
            self.window.set_icon_from_file(str(icon))
        self.window.set_default_size(1180, 800)
        self.window.connect("delete-event", self.close_requested)
        self.window.add(Gtk.Label(label="正在開啟安全工作空間…"))
        self.window.show_all()
        marker = self.directory / "profile.txt"
        try:
            profile = marker.read_text("utf-8").strip()
        except FileNotFoundError:
            profile = "local"
        if not (profile == "local" or profile.startswith("google:") and p.is_account(profile[7:])):
            profile = "local"
        self.open_store(profile)

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
            picker = Gtk.FileChooserNative.new("選擇備份資料夾", self.window, Gtk.FileChooserAction.SELECT_FOLDER, "選擇", "取消")
            result["picker"] = picker

            def response(dialog, code):
                result["path"] = dialog.get_filename() if code == Gtk.ResponseType.ACCEPT else None
                dialog.destroy()
                done.set()
            picker.connect("response", response)
            picker.show()
            return False
        GLib.idle_add(show)
        if not done.wait(110):
            GLib.idle_add(lambda: result.get("picker") and result["picker"].destroy())
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
                if self.view is not None:
                    self.view.close()
                self.view = LocalWeb(self.assets, DOCUMENT, self.receive, self.process_failed)
                self.view.context.connect("download-started", self.download)
                child = self.window.get_child()
                if child is not None:
                    self.window.remove(child)
                self.window.add(self.view.web)
                self.window.show_all()
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
            worker = self.network if method.startswith("google.") else self.storage
            future = worker.submit(session.invoke, method, value["params"])

            def complete():
                self.admitted -= 1
                if current != self.epoch or self.stopped:
                    return False
                try:
                    result = future.result()
                    view.post({"v": 1, "id": value["id"], "ok": True, "result": result})
                    if method in ("google.open", "google.local", "google.signOut"):
                        self.epoch += 1
                        self.open_store(result["profileId"], persist=True)
                    elif method == "host.closeCancel":
                        self.closing = False
                    elif self.closing and session.close_ready:
                        self.quit()
                except Exception as error:
                    failure = error if isinstance(error, p.Failure) else p.Failure("native-unavailable", "原生操作未完成，請保留草稿後重試。")
                    view.post({"v": 1, "id": value["id"], "ok": False, "error": {"code": failure.code, "message": str(failure)}})
                return False
            future.add_done_callback(lambda _: GLib.idle_add(complete))
        except Exception:
            pass

    def close_requested(self, *_):
        if self.closing:
            return True
        self.closing = True
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

            def selected(dialog, code):
                file = dialog.get_file() if code == Gtk.ResponseType.ACCEPT else None
                if file is None:
                    download.cancel()
                else:
                    download.set_allow_overwrite(True)
                    download.set_destination(file.get_uri())
                dialog.destroy()
            picker.connect("response", selected)
            picker.show()
            return True
        download.connect("decide-destination", destination)

    def failure(self, error):
        message = str(error) if isinstance(error, p.Failure) else "無法開啟安全工作空間，請保留 App 資料與金鑰圈後重試。"
        dialog = Gtk.MessageDialog(transient_for=self.window, modal=True, message_type=Gtk.MessageType.ERROR, buttons=Gtk.ButtonsType.CLOSE, text="Work Fleet")
        dialog.format_secondary_text(message)
        dialog.connect("response", lambda dialog, _response: dialog.destroy())
        dialog.show()

    def process_failed(self):
        self.epoch += 1
        if self.service is not None:
            self.service.ready = False
        if self.view is not None:
            self.view.close()
        self.failure(p.Failure("native-view", "畫面程序已停止；已確認保存的資料仍保留，請重新開啟。"))

    def shutdown(self, _application):
        self.stopped = True
        self.vault.cancellable.cancel()
        self.epoch += 1
        if self.view is not None:
            self.view.close()
        if self.service is not None:
            self.service.google.close()
            self.storage.submit(self.service.close)
        self.network.shutdown(wait=False, cancel_futures=True)
        self.storage.shutdown(wait=False)


def main():
    parser = argparse.ArgumentParser(description="Work Fleet Linux native host")
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--data", type=Path, default=Path(GLib.get_user_data_dir()) / "WorkFleet")
    args = parser.parse_args()
    config = p.decode(args.config.read_bytes())
    application = FleetApp(args.assets.resolve(strict=True), config, args.data.expanduser().absolute())
    return application.run([sys.argv[0]])


if __name__ == "__main__":
    raise SystemExit(main())
