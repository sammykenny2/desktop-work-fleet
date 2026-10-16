"""Single-owner encrypted SQLite, with an owner-only local key and legacy keyring migration."""
import base64
from contextlib import closing, contextmanager
import fcntl
import os
from pathlib import Path
import sqlite3
import stat
import tempfile
import threading
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import protocol as p



class Vault:
    """Noninteractive reads/writes, with a separate, user-requested system unlock."""
    UNLOCK_TIMEOUT = 90

    def __init__(self, app_id):
        self.app_id = app_id
        self.base_cancellable = None
        self.request_local = threading.local()
        self.service = None
        self.owner = None
        self.retired_services = []
        self.lock = threading.RLock()
        self.prompt_cancellable = None
        self.closed = threading.Event()

    @property
    def cancellable(self):
        interaction = getattr(self.request_local, "interaction", None)
        return interaction[0] if interaction is not None else self.base_cancellable

    @cancellable.setter
    def cancellable(self, value):
        self.base_cancellable = value

    def check_interaction(self):
        interaction = getattr(self.request_local, "interaction", None)
        p.require(not self.closed.is_set(), "stale-session", "安全儲存工作階段已結束。")
        if interaction is not None:
            cancellable, deadline, owner_closed, action_closed, request_cancelled = interaction
            p.require(not any(event is not None and event.is_set() for event in (owner_closed, action_closed)),
                      "stale-session", "安全儲存工作階段已結束。")
            p.require(time.monotonic() < deadline, "vault-unlock-timeout", "系統解鎖已逾時；同步維持暫停，請按「立即同步」重試。")
            p.require(not cancellable.is_cancelled() and not (request_cancelled is not None and request_cancelled.is_set()),
                      "vault-unlock-cancelled", "已取消或未完成解鎖；同步維持暫停，便箋仍可使用。")

    @contextmanager
    def interaction(self, owner_closed=None, action_closed=None, deadline=None, request_cancelled=None):
        """One deadline/cancellation token for preflight, the system prompt and credential readback."""
        from gi.repository import Gio
        if getattr(self.request_local, "interaction", None) is not None:
            self.check_interaction()
            yield
            self.check_interaction()
            return
        deadline = time.monotonic() + self.UNLOCK_TIMEOUT if deadline is None else deadline
        cancellable = Gio.Cancellable()
        self.request_local.interaction = (cancellable, deadline, owner_closed, action_closed, request_cancelled)
        self.prompt_cancellable = cancellable
        timer = threading.Timer(max(0, deadline - time.monotonic()), cancellable.cancel)
        timer.daemon = True
        try:
            self.check_interaction()
            timer.start()
            yield
            self.check_interaction()
        except Exception:
            # GIO/libsecret errors can wrap cancellation. Preserve the actionable deadline/session reason.
            self.check_interaction()
            raise
        finally:
            timer.cancel()
            self.request_local.interaction = None
            if self.prompt_cancellable is cancellable:
                self.prompt_cancellable = None

    def connect(self):
        self.check_interaction()
        import gi
        gi.require_version("Secret", "1")
        from gi.repository import Gio, GLib, Secret
        if self.cancellable is None:
            self.cancellable = Gio.Cancellable()
        bus = Gio.bus_get_sync(Gio.BusType.SESSION, self.cancellable)
        owner = bus.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetNameOwner",
                              GLib.Variant("(s)", ("org.freedesktop.secrets",)), GLib.VariantType.new("(s)"),
                              Gio.DBusCallFlags.NONE, 5000, self.cancellable).unpack()[0]
        if self.service is None or self.owner != owner:
            # A provider restart invalidates its encrypted session. Open a proxy pinned to the current owner.
            if self.service is not None:
                # libsecret's pending collection callbacks may still reference the former service.
                self.retired_services.append(self.service)
            self.service = Secret.Service.open_sync(Secret.Service.__gtype__, owner, Secret.ServiceFlags.NONE, self.cancellable)
            self.owner = owner
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
        with self.lock:
            values = self.lookup(kind, key, canonical=True)
            return values[0] if values else None

    def legacy_read(self, kind, key):
        values = self.values(kind, key)
        return values[0] if values else None

    def values(self, kind, key):
        with self.lock:
            return self.lookup(kind, key)

    def lookup(self, kind, key, canonical=False):
        try:
            Secret = self.connect()
            if canonical:
                _, collection = self.writable()
                collections = [collection]
            else:
                self.service.load_collections_sync(self.cancellable)
                collections = self.service.get_collections()
            items, locked = [], False
            for collection in collections:
                if self.is_locked(collection):
                    locked = True
                    continue
                # Some providers display their own unlock UI from global SearchItems, without a Prompt object.
                items.extend(collection.search_sync(self.schema, self.attributes(kind, key),
                                                    Secret.SearchFlags.ALL, self.cancellable))
            values = [self.read_item(item) for item in items if not self.is_locked(item, "org.freedesktop.Secret.Item")]
            if values:
                return values
            p.require(not items and not locked, "vault-locked", "系統金鑰圈已鎖定；便箋仍可使用，相關同步或加密備份已暫停。解鎖金鑰圈後重試即可。")
            return []
        except p.Failure:
            raise
        except Exception as error:
            raise p.Failure("vault-unavailable", "系統安全儲存目前無法使用；便箋仍可使用，相關同步或加密備份已暫停。") from error

    def collection(self):
        try:
            Secret = self.connect()
            collection = Secret.Collection.for_alias_sync(self.service, "default", Secret.CollectionFlags.NONE, self.cancellable)
            p.require(collection is not None, "vault-unavailable", "系統尚未設定可保存秘密的金鑰圈；便箋仍可使用。")
            session = Secret.Collection.for_alias_sync(self.service, Secret.COLLECTION_SESSION, Secret.CollectionFlags.NONE, self.cancellable)
            path = collection.get_object_path()
            p.require(path != "/org/freedesktop/secrets/collection/session" and (session is None or path != session.get_object_path()),
                      "vault-unavailable", "預設金鑰圈只保存本次工作階段，無法持久保存登入或備份密碼。")
            return Secret, collection
        except p.Failure:
            raise
        except Exception as error:
            raise p.Failure("vault-unavailable", "系統安全儲存目前無法保存秘密；便箋仍可使用。") from error

    def writable(self):
        try:
            Secret, collection = self.collection()
            p.require(not self.is_locked(collection), "vault-locked", "系統金鑰圈已鎖定；便箋仍可使用，相關同步或加密備份已暫停。")
            return Secret, collection
        except p.Failure:
            raise
        except Exception as error:
            raise p.Failure("vault-unavailable", "系統安全儲存目前無法使用；便箋仍可使用。") from error

    def unlock(self, owner_closed=None, action_closed=None):
        """Explicit UI action only. Password entry belongs to the system's prompt, never to this app."""
        from gi.repository import Gio, GLib
        with self.interaction(owner_closed, action_closed), self.lock:
            self.check_interaction()
            _, collection = self.collection()
            self.check_interaction()
            if not self.is_locked(collection):
                return
            try:
                _, prompt = self.call("/org/freedesktop/secrets", "org.freedesktop.Secret.Service", "Unlock",
                                      GLib.Variant("(ao)", ([collection.get_object_path()],)), "(aoo)").unpack()
            except p.Failure:
                raise
            except Exception as error:
                self.check_interaction()
                raise p.Failure("vault-unavailable", "系統解鎖視窗未能啟動；同步維持暫停，請稍後重試。") from error
            if prompt == "/":
                p.require(not self.is_locked(collection), "vault-unlock-cancelled", "系統未完成解鎖；同步維持暫停。")
                return
            connection, owner = self.service.get_connection(), self.service.get_name_owner()
            completed, result = threading.Event(), []
            def on_completed(_connection, _sender, _path, _interface, _signal, parameters):
                result.append(parameters.unpack()[0])
                completed.set()
            subscription = connection.signal_subscribe(owner, "org.freedesktop.Secret.Prompt", "Completed", prompt,
                                                        None, Gio.DBusSignalFlags.NONE, on_completed)
            try:
                self.check_interaction()
                self.call(prompt, "org.freedesktop.Secret.Prompt", "Prompt", GLib.Variant("(s)", ("",)), "()")
                # libsecret's synchronous prompt waits for Completed even after a successful Dismiss.
                # Bound our own wait so an unresponsive provider cannot keep the bridge request alive.
                while not completed.wait(0.05):
                    self.check_interaction()
                self.check_interaction()
                p.require(not result[0] and not self.is_locked(collection), "vault-unlock-cancelled",
                          "已取消或未完成解鎖；同步維持暫停，便箋仍可使用。")
            except p.Failure:
                raise
            except Exception as error:
                self.check_interaction()
                raise p.Failure("vault-unavailable", "系統解鎖視窗未能完成；同步維持暫停，請稍後重試。") from error
            finally:
                connection.signal_unsubscribe(subscription)
                if not completed.is_set():
                    try:
                        # Best effort only: returning must never depend on Dismiss or Completed.
                        connection.call(owner, prompt, "org.freedesktop.Secret.Prompt", "Dismiss", None, None,
                                        Gio.DBusCallFlags.NONE, 1000, None, None)
                    except Exception:
                        pass

    def cancel_unlock(self):
        cancellable = self.prompt_cancellable
        if cancellable is not None:
            cancellable.cancel()

    def save(self, kind, key, value):
        with self.lock:
            try:
                Secret, collection = self.writable()
                secret = Secret.Value.new(value, -1, "text/plain")
                self.store(collection, kind, key, secret)
                p.require(self.read(kind, key) == value, "vault-unavailable", "系統金鑰圈讀回不符；未確認保存，沒有改存本機檔案。")
            except p.Failure:
                raise
            except Exception as error:
                raise p.Failure("vault-unavailable", "系統安全儲存未確認保存；沒有改存本機檔案。") from error

    def store(self, collection, kind, key, secret):
        from gi.repository import GLib
        self.service.ensure_session_sync(self.cancellable)
        encoded = self.service.encode_dbus_secret(secret)
        attributes = {**self.attributes(kind, key), "xdg:schema": "app.workfleet.native.v1"}
        properties = {"org.freedesktop.Secret.Item.Label": GLib.Variant("s", "Work Fleet " + kind),
                      "org.freedesktop.Secret.Item.Attributes": GLib.Variant("a{ss}", attributes)}
        reply = self.call(collection.get_object_path(), "org.freedesktop.Secret.Collection", "CreateItem",
                          GLib.Variant("(a{sv}(oayays)b)", (properties, encoded.unpack(), True)), "(oo)")
        item, prompt = reply.unpack()
        p.require(prompt == "/" and item != "/", "vault-locked", "系統金鑰圈未完成保存；相關工作已暫停，沒有改存本機檔案。")

    def call(self, path, interface, method, parameters, result):
        from gi.repository import Gio, GLib
        self.check_interaction()
        owner = self.service.get_name_owner()
        p.require(owner is not None, "vault-unavailable", "系統安全儲存服務已停止。")
        return self.service.get_connection().call_sync(owner, path, interface, method, parameters,
                                                       GLib.VariantType.new(result), Gio.DBusCallFlags.NONE, 5000, self.cancellable)

    def is_locked(self, proxy, interface="org.freedesktop.Secret.Collection"):
        from gi.repository import GLib
        # Properties on a libsecret proxy can lag behind a lock, especially outside the UI main context.
        return self.call(proxy.get_object_path(), "org.freedesktop.DBus.Properties", "Get",
                         GLib.Variant("(ss)", (interface, "Locked")), "(v)").unpack()[0]

    def read_item(self, item):
        from gi.repository import GLib
        self.service.ensure_session_sync(self.cancellable)
        reply = self.call(item.get_object_path(), "org.freedesktop.Secret.Item", "GetSecret",
                          GLib.Variant("(o)", (self.service.get_session_dbus_path(),)), "((oayays))")
        # Always fetch and decode a new value: never reuse libsecret's pre-lock or pre-refresh secret cache.
        secret = self.service.decode_dbus_secret(reply.get_child_value(0))
        p.require(secret is not None, "vault-unavailable", "系統安全儲存未能讀取秘密，相關工作已暫停。")
        raw = secret.get()
        p.require(raw is not None and len(raw) <= 65536, "vault-unavailable", "系統安全儲存秘密格式或容量無效，相關工作已暫停。")
        return bytes(raw).decode("utf-8")

    def remove(self, kind, key):
        with self.lock:
            try:
                Secret = self.connect()
                self.service.load_collections_sync(self.cancellable)
                items = []
                for collection in self.service.get_collections():
                    if not self.is_locked(collection):
                        items.extend(collection.search_sync(self.schema, self.attributes(kind, key), Secret.SearchFlags.ALL, self.cancellable))
                for item in items:
                    if not self.is_locked(item, "org.freedesktop.Secret.Item"):
                        reply = self.call(item.get_object_path(), "org.freedesktop.Secret.Item", "Delete", None, "(o)")
                        p.require(reply.unpack()[0] == "/", "vault-locked", "金鑰圈已鎖定；這台裝置的登出狀態仍會保留。")
            except p.Failure:
                raise
            except Exception as error:
                raise p.Failure("vault-unavailable", "系統安全儲存尚未完成移除；這台裝置的登出狀態仍會保留。") from error

    def close(self):
        self.closed.set()
        self.cancel_unlock()
        if self.base_cancellable is not None:
            self.base_cancellable.cancel()


