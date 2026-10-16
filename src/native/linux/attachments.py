"""Private attachment copies, system thumbnails and explicit default-application opening."""
import base64
import configparser
import hashlib
import mimetypes
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import threading
import time

import protocol as p

EXECUTABLE = {".exe", ".com", ".bat", ".cmd", ".ps1", ".msi", ".msp", ".scr", ".lnk", ".url", ".desktop", ".sh", ".app", ".command", ".vbs", ".js", ".jse", ".wsf", ".hta", ".cpl", ".pif", ".vbe", ".wsh", ".py", ".pyw", ".rb", ".pl", ".jar", ".jnlp", ".webloc", ".workflow", ".action", ".run", ".deb", ".rpm", ".pkg", ".dmg", ".reg", ".inf"}


def filename(name):
    p.require(isinstance(name, str) and name.strip() and len(name) <= 240, "invalid-attachment", "附件檔名無效。")
    clean = "".join("_" if char in '\\/:*?"<>|' or ord(char) < 32 or ord(char) == 127 else char for char in name).strip(". ")
    if len(clean.encode("utf-8")) > 180:
        suffix = Path(clean).suffix
        if len(suffix.encode("utf-8")) > 32:
            suffix = ""
        stem = clean[:-len(suffix)] if suffix else clean
        clean = stem.encode("utf-8")[:180 - len(suffix.encode("utf-8"))].decode("utf-8", "ignore") + suffix
    return clean or "attachment.bin"


class AttachmentFiles:
    def __init__(self, ui=lambda work: work(), render=None, launch=None):
        self.ui, self.render, self.launch = ui, render or self.thumbnail, launch or self.open_default
        self.root = Path(tempfile.mkdtemp(prefix="WorkFleet-attachments-"))
        self.previews, self.copies = {}, []
        self.processes = set()
        self.lock = threading.RLock()
        self.closed = False

    def invoke(self, data, name, open_file=False):
        with self.lock:
            p.require(not self.closed, "native-closed", "附件工作階段已結束。")
            name = filename(name)
            p.require(isinstance(data, bytes) and len(data) <= p.ATTACHMENT, "attachment-capacity", "附件超過容量上限。")
            key = (hashlib.sha256(data).hexdigest(), name)
            if not open_file and key in self.previews:
                return self.previews[key]
            p.require(not open_file or Path(name).suffix.lower() not in EXECUTABLE, "attachment-not-document", "此類檔案請先匯出，再自行選擇開啟方式。")
            folder = Path(tempfile.mkdtemp(dir=self.root))
            file = folder / name
            file.write_bytes(data)
            os.chmod(file, 0o400)
            if open_file:
                self.copies.append(folder)
                try:
                    p.require(self.launch(file), "attachment-open", "無法開啟附件，請確認已安裝對應的應用程式。")
                except p.Failure:
                    raise
                except Exception as error:
                    raise p.Failure("attachment-open", "無法開啟附件，請確認已安裝對應的應用程式。") from error
                return {"opened": True}
        try:
            png = self.render(file)
            result = {"available": True, "png": base64.b64encode(png).decode("ascii") if png and len(png) <= 256 * 1024 else None}
            with self.lock:
                p.require(not self.closed, "stale-session", "附件工作階段已結束。")
                if len(self.previews) >= 64:
                    self.previews.pop(next(iter(self.previews)))
                self.previews[key] = result
            return result
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    def open_default(self, file):
        from gi.repository import Gio
        return self.ui(lambda: Gio.AppInfo.launch_default_for_uri(file.as_uri(), None))

    def thumbnail(self, file):
        import gi
        gi.require_version("Gtk", "3.0")
        gi.require_version("GdkPixbuf", "2.0")
        from gi.repository import GdkPixbuf, Gio, GLib, Gtk

        def load(path):
            try:
                pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(str(path), 128, 128, True)
                ok, data = pixbuf.save_to_bufferv("png", [], [])
                return bytes(data) if ok else None
            except Exception:
                return None

        png = load(file)
        if png:
            return png
        # Respect installed desktop thumbnailers; parse Exec into argv, never pass it to a shell.
        mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        seen = set(); deadline = time.monotonic() + 8
        for directory in [GLib.get_user_data_dir(), *GLib.get_system_data_dirs()]:
            for entry in sorted((Path(directory) / "thumbnailers").glob("*.thumbnailer")):
                if entry.name in seen:
                    continue
                seen.add(entry.name)
                try:
                    config = configparser.ConfigParser(interpolation=None)
                    config.read(entry, encoding="utf-8")
                    rule = config["Thumbnailer Entry"]
                    if mime not in rule.get("MimeType", "").split(";"):
                        continue
                    output = file.parent / "generated-preview.png"
                    values = {"%u": file.as_uri(), "%i": str(file), "%o": str(output), "%s": "128", "%%": "%"}
                    argv = [values.get(value, value) for value in shlex.split(rule["Exec"])]
                    if not argv or not shutil.which(argv[0]) or any("%" in value for value in argv):
                        continue
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        return None
                    with subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
                        with self.lock:
                            if self.closed:
                                process.terminate()
                                return None
                            self.processes.add(process)
                        try:
                            try:
                                process.wait(timeout=remaining)
                            except subprocess.TimeoutExpired:
                                process.kill()
                                process.wait()
                        finally:
                            with self.lock:
                                self.processes.discard(process)
                    if output.is_file() and output.stat().st_size <= 4 * 1024 * 1024:
                        png = load(output)
                        if png:
                            return png
                except (OSError, ValueError, KeyError, configparser.Error, subprocess.TimeoutExpired):
                    continue
        def icon():
            try:
                info = Gio.File.new_for_path(str(file)).query_info("standard::icon", Gio.FileQueryInfoFlags.NONE, None)
                theme = Gtk.IconTheme.get_default()
                item = theme.lookup_by_gicon(info.get_icon(), 48, Gtk.IconLookupFlags.FORCE_SIZE) if theme else None
                if item:
                    ok, data = item.load_icon().save_to_bufferv("png", [], [])
                    return bytes(data) if ok else None
            except Exception:
                return None
        return self.ui(icon)

    def close(self):
        with self.lock:
            self.closed = True
            self.previews.clear()
            children = list(self.processes)
        for process in children:
            try:
                process.terminate()
            except OSError:
                pass
        # root is a private mkdtemp directory owned only by this instance.
        shutil.rmtree(self.root, ignore_errors=True)
