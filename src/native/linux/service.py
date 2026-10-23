"""Owner bridge and bounded transfer leases, separate from presentation surfaces."""
import base64
import threading
import time

from backup import Backup
from database import Credentials, SystemSecrets
from google import Google
import protocol as p
from text import t


class Service:
    def __init__(self, database, vault, config, choose, open_browser, desktop=None):
        self.database, self.desktop = database, desktop
        # A text.py key for why desktop notes are unavailable, looked up when host.info answers.
        self.desktop_reason = None
        self.display = None
        # ADR-043: set by the GTK owner, which runs startup settings and the main window on its own thread.
        self.identity = {"appVersion": "0.0.0", "distribution": "source"}
        self.shell = None
        # Set by the GTK owner: returns the display-language preference and the system languages (docs/i18n.md).
        self.language = None
        self.updates = False
        self.attachment_files = None
        # Set by the GTK owner: opens the data folder in the file manager (SPEC-006 DO).
        self.reveal = None
        self.secrets = SystemSecrets(database, vault)
        self.backup = Backup(database, choose, self.secrets)
        self.google = Google(Credentials(database, vault, self.secrets), config, database.profile, open_browser)
        self.transfers, self.staged = {}, set()
        self.lock = threading.RLock()
        self.closed = False
        self.ready = self.close_ready = False

    def add(self, kind, size, digest, data):
        with self.lock:
            p.require(not self.closed and len(self.transfers) < 8 and sum(item["size"] for item in self.transfers.values()) + size <= 256 * 1024 * 1024, "transfer-busy", "Native transfers are busy. Try again in a moment.")
            key = p.identifier()
            self.transfers[key] = {"kind": kind, "size": size, "sha256": digest, "bytes": data, "used": time.monotonic()}
            return key

    def transfer(self, token):
        value = self.transfers.get(token)
        p.require(value is not None, "transfer-missing", "The native transfer has expired.")
        value["used"] = time.monotonic()
        return value

    def owned(self, args):
        token = p.text(args, "token")
        p.require(token in self.staged, "transfer-missing", "The native transfer doesn't belong to this window.")
        return token

    def upload(self, args, kind):
        with self.lock:
            return self.database.staged(self.owned(args), kind)[1]

    def download(self, data):
        if data is None:
            return None
        digest = p.digest(data)
        return {"token": self.add("download", len(data), digest, data), "size": len(data), "sha256": digest}

    def invoke(self, method, args, deadline=None, request_cancelled=None):
        p.require(not self.closed, "native-closed", "The native session has ended.")
        if method.startswith("google."):
            if method == "google.status":
                return self.google.status()
            if method == "google.unlockVault":
                return self.google.unlock_vault(deadline, request_cancelled)
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
            p.require(not self.closed, "stale-session", "The Google session has ended.")
            return self.download(result) if isinstance(result, bytes) else result
        if method.startswith("desktop.") and self.desktop is not None:
            return self.desktop(method, args)
        if method in ("backup.key.create", "backup.encrypt"):
            # Vault and encryption work must not hold the local-storage bridge lock.
            result = self.backup.invoke(method, args, self.upload, self.download)
            p.require(not self.closed, "stale-session", "The native session has ended.")
            return result
        if method in ("host.preferences.get", "host.preferences.set", "host.preferences.openSystem", "host.window.resetPlacement",
                      "host.language.set", "update.state", "update.check", "update.download", "update.install"):
            p.require(self.shell is not None, "unsupported-method", "The native host doesn't support this operation.")
            return self.shell(method, args)
        # SPEC-006 DO: the folder of data the page couldn't read. The owner reopens the page on empty data after a set-aside.
        if method == "data.location":
            return {"path": str(self.database.directory)}
        if method == "data.reveal":
            p.require(self.reveal is not None, "unsupported-method", "The native host doesn't support this operation.")
            self.reveal()
            return None
        if method == "data.setAside":
            return {"profileId": self.database.profile}
        if method in ("attachment.preview", "attachment.open"):
            with self.lock:
                p.require(not self.closed and self.attachment_files is not None, "native-closed", "The native session has ended.")
                files = self.attachment_files
                data = self.database.attachment(p.text(args, "id"))
                name = p.text(args, "name", 240)
            if data is None:
                p.require(method != "attachment.open", "missing-attachment", "The attachment hasn't been downloaded yet. Finish syncing first.")
                return {"available": False, "png": None}
            result = files.invoke(data, name, method == "attachment.open")
            p.require(not self.closed, "stale-session", "The native session has ended.")
            return result
        with self.lock:
            p.require(not self.closed, "native-closed", "The native session has ended.")
            for token, value in list(self.transfers.items()):
                if time.monotonic() - value["used"] > 300:
                    self.transfers.pop(token, None)
            if method.startswith("backup."):
                return self.backup.invoke(method, args, self.upload, self.download)
            if method == "host.info":
                return {"protocol": 1, "platform": "linux", "profileId": self.database.profile, **self.identity, "storage": "sqlite-local-key", "desktopReason": t(self.desktop_reason) if self.desktop_reason else None, "displayBackend": self.display.info() if self.display else None, "maxChunkBytes": p.CHUNK, "maxMessageBytes": 1024 * 1024, "maxRecordBytes": p.RECORD, "maxAttachmentBytes": p.ATTACHMENT, "maxBackupBytes": p.BACKUP,
                        "capabilities": {"nativeStorage": True, "automaticFiles": True, "backupFiles": True, "secureBackup": True, "google": self.google.available, "desktopPresentation": self.desktop is not None,
                                         "hostPreferences": self.shell is not None, "updates": self.updates, "vaultUnlock": True, "attachmentFiles": self.attachment_files is not None,
                                         "languagePreference": self.language is not None, "dataRecovery": self.reveal is not None},
                        "language": self.language() if self.language is not None else None}
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
                p.require(self.display is not None and self.display.switchable, "display-fixed", "This desktop can't switch the display mode.")
                return self.display.choose(p.boolean(args, "xwayland"))
            if method == "host.restart":
                # The host closes like the tray's exit item, then starts again with the saved display choice.
                return None
            if method == "transfer.begin":
                kind, digest = p.text(args, "kind"), p.text(args, "sha256")
                maximum = {"workspace": p.RECORD, "journal": p.RECORD, "attachment": p.ATTACHMENT, "backup": p.BACKUP}.get(kind)
                p.require(maximum is not None and p.is_digest(digest), "invalid-transfer", "The transfer kind or checksum isn't valid.")
                return {"token": self.add(kind, p.number(args, "size", maximum), digest, bytearray())}
            if method == "transfer.append":
                value = self.transfer(p.text(args, "token"))
                data = base64.b64decode(p.text(args, "base64", p.CHUNK * 4 // 3 + 4), validate=True)
                p.require(value["kind"] != "download" and p.number(args, "offset", p.BACKUP) == len(value["bytes"]) and 0 < len(data) <= p.CHUNK and len(value["bytes"]) + len(data) <= value["size"], "transfer-offset", "The transfer order or size doesn't match.")
                value["bytes"].extend(data)
                return {"offset": len(value["bytes"])}
            if method == "transfer.finish":
                token = p.text(args, "token")
                value = self.transfer(token)
                p.require(value["kind"] != "download" and len(value["bytes"]) == value["size"], "transfer-incomplete", "The transfer isn't complete yet.")
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
                p.require(value["kind"] == "download", "invalid-transfer", "The download token isn't valid.")
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
                p.require("expectedRevision" in args and isinstance(attachments, list) and all(item in self.staged for item in attachments), "invalid-request", "The commit condition or attachment IDs aren't valid.")
                expected = None if args["expectedRevision"] is None else p.number(args, "expectedRevision")
                replace_attachments = p.boolean(args, "replaceAttachments") if "replaceAttachments" in args else False
                self.database.commit(p.text(args, "kind"), token, expected, attachments, replace_attachments)
                self.staged.discard(token)
                self.staged.difference_update(attachments)
                return None
            raise p.Failure("unsupported-method", "The native host doesn't support this operation.")

    def close(self):
        self.closed = True
        self.google.close()
        self.secrets.close()
        with self.lock:
            if self.attachment_files is not None:
                self.attachment_files.close()
            for token in self.staged:
                self.database.discard(token)
            self.staged.clear()
            self.transfers.clear()
            self.database.close()
