"""Single-owner encrypted SQLite transactions, with the key in Secret Service."""
import base64
import fcntl
import os
from pathlib import Path
import sqlite3
import stat
import threading

import gi
gi.require_version("Secret", "1")
from gi.repository import Gio, Secret
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import protocol as p


class Vault:
    def __init__(self, app_id):
        self.app_id = app_id
        self.cancellable = Gio.Cancellable()
        self.schema = Secret.Schema.new("app.workfleet.native.v1", Secret.SchemaFlags.NONE, {
            "application": Secret.SchemaAttributeType.STRING,
            "kind": Secret.SchemaAttributeType.STRING,
            "id": Secret.SchemaAttributeType.STRING,
        })

    def attributes(self, kind, key):
        return {"application": self.app_id, "kind": kind, "id": key}

    def read(self, kind, key):
        try:
            return Secret.password_lookup_sync(self.schema, self.attributes(kind, key), self.cancellable)
        except Exception as error:
            raise p.Failure("vault-unavailable", "無法開啟系統金鑰圈；請解鎖後重試，未改存明文。") from error

    def save(self, kind, key, value):
        try:
            p.require(Secret.password_store_sync(self.schema, self.attributes(kind, key), Secret.COLLECTION_DEFAULT, "Work Fleet " + kind, value, self.cancellable), "vault-unavailable", "系統金鑰圈未確認保存。")
        except p.Failure:
            raise
        except Exception as error:
            raise p.Failure("vault-unavailable", "無法保存系統金鑰圈，未改存明文。") from error

    def remove(self, kind, key):
        try:
            Secret.password_clear_sync(self.schema, self.attributes(kind, key), self.cancellable)
        except Exception as error:
            raise p.Failure("vault-unavailable", "金鑰圈尚未完成移除。") from error


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
            key = vault.read("storage-key", "v1")
            if key is None:
                p.require(not existing, "vault-unavailable", "現有資料缺少原金鑰；請保留資料並恢復系統金鑰圈。")
                key = base64.b64encode(os.urandom(32)).decode("ascii")
                vault.save("storage-key", "v1", key)
            raw = base64.b64decode(key, validate=True)
            p.require(len(raw) == 32, "vault-unavailable", "系統金鑰格式無效。")
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
            raise p.Failure("storage-integrity", "資料驗證失敗；請保留原資料與金鑰圈後重試。") from error

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

    def commit(self, kind, token, expected, attachments):
        p.require(kind in ("workspace", "journal") and isinstance(attachments, list) and len(attachments) <= 20000 and len(set(attachments)) == len(attachments), "invalid-record", "提交種類或附件清單無效。")
        with self.lock:
            _, data = self.staged(token, kind)
            value = p.decode(data)
            revision = p.number(value, "revision")
            p.require(revision == (0 if expected is None else expected + 1), "revision-conflict", "本機版本競爭，請保留草稿並重新開啟。")
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                current = self.connection.execute("SELECT revision FROM records WHERE profile=? AND kind=?", (self.profile, kind)).fetchone()
                p.require((None if current is None else current[0]) == expected, "revision-conflict", "本機資料已更新，請保留目前草稿。")
                for item in attachments:
                    self.put_attachment(item)
                self.connection.execute("INSERT OR REPLACE INTO records VALUES(?,?,?,?)", (self.profile, kind, revision, self.seal("record", kind, data)))
                self.discard(token)
                self.connection.execute("COMMIT")
            except Exception:
                self.connection.execute("ROLLBACK")
                raise

    def reset(self):
        """Deletes everything this profile keeps on the device; Google credentials live in Secret Service and stay."""
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
