"""Single-owner encrypted SQLite, with an owner-only local key and legacy keyring migration."""
import base64
from contextlib import closing
import fcntl
import os
from pathlib import Path
import sqlite3
import stat
import tempfile
import threading

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import protocol as p


class Vault:
    """Read legacy secrets without requesting an unlock. New secrets never go to Secret Service."""
    def __init__(self, app_id):
        self.app_id = app_id
        self.cancellable = None

    def connect(self):
        import gi
        gi.require_version("Secret", "1")
        from gi.repository import Gio, Secret
        if self.cancellable is None:
            self.cancellable = Gio.Cancellable()
        # Locked collections hide the schema name; match the attributes, which stay searchable without unlocking.
        self.schema = Secret.Schema.new("app.workfleet.native.v1", Secret.SchemaFlags.DONT_MATCH_NAME, {
            "application": Secret.SchemaAttributeType.STRING,
            "kind": Secret.SchemaAttributeType.STRING,
            "id": Secret.SchemaAttributeType.STRING,
        })
        return Secret

    def attributes(self, kind, key):
        return {"application": self.app_id, "kind": kind, "id": key}

    def read(self, kind, key):
        values = self.values(kind, key)
        return values[0] if values else None

    def values(self, kind, key):
        try:
            Secret = self.connect()
            service = Secret.Service.get_sync(Secret.ServiceFlags.NONE, self.cancellable)
            items = service.search_sync(self.schema, self.attributes(kind, key),
                                        Secret.SearchFlags.ALL | Secret.SearchFlags.LOAD_SECRETS, self.cancellable)
            values = [item.get_secret().get_text() for item in items if not item.get_locked() and item.get_secret() is not None]
            if values:
                return values
            p.require(not items, "vault-locked", "舊版 Work Fleet 金鑰圈仍鎖定；請在系統金鑰圈管理員解鎖後重試一次遷移。原資料未變更。")
            return []
        except p.Failure:
            raise
        except Exception as error:
            raise p.Failure("vault-unavailable", "無法讀取舊版 Work Fleet 金鑰圈；請恢復原金鑰圈或由可攜備份還原。原資料未變更。") from error

    def close(self):
        if self.cancellable is not None:
            self.cancellable.cancel()


class Credentials:
    """Account credentials stay in encrypted SQLite, across workspace resets and account switches."""
    def __init__(self, database, legacy):
        self.database, self.legacy = database, legacy

    def read(self, kind, key):
        p.require(kind == "google-account" and p.is_account(key), "invalid-credential", "Google 憑證身分無效。")
        with self.database.lock:
            row = self.database.connection.execute("SELECT data FROM credentials WHERE kind=? AND id=?", (kind, key)).fetchone()
            if row is not None:
                try:
                    value = self.database.cipher.decrypt(row[0][:12], row[0][12:], self.aad(kind, key)).decode("utf-8")
                except Exception as error:
                    raise p.Failure("storage-integrity", "Google 憑證驗證失敗；請保留 App 資料與本機金鑰。") from error
                return value or None
            try:
                value = self.legacy.read(kind, key)
            except p.Failure:
                # Google may need sign-in again; the local workspace remains usable without an unlock dialog.
                return None
            if value is not None:
                self.save(kind, key, value)
            return value

    @staticmethod
    def aad(kind, key):
        return ("credential|" + kind + "|" + key).encode("utf-8")

    def save(self, kind, key, value):
        p.require(kind == "google-account" and p.is_account(key) and isinstance(value, str) and len(value.encode("utf-8")) <= 65536,
                  "invalid-credential", "Google 憑證種類或容量無效。")
        with self.database.lock:
            nonce = os.urandom(12)
            data = nonce + self.database.cipher.encrypt(nonce, value.encode("utf-8"), self.aad(kind, key))
            self.database.connection.execute("INSERT OR REPLACE INTO credentials VALUES(?,?,?)", (kind, key, data))

    def remove(self, kind, key):
        # A durable tombstone prevents importing the legacy token again after sign-out.
        self.save(kind, key, "")


def validate_legacy_key(filename, raw):
    cipher = AESGCM(raw)
    # Read-only validation covers every profile before publishing a key or changing SQLite/staging.
    with closing(sqlite3.connect(filename.absolute().as_uri() + "?mode=ro", uri=True)) as connection:
        p.require(connection.execute("PRAGMA user_version").fetchone()[0] == 1,
                  "native-version", "舊資料版本不支援遷移；請保留原資料並使用對應版本匯出備份。")
        for table, kind, key in (("records", "'record'", "kind"), ("attachments", "'attachment'", "id"),
                                 ("staging", "'stage:' || kind", "token"), ("secrets", "'secret:' || kind", "id")):
            for profile, purpose, identity, data in connection.execute(f"SELECT profile,{kind},{key},data FROM {table}"):
                aad = f"{len(profile.encode('utf-8'))}:{profile}|{purpose}|{identity}".encode("utf-8")
                cipher.decrypt(data[:12], data[12:], aad)
        if connection.execute("SELECT 1 FROM sqlite_master WHERE name='credentials'").fetchone():
            for kind, key, data in connection.execute("SELECT kind,id,data FROM credentials"):
                cipher.decrypt(data[:12], data[12:], Credentials.aad(kind, key))