class SystemSecrets:
    """Vault-backed secrets; SQLite contains references, revocations and pending upgrade data only."""
    def __init__(self, database, vault):
        self.database, self.vault = database, vault
        self.lock = threading.RLock()
        self.closed = threading.Event()

    def check(self):
        p.require(not self.closed.is_set() and self.database.connection is not None, "stale-session", "安全儲存工作階段已結束。")

    def close(self):
        self.closed.set()

    @staticmethod
    def identity(scope, kind, key):
        p.require(kind in ("google-account", "backup-key") and isinstance(key, str) and 0 < len(key) <= 256,
                  "invalid-credential", "安全儲存身分無效。")
        if kind == "google-account":
            p.require(scope == "account" and p.is_account(key), "invalid-credential", "Google 憑證身分無效。")
            return key
        p.require(scope == "local" or scope.startswith("google:") and p.is_account(scope[7:]),
                  "invalid-profile", "備份金鑰分區無效。")
        return f"{len(scope.encode('utf-8'))}:{scope}|{key}"

    def reference(self, scope, kind, key):
        return self.database.connection.execute("SELECT state FROM secret_refs WHERE scope=? AND kind=? AND id=?", (scope, kind, key)).fetchone()

    def legacy(self, scope, kind, key):
        if kind == "google-account":
            row = self.database.connection.execute("SELECT data FROM credentials WHERE kind=? AND id=?", (kind, key)).fetchone()
            if row is None:
                return None
            return self.database.cipher.decrypt(row[0][:12], row[0][12:], Credentials.aad(kind, key)).decode("utf-8")
        row = self.database.connection.execute("SELECT data FROM secrets WHERE profile=? AND kind=? AND id=?", (scope, kind, key)).fetchone()
        if row is None:
            return None
        aad = f"{len(scope.encode('utf-8'))}:{scope}|secret:{kind}|{key}".encode("utf-8")
        return self.database.cipher.decrypt(row[0][:12], row[0][12:], aad).decode("utf-8")

    def record(self, scope, kind, key, state):
        connection = self.database.connection
        connection.execute("BEGIN IMMEDIATE")
        try:
            if kind == "google-account":
                removed = connection.execute("DELETE FROM credentials WHERE kind=? AND id=?", (kind, key)).rowcount
            else:
                removed = connection.execute("DELETE FROM secrets WHERE profile=? AND kind=? AND id=?", (scope, kind, key)).rowcount
            connection.execute("INSERT INTO secret_refs VALUES(?,?,?,?,?) ON CONFLICT(scope,kind,id) DO UPDATE SET state=excluded.state,cleanup=MAX(secret_refs.cleanup,excluded.cleanup)",
                               (scope, kind, key, state, int(removed > 0)))
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise
        self.cleanup()

    def cleanup(self):
        connection = self.database.connection
        if not connection.execute("SELECT 1 FROM secret_refs WHERE cleanup=1 LIMIT 1").fetchone():
            return
        # The old ciphertext is decryptable with the local key: remove it from free pages and active WAL too.
        result = connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        p.require(result[0] == 0, "storage-cleanup", "秘密已移至系統安全儲存；舊副本清理尚未完成，請稍後重試。")
        connection.execute("VACUUM")
        result = connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        p.require(result[0] == 0, "storage-cleanup", "秘密已移至系統安全儲存；舊副本清理尚未完成，請稍後重試。")
        connection.execute("UPDATE secret_refs SET cleanup=0 WHERE cleanup=1")

    def read(self, scope, kind, key):
        identity = self.identity(scope, kind, key)
        with self.lock:
            with self.database.lock:
                self.check()
                self.cleanup()
                reference = self.reference(scope, kind, key)
                if reference is not None and reference[0] == "revoked":
                    return None
                try:
                    old = self.legacy(scope, kind, key)
                except Exception as error:
                    raise p.Failure("storage-integrity", "舊版秘密無法驗證；保留原資料，相關同步或加密備份已暫停。") from error
                if kind == "google-account" and old == "":
                    self.record(scope, kind, key, "revoked")
                    return None
                if kind == "backup-key" and reference is None and old is None:
                    return None
            # No database lock is held while the system vault is contacted: local edits remain available.
            if old is None and reference is None and kind == "google-account":
                # Older versions could have saved the same account in another collection. Canonical reads use default only.
                current = self.vault.read(kind, identity)
                if current is None:
                    current = self.vault.legacy_read(kind, identity)
                    if current is not None:
                        self.vault.save(kind, identity, current)
                if current is not None:
                    with self.database.lock:
                        self.check()
                        self.record(scope, kind, key, "active")
            if old is not None:
                self.vault.save(kind, identity, old)
                with self.database.lock:
                    self.check()
                    if self.legacy(scope, kind, key) != old or (self.reference(scope, kind, key) or [None])[0] == "revoked":
                        raise p.Failure("stale-session", "舊版秘密遷移期間資料已變更；未重新啟用秘密。")
                    self.record(scope, kind, key, "active")
            value = self.vault.read(kind, identity)
            with self.database.lock:
                self.check()
            return value

    def save(self, scope, kind, key, value):
        identity = self.identity(scope, kind, key)
        p.require(isinstance(value, str) and len(value.encode("utf-8")) <= 65536, "invalid-credential", "安全儲存容量無效。")
        with self.lock:
            with self.database.lock:
                self.check()
                old = self.legacy(scope, kind, key)
            if old is not None:
                self.read(scope, kind, key)
            self.vault.save(kind, identity, value)
            with self.database.lock:
                self.check()
                self.record(scope, kind, key, "active")

    def remove(self, scope, kind, key):
        identity = self.identity(scope, kind, key)
        with self.lock:
            with self.database.lock:
                self.check()
                # Revocation precedes optional vault cleanup, even when the keyring stays locked.
                self.record(scope, kind, key, "revoked")
            try:
                self.vault.remove(kind, identity)
            except p.Failure:
                pass

    def migrate_pending(self):
        """Worker-only best effort upgrade, called after the owner page is ready."""
        with self.database.lock:
            self.check()
            pending = [("account", kind, key) for kind, key in self.database.connection.execute("SELECT kind,id FROM credentials")]
            pending += [(profile, kind, key) for profile, kind, key in self.database.connection.execute("SELECT profile,kind,id FROM secrets WHERE kind='backup-key'")]
        for scope, kind, key in pending:
            try:
                self.read(scope, kind, key)
            except p.Failure as error:
                if error.code in ("vault-locked", "vault-unavailable"):
                    break
        with self.database.lock:
            self.check()
            return self.database.connection.execute("SELECT COUNT(*) FROM credentials").fetchone()[0] + self.database.connection.execute("SELECT COUNT(*) FROM secrets WHERE kind='backup-key'").fetchone()[0]


