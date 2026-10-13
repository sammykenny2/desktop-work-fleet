"""Owner bridge and bounded transfer leases, separate from presentation surfaces."""
import base64
import threading
import time

from backup import Backup
from google import Google
import protocol as p


class Service:
    def __init__(self, database, vault, config, choose, open_browser, desktop=None):
        self.database, self.desktop = database, desktop
        self.desktop_reason = None
        self.display = None
        # ADR-043: set by the GTK owner, which runs startup settings and the main window on its own thread.
        self.identity = {"appVersion": "0.0.0", "distribution": "source"}
        self.shell = None
        self.updates = False
        self.backup = Backup(database, choose)
        self.google = Google(vault, config, database.profile, open_browser)
        self.transfers, self.staged = {}, set()
        self.lock = threading.RLock()
        self.closed = False
        self.ready = self.close_ready = False

    def add(self, kind, size, digest, data):
        with self.lock:
            p.require(not self.closed and len(self.transfers) < 8 and sum(item["size"] for item in self.transfers.values()) + size <= 256 * 1024 * 1024, "transfer-busy", "原生傳輸忙碌。")
            key = p.identifier()
            self.transfers[key] = {"kind": kind, "size": size, "sha256": digest, "bytes": data, "used": time.monotonic()}
            return key

    def transfer(self, token):
        value = self.transfers.get(token)
        p.require(value is not None, "transfer-missing", "原生傳輸已失效。")
        value["used"] = time.monotonic()
        return value

    def owned(self, args):
        token = p.text(args, "token")
        p.require(token in self.staged, "transfer-missing", "原生傳輸不屬於此視窗。")
        return token

    def upload(self, args, kind):
        with self.lock:
            return self.database.staged(self.owned(args), kind)[1]

    def download(self, data):
        if data is None:
            return None
        digest = p.digest(data)
        return {"token": self.add("download", len(data), digest, data), "size": len(data), "sha256": digest}

    def invoke(self, method, args):
        p.require(not self.closed, "native-closed", "原生工作階段已結束。")
        if method.startswith("google."):
            if method == "google.status":
                return self.google.status()
            if method == "google.signIn":
                return self.google.sign_in()
            if method == "google.open":
                return {"profileId": self.google.open_account(p.text(args, "accountId"))}
            if method == "google.signOut":
                self.google.sign_out()
                return {"profileId": "local"}
            if method == "google.local":
                return {"profileId": "local"}
            data = self.upload(args, "attachment") if method == "google.create" else None
            result = self.google.invoke(method, args, data)
            p.require(not self.closed, "stale-session", "Google 工作階段已結束。")
            return self.download(result) if isinstance(result, bytes) else result
        if method.startswith("desktop.") and self.desktop is not None:
            return self.desktop(method, args)
        if method in ("host.preferences.get", "host.preferences.set", "host.preferences.openSystem", "host.window.resetPlacement",
                      "update.state", "update.check", "update.download", "update.install"):
            p.require(self.shell is not None, "unsupported-method", "原生主機沒有此操作。")
            return self.shell(method, args)
        with self.lock:
            p.require(not self.closed, "native-closed", "原生工作階段已結束。")
            for token, value in list(self.transfers.items()):
                if time.monotonic() - value["used"] > 300:
                    self.transfers.pop(token, None)
            if method.startswith("backup."):
                return self.backup.invoke(method, args, self.upload, self.download)
            if method == "host.info":
                return {"protocol": 1, "platform": "linux", "profileId": self.database.profile, **self.identity, "storage": "sqlite-secret-service", "desktopReason": self.desktop_reason, "displayBackend": self.display.info() if self.display else None, "maxChunkBytes": p.CHUNK, "maxMessageBytes": 1024 * 1024, "maxRecordBytes": p.RECORD, "maxAttachmentBytes": p.ATTACHMENT, "maxBackupBytes": p.BACKUP,
                        "capabilities": {"nativeStorage": True, "automaticFiles": True, "backupFiles": True, "secureBackup": True, "google": self.google.available, "desktopPresentation": self.desktop is not None,
                                         "hostPreferences": self.shell is not None, "updates": self.updates}}
            if method == "host.ready":
                self.ready = True
                return None
            if method == "host.closeReady":
                self.close_ready = True
                return None
            if method == "host.closeCancel":
                self.close_ready = False
                return None
            if method == "host.displayBackend":
                p.require(self.display is not None and self.display.switchable, "display-fixed", "這個桌面環境不能切換顯示方式。")
                return self.display.choose(p.boolean(args, "xwayland"))
            if method == "host.restart":
                # The host closes like the tray's exit item, then starts again with the saved display choice.
                return None
            if method == "transfer.begin":
                kind, digest = p.text(args, "kind"), p.text(args, "sha256")
                maximum = {"workspace": p.RECORD, "journal": p.RECORD, "attachment": p.ATTACHMENT, "backup": p.BACKUP}.get(kind)
                p.require(maximum is not None and p.is_digest(digest), "invalid-transfer", "傳輸種類或校驗值無效。")
                return {"token": self.add(kind, p.number(args, "size", maximum), digest, bytearray())}
            if method == "transfer.append":
                value = self.transfer(p.text(args, "token"))
                data = base64.b64decode(p.text(args, "base64", p.CHUNK * 4 // 3 + 4), validate=True)
                p.require(value["kind"] != "download" and p.number(args, "offset", p.BACKUP) == len(value["bytes"]) and 0 < len(data) <= p.CHUNK and len(value["bytes"]) + len(data) <= value["size"], "transfer-offset", "傳輸順序或容量不符。")
                value["bytes"].extend(data)
                return {"offset": len(value["bytes"])}
            if method == "transfer.finish":
                token = p.text(args, "token")
                value = self.transfer(token)
                p.require(value["kind"] != "download" and len(value["bytes"]) == value["size"], "transfer-incomplete", "傳輸尚未完整。")
                sealed = self.database.stage(value["kind"], bytes(value["bytes"]), value["sha256"])
                self.staged.add(sealed)
                self.transfers.pop(token)
                return {"token": sealed}
            if method == "transfer.discard":
                token = p.text(args, "token")
                self.transfers.pop(token, None)
                if token in self.staged:
                    self.database.discard(token)
                    self.staged.remove(token)
                return None
            if method == "transfer.read":
                value = self.transfer(p.text(args, "token"))
                offset = p.number(args, "offset", value["size"])
                p.require(value["kind"] == "download", "invalid-transfer", "下載身分無效。")
                end = min(value["size"], offset + p.CHUNK)
                return {"offset": offset, "base64": base64.b64encode(value["bytes"][offset:end]).decode("ascii"), "done": end == value["size"]}
            if method == "storage.reset":
                self.transfers.clear()
                self.staged.clear()
                self.database.reset()
                return {"profileId": self.database.profile}
            if method == "storage.load":
                return self.download(self.database.record(p.text(args, "kind")))
            if method == "storage.attachment":
                return self.download(self.database.attachment(p.text(args, "id")))
            if method == "storage.putAttachment":
                token = self.owned(args)
                digest = self.database.put_attachment(token)
                self.staged.remove(token)
                return {"id": digest}
            if method == "storage.commit":
                token, attachments = self.owned(args), args.get("attachments", [])
                p.require("expectedRevision" in args and isinstance(attachments, list) and all(item in self.staged for item in attachments), "invalid-request", "提交條件或附件身分無效。")
                expected = None if args["expectedRevision"] is None else p.number(args, "expectedRevision")
                replace_attachments = p.boolean(args, "replaceAttachments") if "replaceAttachments" in args else False
                self.database.commit(p.text(args, "kind"), token, expected, attachments, replace_attachments)
                self.staged.discard(token)
                self.staged.difference_update(attachments)
                return None
            raise p.Failure("unsupported-method", "原生主機沒有此操作。")

    def close(self):
        self.closed = True
        self.google.close()
        with self.lock:
            for token in self.staged:
                self.database.discard(token)
            self.staged.clear()
            self.transfers.clear()
            self.database.close()