def storage_key(directory, filename, legacy):
    path = directory / "storage-key"
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    except FileNotFoundError:
        descriptor = None
    except OSError as error:
        raise p.Failure("native-storage", "無法讀取本機金鑰；請保留 App 資料後檢查檔案權限。") from error
    if descriptor is not None:
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            p.require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0,
                      "native-storage", "本機金鑰檔案身分或權限無效。")
            raw = stream.read(33)
            p.require(len(raw) == 32, "native-storage", "本機金鑰格式無效；原資料未變更。")
            return raw
    if filename.exists():
        values = legacy.values("storage-key", "v1")
        p.require(bool(values), "vault-unavailable", "現有資料缺少原金鑰；請保留 App 資料並恢復原金鑰圈或可攜備份。")
        raw = None
        for value in values:
            try:
                candidate = base64.b64decode(value, validate=True)
                if len(candidate) != 32:
                    continue
                validate_legacy_key(filename, candidate)
                raw = candidate
                break
            except p.Failure:
                raise
            except Exception:
                continue
        p.require(raw is not None, "storage-integrity", "原金鑰無法驗證舊資料；未遷移或更換金鑰，請保留 App 資料與原金鑰圈。")
    else:
        raw = os.urandom(32)
    descriptor, temporary = tempfile.mkstemp(dir=directory, prefix="storage-key-")
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        # Publish a complete file without overwriting any existing key, even after an interrupted migration.
        os.link(temporary, path, follow_symlinks=False)
        folder = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            os.fsync(folder)
        finally:
            os.close(folder)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return raw


