"""User-selected files, durable receipts and portable encrypted backups."""
from contextlib import contextmanager
import hashlib
import io
import os
from pathlib import Path
import stat
import zipfile

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import protocol as p


class Backup:
    FIELDS = ("id", "scheduleId", "policyId", "destinationId", "name", "sourceRevision", "createdAt", "encrypted", "sha256", "size")

    def __init__(self, database, choose, secrets):
        self.database, self.choose, self.secrets = database, choose, secrets
        self.manual = {}

    def metadata(self, kind, key):
        data = self.database.secret(kind, key)
        return None if data is None else p.decode(data)

    def save(self, kind, key, value):
        self.database.secret(kind, key, p.encode(value))

    @contextmanager
    def directory(self, key):
        value = self.metadata("backup-directory", key)
        p.require(value is not None, "backup-permission", "Choose the backup folder again.")
        descriptor = os.open(p.text(value, "path", 32768), os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            info = os.fstat(descriptor)
            p.require(str(info.st_dev) == value["device"] and str(info.st_ino) == value["inode"], "backup-permission", "The backup folder has changed. Choose it again.")
            yield descriptor
        finally:
            os.close(descriptor)

    def grant(self):
        selected = self.choose()
        p.require(selected is not None, "backup-cancelled", "The selection was cancelled.")
        path = Path(selected).resolve(strict=True)
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            info = os.fstat(descriptor)
            key = p.identifier()
            self.save("backup-directory", key, {"path": str(path), "device": str(info.st_dev), "inode": str(info.st_ino), "name": path.name})
            return key, path.name
        finally:
            os.close(descriptor)

    def read(self, directory, name, identity=None):
        try:
            descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
        except FileNotFoundError:
            return None
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            p.require(stat.S_ISREG(info.st_mode) and 0 <= info.st_size <= p.BACKUP, "backup-unconfirmed", "The backup file's type or size isn't valid.")
            if identity is not None:
                p.require(str(info.st_dev) == identity["device"] and str(info.st_ino) == identity["inode"], "backup-file-unowned", "The backup file was replaced, so it was kept.")
            data = stream.read(p.BACKUP + 1)
            p.require(len(data) <= p.BACKUP, "backup-limit", "The backup is too large.")
            return data

    def create(self, directory, name, data, remember):
        descriptor = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        with os.fdopen(descriptor, "w+b") as stream:
            info = os.fstat(stream.fileno())
            p.require(stat.S_ISREG(info.st_mode), "backup-unconfirmed", "The new backup file's type isn't valid.")
            identity = {"device": str(info.st_dev), "inode": str(info.st_ino)}
            remember(identity)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            os.fsync(directory)
            p.require(self.read(directory, name, identity) == data, "backup-unconfirmed", "The backup failed its read-back check; the new file is kept for inspection.")

    def job(self, value):
        p.require(all(key in value for key in self.FIELDS), "invalid-backup-job", "The backup job is missing required fields.")
        job = {key: value[key] for key in self.FIELDS}
        for field in ("id", "scheduleId", "policyId", "destinationId"):
            p.require(p.is_uuid(job[field]), "invalid-backup-job", "The backup job's IDs aren't valid.")
        p.require(job["name"] == "work-fleet-auto-" + job["id"] + ".zip" and p.is_digest(job["sha256"]), "invalid-backup-job", "The backup file name or checksum isn't valid.")
        p.number(job, "sourceRevision")
        p.number(job, "createdAt")
        p.boolean(job, "encrypted")
        p.require(p.number(job, "size", p.BACKUP) > 0, "invalid-backup-job", "The backup size isn't valid.")
        return job

    def same(self, a, b):
        return self.job(a) == self.job(b)

    def journal(self, job, operation):
        record = self.database.record("journal")
        p.require(record is not None, "backup-job-unowned", "The backup schedule hasn't been saved yet.")
        value = p.decode(record)
        p.require(value.get("profileId") == self.database.profile, "backup-profile", "The backup's account has changed.")
        pending = isinstance(value.get("pending"), dict) and self.same(value["pending"], job)
        inventory = value.get("inventory")
        p.require(isinstance(inventory, list) and len(inventory) <= 10000, "invalid-backup-journal", "The backup record's format isn't valid.")
        matches = [entry for entry in inventory if self.same(entry, job)]
        p.require(pending if operation == "create" else pending or len(matches) == 1, "backup-job-unowned", "The backup doesn't belong to the current schedule.")
        if operation != "remove":
            return None
        latest, settings = value.get("lastSuccess"), value.get("settings")
        p.require(len(matches) == 1 and not pending and matches[0].get("status") == "verified" and isinstance(latest, dict) and isinstance(settings, dict), "backup-retention", "The backup doesn't meet the cleanup conditions yet.")
        p.require(latest["id"] != job["id"] and all(latest.get(key) == job[key] == settings.get(key) for key in ("scheduleId", "destinationId")), "backup-retention", "The backup schedule or location has changed, so the old file is kept.")
        keep = p.number(settings, "keep", 90)
        verified = [entry for entry in inventory if entry.get("status") == "verified" and entry.get("scheduleId") == settings["scheduleId"] and entry.get("destinationId") == settings["destinationId"]]
        p.require(keep >= 1 and job["id"] in {entry["id"] for entry in verified[:max(0, len(verified) - keep)]} and any(self.same(entry, latest) for entry in verified), "backup-retention", "The backup is still within the number of copies to keep, so it wasn't removed.")
        return self.job(latest)

    def owned(self, job):
        value = self.metadata("backup-file", job["id"])
        if value is not None:
            p.require(self.same(value.get("job", {}), job), "backup-file-unowned", "The backup's native identity doesn't match.")
        return value

    def verified(self, directory, job, identity):
        p.require(identity is not None, "backup-file-unowned", "The backup has no native creation record, so it was kept.")
        data = self.read(directory, job["name"], identity)
        p.require(data is not None and len(data) == job["size"] and p.digest(data) == job["sha256"], "backup-unconfirmed", "The backup's content wasn't confirmed or has changed, so it was kept.")
        return data

    def invoke(self, method, args, upload, download):
        if "profileId" in args:
            p.require(args["profileId"] == self.database.profile, "backup-profile", "The backup's account has changed.")
        if method in ("backup.choose", "backup.manual.choose"):
            key, name = self.grant()
            if method == "backup.choose":
                return {"destinationId": key, "destinationName": name}
            token = p.identifier()
            self.manual[token] = key
            return {"destinationId": token, "name": "work-fleet-backup-" + token + ".zip"}
        if method == "backup.authorize":
            with self.directory(p.text(args, "destinationId")):
                return None
        if method == "backup.manual.save":
            token = p.text(args, "destinationId")
            key = self.manual.pop(token, None)
            p.require(key is not None, "backup-permission", "Choose the backup location again.")
            data = upload(args, "backup")
            with self.directory(key) as directory:
                self.create(directory, "work-fleet-backup-" + token + ".zip", data, lambda _: None)
            return {"saved": True, "receipt": p.identifier()}
        if method in ("backup.create", "backup.read", "backup.remove"):
            job = self.job(args)
            latest = self.journal(job, method.split(".")[1])
            owned = self.owned(job)
            with self.directory(job["destinationId"]) as directory:
                if method == "backup.create":
                    data = upload(args, "backup")
                    p.require(len(data) == job["size"] and p.digest(data) == job["sha256"], "backup-integrity", "The backup's content doesn't match its job.")
                    if owned is None:
                        self.create(directory, job["name"], data, lambda identity: self.save("backup-file", job["id"], {**identity, "job": job}))
                    else:
                        self.verified(directory, job, owned)
                    return {"saved": True, "receipt": job["id"]}
                if method == "backup.read":
                    if owned is not None:
                        return download(self.verified(directory, job, owned))
                    p.require(self.read(directory, job["name"]) is None, "backup-file-unowned", "A file with the same name has no native creation record, so it was kept.")
                    return None
                with self.directory(latest["destinationId"]) as newest:
                    self.verified(newest, latest, self.owned(latest))
                self.verified(directory, job, owned)
                info = os.stat(job["name"], dir_fd=directory, follow_symlinks=False)
                p.require(stat.S_ISREG(info.st_mode) and str(info.st_dev) == owned["device"] and str(info.st_ino) == owned["inode"], "backup-file-unowned", "The backup file was replaced, so it was kept.")
                os.unlink(job["name"], dir_fd=directory)
                os.fsync(directory)
                self.database.forget("backup-file", job["id"])
                return {"removed": True}
        if method == "backup.key.create":
            password = p.text(args, "password", 1024)
            p.require(len(password) >= 12, "backup-password", "The backup password needs at least 12 characters.")
            key = p.identifier()
            try:
                self.secrets.save(self.database.profile, "backup-key", key, password)
            except p.Failure as error:
                raise p.Failure("backup-vault-unavailable", f"Backup passwords need the system keyring. {error}") from error
            return {"keyId": key}
        if method == "backup.encrypt":
            try:
                password = self.secrets.read(self.database.profile, "backup-key", p.text(args, "keyId"))
            except p.Failure as error:
                raise p.Failure("backup-vault-unavailable", f"Backup passwords need the system keyring. {error}") from error
            p.require(password is not None, "backup-key-unavailable", "The backup key doesn't exist, so nothing was saved unencrypted.")
            data = upload(args, "backup")
            salt, nonce = os.urandom(16), os.urandom(12)
            header = {"cipher": "AES-256-GCM", "format": "work-fleet-encrypted-backup", "iterations": 600000, "kdf": "PBKDF2-HMAC-SHA256", "nonce": nonce.hex(), "salt": salt.hex(), "schemaVersion": 1, "tagBits": 128}
            aad = p.encode(header)
            key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 600000, 32)
            payload = AESGCM(key).encrypt(nonce, data, aad)
            result = io.BytesIO()
            with zipfile.ZipFile(result, "w", compression=zipfile.ZIP_STORED) as archive:
                archive.writestr("encryption.json", aad)
                archive.writestr("payload.bin", payload)
            encrypted = result.getvalue()
            p.require(len(encrypted) <= p.BACKUP, "backup-limit", "The encrypted backup is too large.")
            return download(encrypted)
        raise p.Failure("unsupported-method", "The backup host doesn't support this operation.")