class Credentials:
    def __init__(self, database, vault, secrets=None):
        self.secrets = secrets or SystemSecrets(database, vault)

    @staticmethod
    def aad(kind, key):
        return ("credential|" + kind + "|" + key).encode("utf-8")

    def read(self, kind, key):
        return self.secrets.read("account", kind, key)

    def save(self, kind, key, value):
        self.secrets.save("account", kind, key, value)

    def remove(self, kind, key):
        self.secrets.remove("account", kind, key)

    def writable(self):
        self.secrets.vault.writable()

    def interaction(self, action_closed, deadline=None, request_cancelled=None):
        return self.secrets.vault.interaction(self.secrets.closed, action_closed, deadline, request_cancelled)

    def unlock(self, action_closed=None):
        self.secrets.check()
        self.secrets.vault.unlock(self.secrets.closed, action_closed)
        self.secrets.check()

    def cancel_unlock(self):
        self.secrets.vault.cancel_unlock()


def validate_legacy_key(filename, raw):
    cipher = AESGCM(raw)
    # Read-only validation covers every profile before publishing a key or changing SQLite/staging.
    with closing(sqlite3.connect(filename.absolute().as_uri() + "?mode=ro", uri=True)) as connection:
        p.require(connection.execute("PRAGMA user_version").fetchone()[0] in (1, 2),
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
            self.connection.execute("PRAGMA secure_delete=ON")
            version = self.connection.execute("PRAGMA user_version").fetchone()[0]
            p.require(version in (0, 1, 2), "native-version", "本機資料版本較新，請更新 App。")
            self.connection.executescript("""
                CREATE TABLE IF NOT EXISTS records(profile TEXT,kind TEXT,revision INTEGER,data BLOB,PRIMARY KEY(profile,kind));
                CREATE TABLE IF NOT EXISTS attachments(profile TEXT,id TEXT,data BLOB,PRIMARY KEY(profile,id));
                CREATE TABLE IF NOT EXISTS staging(profile TEXT,token TEXT,kind TEXT,digest TEXT,size INTEGER,data BLOB,PRIMARY KEY(profile,token));
                CREATE TABLE IF NOT EXISTS secrets(profile TEXT,kind TEXT,id TEXT,data BLOB,PRIMARY KEY(profile,kind,id));
                CREATE TABLE IF NOT EXISTS credentials(kind TEXT,id TEXT,data BLOB,PRIMARY KEY(kind,id));
                CREATE TABLE IF NOT EXISTS secret_refs(scope TEXT,kind TEXT,id TEXT,state TEXT,cleanup INTEGER,PRIMARY KEY(scope,kind,id));
                PRAGMA user_version=2;
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

    def recovery(self, kind, from_version):
        p.require(kind in ("workspace", "journal") and type(from_version) is int and 1 <= from_version <= p.SAFE_INTEGER,
                  "invalid-migration", "資料升級版本無效。")
        with self.lock:
            key = f"migration:{kind}:{from_version}"
            row = self.connection.execute("SELECT data FROM records WHERE profile=? AND kind=?", (self.profile, key)).fetchone()
            return None if row is None else self.open("record", key, row[0])

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

    def commit(self, kind, token, expected, attachments, replace_attachments=False, migration_from=None):
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
                p.require(migration_from is None or current is not None, "invalid-migration", "找不到原始資料。")
                if current is not None:
                    previous = self.record(kind)
                    before = p.decode(previous)
                    if migration_from is not None:
                        p.require(type(migration_from) is int and migration_from >= 1 and not replace_attachments and not attachments
                                  and p.number(before, "schemaVersion") == migration_from
                                  and p.number(value, "schemaVersion") > migration_from, "invalid-migration", "資料升級版本與原始資料不同。")
                        key = f"migration:{kind}:{migration_from}"
                        self.connection.execute("INSERT INTO records VALUES(?,?,?,?)", (self.profile, key, expected, self.seal("record", key, previous)))
                    else:
                        old_schema, new_schema = before.get("schemaVersion"), value.get("schemaVersion")
                        p.require((type(old_schema), old_schema) == (type(new_schema), new_schema), "migration-required", "資料升級需要安全保存原始副本。")
                if replace_attachments:
                    self.connection.execute("DELETE FROM attachments WHERE profile=?", (self.profile,))
                    self.connection.execute("DELETE FROM records WHERE profile=? AND kind LIKE 'migration:workspace:%'", (self.profile,))
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
                self.connection.execute("UPDATE secret_refs SET state='revoked' WHERE scope=? AND kind='backup-key'", (self.profile,))
                self.connection.execute("COMMIT")
            except Exception:
                self.connection.execute("ROLLBACK")
                raise
            # Return the freed pages so the deleted notes do not stay behind in the database file.
            self.connection.execute("VACUUM")

    def close(self):
        with self.lock:
            if self.connection is not None:
                self.connection.close()
                self.connection = None
            if self.owner is not None:
                os.close(self.owner)
                self.owner = None