class Database:
    def __init__(self, directory, profile, vault):
        self.directory, self.profile = Path(directory), profile
        p.require(profile == "local" or profile.startswith("google:") and p.is_account(profile[7:]), "invalid-profile", "帳號分區無效。")
        self.lock = threading.RLock()
        self.owner = None
        self.connection = None
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        info = self.directory.lstat()
        p.require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, "native-storage", "App 資料目錄身分或權限無效。")
        try:
            self.owner = os.open(self.directory / "owner.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
            try:
                fcntl.flock(self.owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise p.Failure("workspace-owned", "請使用已開啟的 Work Fleet 視窗。") from error
            filename = self.directory / "fleet.sqlite3"
            existing = filename.exists()
            if existing:
                info = filename.lstat()
                p.require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid(), "native-storage", "App 資料檔案身分無效。")
            raw = storage_key(self.directory, filename, vault)
            self.cipher = AESGCM(raw)
            self.connection = sqlite3.connect(filename, timeout=5, isolation_level=None, check_same_thread=False)
            os.chmod(filename, 0o600)
            self.connection.execute("PRAGMA journal_mode=WAL")
            self.connection.execute("PRAGMA synchronous=FULL")
            version = self.connection.execute("PRAGMA user_version").fetchone()[0]
            p.require(version in (0, 1), "native-version", "本機資料版本較新，請更新 App。")
            self.connection.executescript("""
                CREATE TABLE IF NOT EXISTS records(profile TEXT,kind TEXT,revision INTEGER,data BLOB,PRIMARY KEY(profile,kind));
                CREATE TABLE IF NOT EXISTS attachments(profile TEXT,id TEXT,data BLOB,PRIMARY KEY(profile,id));
                CREATE TABLE IF NOT EXISTS staging(profile TEXT,token TEXT,kind TEXT,digest TEXT,size INTEGER,data BLOB,PRIMARY KEY(profile,token));
                CREATE TABLE IF NOT EXISTS secrets(profile TEXT,kind TEXT,id TEXT,data BLOB,PRIMARY KEY(profile,kind,id));
                CREATE TABLE IF NOT EXISTS credentials(kind TEXT,id TEXT,data BLOB,PRIMARY KEY(kind,id));
                PRAGMA user_version=1;
            """)
            self.connection.execute("DELETE FROM staging WHERE profile=?", (profile,))
        except Exception:
            self.close()
            raise

    def aad(self, kind, key):
        return f"{len(self.profile.encode('utf-8'))}:{self.profile}|{kind}|{key}".encode("utf-8")

    def seal(self, kind, key, data):
        nonce = os.urandom(12)
        return nonce + self.cipher.encrypt(nonce, data, self.aad(kind, key))

    def open(self, kind, key, data):
        try:
            return self.cipher.decrypt(data[:12], data[12:], self.aad(kind, key))
        except Exception as error:
            raise p.Failure("storage-integrity", "資料驗證失敗；請保留 App 資料與本機金鑰後重試。") from error

    def record(self, kind):
        p.require(kind in ("workspace", "journal"), "invalid-record", "儲存種類無效。")
        with self.lock:
            row = self.connection.execute("SELECT data FROM records WHERE profile=? AND kind=?", (self.profile, kind)).fetchone()
            return None if row is None else self.open("record", kind, row[0])

    def attachment(self, key):
        p.require(p.is_digest(key), "invalid-attachment", "附件身分無效。")
        with self.lock:
            row = self.connection.execute("SELECT data FROM attachments WHERE profile=? AND id=?", (self.profile, key)).fetchone()
            return None if row is None else self.open("attachment", key, row[0])

    def secret(self, kind, key, data=None):
        with self.lock:
            if data is not None:
                p.require(len(data) <= 65536, "native-capacity", "原生 metadata 容量超限。")
                self.connection.execute("INSERT OR REPLACE INTO secrets VALUES(?,?,?,?)", (self.profile, kind, key, self.seal("secret:" + kind, key, data)))
                return None
            row = self.connection.execute("SELECT data FROM secrets WHERE profile=? AND kind=? AND id=?", (self.profile, kind, key)).fetchone()
            return None if row is None else self.open("secret:" + kind, key, row[0])

    def forget(self, kind, key):
        with self.lock:
            self.connection.execute("DELETE FROM secrets WHERE profile=? AND kind=? AND id=?", (self.profile, kind, key))

    def stage(self, kind, data, digest):
        maximum = {"workspace": p.RECORD, "journal": p.RECORD, "attachment": p.ATTACHMENT, "backup": p.BACKUP}.get(kind)
        p.require(maximum is not None and len(data) <= maximum and p.digest(data) == digest, "transfer-integrity", "傳輸種類、容量或校驗值不符。")
        if kind in ("workspace", "journal"):
            value = p.decode(data)
            p.require(p.text(value, "profileId") == self.profile, "invalid-profile", "儲存帳號已切換。")
            p.number(value, "revision")
        token = p.identifier()
        with self.lock:
            count, total = self.connection.execute("SELECT COUNT(*),COALESCE(SUM(size),0) FROM staging WHERE profile=?", (self.profile,)).fetchone()
            p.require(count < 20008 and total + len(data) <= 512 * 1024 * 1024, "transfer-busy", "原生傳輸暫存容量已滿。")
            self.connection.execute("INSERT INTO staging VALUES(?,?,?,?,?,?)", (self.profile, token, kind, digest, len(data), self.seal("stage:" + kind, token, data)))
        return token

    def staged(self, token, kind):
        with self.lock:
            row = self.connection.execute("SELECT digest,data FROM staging WHERE profile=? AND token=? AND kind=?", (self.profile, token, kind)).fetchone()
            p.require(row is not None, "transfer-missing", "原生傳輸已失效。")
            return row[0], self.open("stage:" + kind, token, row[1])

    def discard(self, token):
        with self.lock:
            self.connection.execute("DELETE FROM staging WHERE profile=? AND token=?", (self.profile, token))

    def put_attachment(self, token):
        with self.lock:
            digest, data = self.staged(token, "attachment")
            self.connection.execute("INSERT OR IGNORE INTO attachments VALUES(?,?,?)", (self.profile, digest, self.seal("attachment", digest, data)))
            self.discard(token)
            return digest

    def commit(self, kind, token, expected, attachments, replace_attachments=False):
        p.require(kind in ("workspace", "journal") and isinstance(attachments, list) and len(attachments) <= 20000 and len(set(attachments)) == len(attachments), "invalid-record", "提交種類或附件清單無效。")
        p.require(not replace_attachments or (kind == "workspace" and not self.profile.startswith("google:")), "invalid-request", "只有本機工作空間可以清空附件後還原。")
        with self.lock:
            _, data = self.staged(token, kind)
            value = p.decode(data)
            revision = p.number(value, "revision")
            p.require(revision == (0 if expected is None else expected + 1), "revision-conflict", "本機版本競爭，請保留草稿並重新開啟。")
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                current = self.connection.execute("SELECT revision FROM records WHERE profile=? AND kind=?", (self.profile, kind)).fetchone()
                p.require((None if current is None else current[0]) == expected, "revision-conflict", "本機資料已更新，請保留目前草稿。")
                if replace_attachments:
                    self.connection.execute("DELETE FROM attachments WHERE profile=?", (self.profile,))
                for item in attachments:
                    self.put_attachment(item)
                self.connection.execute("INSERT OR REPLACE INTO records VALUES(?,?,?,?)", (self.profile, kind, revision, self.seal("record", kind, data)))
                self.discard(token)
                self.connection.execute("COMMIT")
            except Exception:
                self.connection.execute("ROLLBACK")
                raise

    def reset(self):
        """Deletes this profile's workspace; separately stored Google credentials stay."""
        with self.lock:
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                for table in ("records", "attachments", "staging", "secrets"):
                    self.connection.execute(f"DELETE FROM {table} WHERE profile=?", (self.profile,))
                self.connection.execute("COMMIT")
            except Exception:
                self.connection.execute("ROLLBACK")
                raise
            # Return the freed pages so the deleted notes do not stay behind in the database file.
            self.connection.execute("VACUUM")

    def close(self):
        if self.connection is not None:
            self.connection.close()
            self.connection = None
        if self.owner is not None:
            os.close(self.owner)
            self.owner = None
