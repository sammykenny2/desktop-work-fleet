"""Linux local keys, real AES-GCM migration and credentials; no user data or keyring."""
import base64
import ast
from contextlib import closing
import importlib.util
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"
# google.py and service.py import the host's string table, text.py, from their own folder.
sys.path.insert(0, str(NATIVE))
import text  # noqa: E402


class FakeSecret(types.ModuleType):
    SchemaFlags = types.SimpleNamespace(DONT_MATCH_NAME=2)
    SchemaAttributeType = types.SimpleNamespace(STRING=0)
    ServiceFlags = types.SimpleNamespace(NONE=0)
    CollectionFlags = types.SimpleNamespace(NONE=0)
    COLLECTION_SESSION = "session"
    SearchFlags = types.SimpleNamespace(ALL=2, UNLOCK=4, LOAD_SECRETS=8)

    def __init__(self):
        super().__init__("Secret")
        self.items, self.searches = [], []
        self.unavailable = self.locked = False
        self.bad_readback = False
        self.default_path = "/org/freedesktop/secrets/collection/login"
        self.session_path = "/org/freedesktop/secrets/collection/session"
        self.Collection = types.SimpleNamespace(for_alias_sync=lambda _service, alias, *_: self.collection(
            self.session_path if alias == "session" else self.default_path))
        self.Value = types.SimpleNamespace(new=lambda value, *_: value)
        secret = self
        self.Schema = types.SimpleNamespace(new=lambda name, flags, attributes: types.SimpleNamespace(flags=flags))
        self.Service = types.SimpleNamespace(get_sync=lambda *_: self)

    def collection(self, path):
        def locked():
            items = [i for i in self.items if i.get("collection", self.default_path) == path]
            return self.locked or bool(items) and all(i["locked"] for i in items)
        def search(schema, attributes, flags, cancellable):
            found = self.search_items(schema, attributes, flags, cancellable)
            paths = {self.item_path(i) for i in self.items if i.get("collection", self.default_path) == path}
            return [item for item in found if item.get_object_path() in paths]
        return types.SimpleNamespace(get_locked=locked, get_object_path=lambda: path, search_sync=search)

    def load_collections_sync(self, *_):
        if self.unavailable:
            raise RuntimeError("unavailable")

    def get_collections(self):
        paths = dict.fromkeys([self.default_path] + [i.get("collection", self.default_path) for i in self.items])
        return [self.collection(path) for path in paths]

    def search_sync(self, *_):
        raise AssertionError("global SearchItems could trigger provider unlock UI")

    def search_items(self, schema, attributes, flags, _cancellable):
        if self.unavailable:
            raise RuntimeError("no Secret Service")
        assert schema.flags == self.SchemaFlags.DONT_MATCH_NAME
        assert not flags & self.SearchFlags.UNLOCK, "startup must never request an unlock"
        self.searches.append(flags)
        found = [item for item in self.items if all(item["attributes"].get(k) == v for k, v in attributes.items())]
        return [types.SimpleNamespace(get_locked=lambda item=item: item["locked"] or self.locked,
                                     get_object_path=lambda item=item: self.item_path(item),
                                     get_secret=lambda item=item: None if item["locked"] or self.locked or self.bad_readback else types.SimpleNamespace(get_text=lambda: item["value"]))
                for item in found]

    def item_path(self, item):
        return item.get("path", item.get("collection", self.default_path) + "/item_" + str(id(item)))


    def store_sync(self, schema, attributes, collection, label, value, cancellable):
        if self.unavailable:
            raise RuntimeError("no Secret Service")
        if self.locked:
            return False
        self.items = [item for item in self.items if item["attributes"] != attributes or item["locked"] or item.get("collection", self.default_path) != collection]
        self.items.append({"attributes": dict(attributes), "value": value, "locked": False, "collection": collection})
        return True

    def clear_sync(self, schema, attributes, cancellable):
        if self.unavailable:
            raise RuntimeError("no Secret Service")
        self.items = [item for item in self.items if item["attributes"] != attributes or item["locked"] or self.locked]
        return True


def load_database(secret, real_crypto=False):
    stubs = {}
    if not real_crypto:
        aead = types.ModuleType("cryptography.hazmat.primitives.ciphers.aead")
        aead.AESGCM = lambda key: types.SimpleNamespace(key=key)
        stubs = {"cryptography": types.ModuleType("cryptography"),
                 "cryptography.hazmat": types.ModuleType("cryptography.hazmat"),
                 "cryptography.hazmat.primitives": types.ModuleType("cryptography.hazmat.primitives"),
                 "cryptography.hazmat.primitives.ciphers": types.ModuleType("cryptography.hazmat.primitives.ciphers"),
                 "cryptography.hazmat.primitives.ciphers.aead": aead}
    previous = {name: sys.modules.get(name) for name in [*stubs, "protocol", "datafailure"]}
    try:
        spec = importlib.util.spec_from_file_location("protocol", NATIVE / "protocol.py")
        protocol = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(protocol)
        sys.modules.update(stubs, protocol=protocol)
        spec = importlib.util.spec_from_file_location("datafailure", NATIVE / "datafailure.py")
        failures = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(failures)
        sys.modules["datafailure"] = failures
        spec = importlib.util.spec_from_file_location("database", NATIVE / "database.py")
        database = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(database)
        def connect(vault):
            vault.service = secret
            vault.schema = secret.Schema.new("app.workfleet.native.v1", secret.SchemaFlags.DONT_MATCH_NAME, {})
            return secret
        database.Vault.connect = connect
        database.Vault.is_locked = lambda _vault, proxy, *_: proxy.get_locked()
        def read_item(vault, item):
            secret = item.get_secret()
            protocol.require(secret is not None, "vault-unavailable", "no secret")
            return secret.get_text()
        database.Vault.read_item = read_item
        def store(vault, collection, kind, key, value):
            protocol.require(secret.store_sync(vault.schema, vault.attributes(kind, key), collection.get_object_path(), "fixture", value, None), "vault-locked", "locked")
        def remove(vault, kind, key):
            try:
                secret.clear_sync(vault.schema, vault.attributes(kind, key), None)
            except Exception as error:
                raise protocol.Failure("vault-unavailable", "unavailable") from error
        database.Vault.store, database.Vault.remove = store, remove
        return database, protocol
    finally:
        for name, module in previous.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


@unittest.skipIf(sys.platform == "win32", "the Linux host needs fcntl")
class LinuxVaultTests(unittest.TestCase):
    APP = "app.workfleet.test"

    def setUp(self):
        try:
            import cryptography
        except ImportError:
            self.skipTest("python3-cryptography is required for real AES-GCM migration tests")
        self.secret = FakeSecret()
        self.module, self.protocol = load_database(self.secret, real_crypto=True)
        self.vault = self.module.Vault(self.APP)
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.directory = Path(folder.name) / "WorkFleet"

    def open(self, profile="local"):
        database = self.module.Database(self.directory, profile, self.vault)
        self.addCleanup(database.close)
        return database

    def item(self, kind, key, value, locked=False):
        self.secret.items.append({"attributes": {"application": self.APP, "kind": kind, "id": key}, "value": value, "locked": locked})

    def legacy_data(self):
        db = self.open()
        for profile in ("local", "google:fixture"):
            db.profile = profile
            db.connection.execute("INSERT INTO records VALUES(?,?,?,?)", (profile, "workspace", 0, db.seal("record", "workspace", b"private notes")))
            db.connection.execute("INSERT INTO attachments VALUES(?,?,?)", (profile, "a" * 64, db.seal("attachment", "a" * 64, b"attachment")))
            db.secret("backup-key", "fixture", b"backup password")
            db.stage("attachment", b"pending", self.protocol.digest(b"pending"))
        db.close()
        raw = (self.directory / "storage-key").read_bytes()
        (self.directory / "storage-key").unlink()
        self.item("storage-key", "v1", base64.b64encode(raw).decode("ascii"))
        return raw

    def failure(self, code):
        with self.assertRaises(self.protocol.Failure) as raised:
            self.open()
        self.assertEqual(raised.exception.code, code)
        self.assertFalse((self.directory / "storage-key").exists())
        return str(raised.exception)

    def test_first_run_and_reopen_do_not_contact_keyring(self):
        self.secret.unavailable = True
        db = self.open()
        db.secret("backup-key", "fixture", b"private backup password")
        db.close()
        path = self.directory / "storage-key"
        raw = path.read_bytes()
        self.assertEqual(len(raw), 32)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.open().secret("backup-key", "fixture"), b"private backup password")
        self.assertEqual(path.read_bytes(), raw)
        self.assertEqual(self.secret.searches, [])

    def test_locked_legacy_key_without_database_does_not_block_new_directory(self):
        self.item("storage-key", "v1", "locked", locked=True)
        self.open()
        self.assertEqual(len(self.secret.items), 1)
        self.assertEqual(self.secret.searches, [])

    def test_unlocked_legacy_migrates_all_profiles_then_works_without_keyring(self):
        raw = self.legacy_data()
        self.item("storage-key", "v1", "locked duplicate", locked=True)
        db = self.open()
        self.assertEqual(db.record("workspace"), b"private notes")
        self.assertEqual(db.secret("backup-key", "fixture"), b"backup password")
        self.assertEqual((self.directory / "storage-key").read_bytes(), raw)
        self.assertEqual(self.secret.searches, [2])
        db.close()
        self.secret.unavailable = True
        cloud = self.open("google:fixture")
        self.assertEqual(cloud.record("workspace"), b"private notes")
        self.assertEqual(cloud.attachment("a" * 64), b"attachment")

    def test_locked_legacy_keeps_database_and_staging_without_prompt(self):
        self.legacy_data()
        self.secret.items[0]["locked"] = True
        before = (self.directory / "fleet.sqlite3").read_bytes()
        self.assertIn("locked", self.failure("vault-locked"))
        self.assertEqual((self.directory / "fleet.sqlite3").read_bytes(), before)
        self.assertEqual(self.secret.searches, [])

    def test_locked_provider_is_checked_before_any_search(self):
        db = self.open()
        self.secret.locked = True
        for action in (lambda: self.module.Credentials(db, self.vault).read("google-account", "fixture"),
                       lambda: self.vault.values("storage-key", "v1")):
            with self.assertRaises(self.protocol.Failure) as error:
                action()
            self.assertEqual(error.exception.code, "vault-locked")
        self.assertEqual(self.secret.searches, [])

    def test_missing_legacy_key_keeps_database(self):
        self.legacy_data()
        self.secret.items.clear()
        before = (self.directory / "fleet.sqlite3").read_bytes()
        self.assertIn("original key is missing", self.failure("vault-unavailable"))
        self.assertEqual((self.directory / "fleet.sqlite3").read_bytes(), before)

    def test_unavailable_legacy_keeps_database(self):
        self.legacy_data()
        self.secret.unavailable = True
        self.failure("vault-unavailable")

    def test_wrong_legacy_key_is_not_published_and_retry_preserves_notes(self):
        raw = self.legacy_data()
        self.secret.items[0]["value"] = base64.b64encode(os.urandom(32)).decode("ascii")
        before = (self.directory / "fleet.sqlite3").read_bytes()
        self.failure("storage-integrity")
        self.assertEqual((self.directory / "fleet.sqlite3").read_bytes(), before)
        self.secret.items[0]["value"] = base64.b64encode(raw).decode("ascii")
        self.assertEqual(self.open().record("workspace"), b"private notes")

    def test_unlocked_duplicate_keys_choose_the_one_that_decrypts_all_data(self):
        raw = self.legacy_data()
        self.item("storage-key", "v1", base64.b64encode(os.urandom(32)).decode("ascii"))
        self.secret.items.reverse()
        self.assertEqual(self.open().record("workspace"), b"private notes")
        self.assertEqual((self.directory / "storage-key").read_bytes(), raw)
        self.assertEqual(len(self.secret.items), 2)

    def test_corrupt_other_profile_prevents_migration(self):
        self.legacy_data()
        with closing(sqlite3.connect(self.directory / "fleet.sqlite3")) as connection:
            connection.execute("UPDATE attachments SET data=? WHERE profile='google:fixture'", (b"corrupt",))
            connection.commit()
        self.failure("storage-integrity")

    def test_invalid_legacy_key_is_not_published(self):
        self.legacy_data()
        for value in ("not base64!", base64.b64encode(b"short").decode("ascii")):
            self.secret.items[0]["value"] = value
            with self.subTest(value=value):
                with self.assertRaises(self.protocol.Failure):
                    self.open()
                self.assertFalse((self.directory / "storage-key").exists())

    def test_key_publication_failure_leaves_database_unchanged_and_retryable(self):
        self.legacy_data()
        before = (self.directory / "fleet.sqlite3").read_bytes()
        with patch.object(self.module.os, "link", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.open()
        self.assertFalse((self.directory / "storage-key").exists())
        self.assertEqual(list(self.directory.glob("storage-key-*")), [])
        self.assertEqual((self.directory / "fleet.sqlite3").read_bytes(), before)
        self.assertEqual(self.open().record("workspace"), b"private notes")

    def test_symlink_permissive_or_invalid_local_key_is_rejected_without_replacement(self):
        db = self.open()
        db.close()
        path = self.directory / "storage-key"
        raw = path.read_bytes()
        path.chmod(0o644)
        with self.assertRaises(self.protocol.Failure):
            self.open()
        self.assertEqual(path.read_bytes(), raw)
        path.chmod(0o600)
        path.write_bytes(b"invalid")
        with self.assertRaises(self.protocol.Failure):
            self.open()
        target = self.directory / "target"
        target.write_bytes(raw)
        path.unlink()
        path.symlink_to(target)
        with self.assertRaises(self.protocol.Failure):
            self.open()
        self.assertEqual(target.read_bytes(), raw)
        self.assertEqual(self.secret.searches, [])

    def test_credentials_use_system_vault_and_survive_workspace_reset(self):
        db = self.open()
        vault = self.module.Credentials(db, self.vault)
        vault.save("google-account", "fixture", "synthetic refresh token")
        self.assertEqual(db.connection.execute("SELECT COUNT(*) FROM credentials").fetchone()[0], 0)
        self.assertEqual(vault.read("google-account", "fixture"), "synthetic refresh token")
        db.reset()
        self.assertEqual(vault.read("google-account", "fixture"), "synthetic refresh token")
        self.secret.unavailable = True
        with self.assertRaises(self.protocol.Failure):
            vault.read("google-account", "fixture")
        self.secret.unavailable = False
        self.assertEqual(vault.read("google-account", "fixture"), "synthetic refresh token")

    def test_signout_tombstone_prevents_legacy_reimport_after_restart(self):
        db = self.open()
        self.item("google-account", "fixture", "legacy token", locked=True)
        vault = self.module.Credentials(db, self.vault)
        vault.remove("google-account", "fixture")
        db.reset()
        db.close()
        self.secret.items[0]["locked"] = False
        vault = self.module.Credentials(self.open(), self.vault)
        self.assertIsNone(vault.read("google-account", "fixture"))
        self.assertEqual(self.secret.searches, [])
        self.assertEqual(len(self.secret.items), 1)

    def test_locked_credentials_allow_offline_work_and_resume_after_unlock(self):
        db = self.open()
        self.item("google-account", "fixture", "legacy token", locked=True)
        vault = self.module.Credentials(db, self.vault)
        with self.assertRaises(self.protocol.Failure) as error:
            vault.read("google-account", "fixture")
        self.assertEqual(error.exception.code, "vault-locked")
        db.secret("offline", "fixture", b"offline still works")
        self.secret.locked = True
        with self.assertRaises(self.protocol.Failure):
            vault.save("google-account", "fixture", "new token")
        self.assertEqual(db.connection.execute("SELECT COUNT(*) FROM credentials").fetchone()[0], 0)
        self.secret.locked = False
        self.secret.items[0]["locked"] = False
        vault.save("google-account", "fixture", "new token")
        self.assertEqual(vault.read("google-account", "fixture"), "new token")

    def local_credential(self, db, value):
        nonce = os.urandom(12)
        encrypted = nonce + db.cipher.encrypt(nonce, value.encode(), self.module.Credentials.aad("google-account", "fixture"))
        db.connection.execute("INSERT INTO credentials VALUES(?,?,?)", ("google-account", "fixture", encrypted))
        return encrypted

    def test_pending_local_credentials_never_bypass_locked_vault_and_are_scrubbed_after_migration(self):
        db = self.open()
        encrypted = self.local_credential(db, "pending token")
        vault = self.module.Credentials(db, self.vault)
        self.secret.locked = True
        with self.assertRaises(self.protocol.Failure):
            vault.read("google-account", "fixture")
        self.assertEqual(db.connection.execute("SELECT data FROM credentials").fetchone()[0], encrypted)
        self.secret.locked = False
        self.assertEqual(vault.read("google-account", "fixture"), "pending token")
        self.assertEqual(db.connection.execute("SELECT COUNT(*) FROM credentials").fetchone()[0], 0)
        for name in ("fleet.sqlite3", "fleet.sqlite3-wal"):
            file = self.directory / name
            if file.exists():
                self.assertNotIn(encrypted, file.read_bytes())

    def test_failed_vault_readback_preserves_pending_copy_and_retry_is_safe(self):
        db = self.open()
        encrypted = self.local_credential(db, "pending token")
        vault = self.module.Credentials(db, self.vault)
        self.secret.bad_readback = True
        with self.assertRaises(self.protocol.Failure):
            vault.read("google-account", "fixture")
        self.assertEqual(db.connection.execute("SELECT data FROM credentials").fetchone()[0], encrypted)
        self.secret.bad_readback = False
        self.assertEqual(vault.read("google-account", "fixture"), "pending token")

    def test_session_default_cannot_delete_pending_secrets(self):
        db = self.open()
        encrypted = self.local_credential(db, "pending token")
        db.secret("backup-key", "fixture", b"pending password")
        secrets = self.module.SystemSecrets(db, self.vault)
        for path in (self.secret.session_path, "/org/freedesktop/secrets/collection/temporary"):
            self.secret.default_path = self.secret.session_path = path
            for scope, kind in (("account", "google-account"), ("local", "backup-key")):
                with self.assertRaises(self.protocol.Failure) as error:
                    secrets.read(scope, kind, "fixture")
                self.assertEqual(error.exception.code, "vault-unavailable")
        self.assertEqual(db.connection.execute("SELECT data FROM credentials").fetchone()[0], encrypted)
        self.assertEqual(db.secret("backup-key", "fixture"), b"pending password")
        self.assertEqual(self.secret.items, [])

    def test_duplicate_credentials_read_and_verify_only_persistent_default(self):
        db = self.open()
        self.item("google-account", "fixture", "stale token")
        self.secret.items[0]["collection"] = "/org/freedesktop/secrets/collection/old"
        self.secret.items[0]["path"] = "/custom/items/stale"
        vault = self.module.Credentials(db, self.vault)
        self.assertEqual(vault.read("google-account", "fixture"), "stale token")
        vault.save("google-account", "fixture", "new token")
        self.secret.items[-1]["path"] = "/custom/items/current"
        self.assertEqual(vault.read("google-account", "fixture"), "new token")
        self.assertEqual(self.secret.items[0]["value"], "stale token")
        self.secret.locked = True
        with self.assertRaises(self.protocol.Failure):
            vault.read("google-account", "fixture")

    def test_existing_default_credential_wins_before_first_reference_is_recorded(self):
        db = self.open()
        self.item("google-account", "fixture", "stale token")
        self.secret.items[0]["collection"] = "/org/freedesktop/secrets/collection/old"
        self.item("google-account", "fixture", "current token")
        vault = self.module.Credentials(db, self.vault)
        self.assertEqual(vault.read("google-account", "fixture"), "current token")
        self.assertEqual(self.vault.read("google-account", "fixture"), "current token")
        self.assertEqual(len(self.secret.items), 2)

    def test_signout_discards_pending_copy_even_when_vault_is_unavailable(self):
        db = self.open()
        self.local_credential(db, "must not return")
        self.item("google-account", "fixture", "legacy token")
        self.secret.unavailable = True
        vault = self.module.Credentials(db, self.vault)
        vault.remove("google-account", "fixture")
        self.assertEqual(db.connection.execute("SELECT COUNT(*) FROM credentials").fetchone()[0], 0)
        db.reset()
        db.close()
        self.secret.unavailable = False
        self.assertIsNone(self.module.Credentials(self.open(), self.vault).read("google-account", "fixture"))

    def test_backup_password_migrates_with_profile_binding_and_reset_revokes_it(self):
        db = self.open()
        db.secret("backup-key", "fixture", b"old backup password")
        secret = self.module.SystemSecrets(db, self.vault)
        self.assertEqual(secret.read("local", "backup-key", "fixture"), "old backup password")
        self.assertIsNone(db.secret("backup-key", "fixture"))
        self.assertIsNone(secret.read("google:fixture", "backup-key", "fixture"))
        secret.save("google:fixture", "backup-key", "fixture", "other profile password")
        self.assertEqual(secret.read("google:fixture", "backup-key", "fixture"), "other profile password")
        self.secret.locked = True
        with self.assertRaises(self.protocol.Failure):
            secret.read("local", "backup-key", "fixture")
        db.reset()
        self.secret.locked = False
        self.assertIsNone(secret.read("local", "backup-key", "fixture"))
        self.assertEqual(secret.read("google:fixture", "backup-key", "fixture"), "other profile password")

    def test_slow_vault_does_not_hold_workspace_database_lock(self):
        db = self.open()
        self.item("google-account", "fixture", "token")
        secret = self.module.SystemSecrets(db, self.vault)
        entered, release = threading.Event(), threading.Event()
        original = self.vault.read
        def slow(kind, key):
            entered.set()
            release.wait(5)
            return original(kind, key)
        self.vault.read = slow
        errors = []
        def read():
            try:
                secret.read("account", "google-account", "fixture")
            except Exception as error:
                errors.append(error)
        worker = threading.Thread(target=read)
        worker.start()
        try:
            self.assertTrue(entered.wait(2))
            self.assertTrue(db.lock.acquire(timeout=0.5))
            try:
                db.secret("offline", "fixture", b"editable during vault wait")
            finally:
                db.lock.release()
        finally:
            release.set()
            worker.join(5)
        self.assertEqual(errors, [])

    def test_local_tombstone_migrates_without_contacting_unavailable_vault(self):
        db = self.open()
        self.local_credential(db, "")
        self.secret.unavailable = True
        vault = self.module.Credentials(db, self.vault)
        self.assertIsNone(vault.read("google-account", "fixture"))
        self.assertEqual(self.secret.searches, [])
        self.assertEqual(db.connection.execute("SELECT state FROM secret_refs").fetchone()[0], "revoked")

    def test_metadata_commit_failure_keeps_pending_ciphertext_retryable(self):
        db = self.open()
        old = self.local_credential(db, "pending token")
        vault = self.module.Credentials(db, self.vault)
        db.connection.execute("CREATE TRIGGER fail_ref BEFORE INSERT ON secret_refs BEGIN SELECT RAISE(ABORT,'disk full'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            vault.read("google-account", "fixture")
        self.assertEqual(db.connection.execute("SELECT data FROM credentials").fetchone()[0], old)
        db.connection.execute("DROP TRIGGER fail_ref")
        self.assertEqual(vault.read("google-account", "fixture"), "pending token")

    def test_backup_vault_lock_pauses_before_reading_or_exporting_backup_bytes(self):
        db = self.open()
        spec = importlib.util.spec_from_file_location("backup_probe", NATIVE / "backup.py")
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"protocol": self.protocol}):
            spec.loader.exec_module(module)
        secrets = self.module.SystemSecrets(db, self.vault)
        backup = module.Backup(db, None, secrets)
        def upload(*_):
            self.fail("locked vault must not read backup bytes")
        self.secret.locked = True
        with self.assertRaises(self.protocol.Failure) as error:
            backup.invoke("backup.key.create", {"password": "synthetic backup password"}, upload, None)
        self.assertEqual(error.exception.code, "backup-vault-unavailable")
        self.secret.locked = False
        key = backup.invoke("backup.key.create", {"password": "synthetic backup password"}, upload, None)["keyId"]
        self.assertIsNone(db.secret("backup-key", key))
        self.secret.locked = True
        with self.assertRaises(self.protocol.Failure) as error:
            backup.invoke("backup.encrypt", {"keyId": key}, upload, None)
        self.assertEqual(error.exception.code, "backup-vault-unavailable")

    def test_probe_refuses_a_non_private_bus_before_connecting(self):
        environment = {**os.environ, "XDG_DATA_HOME": str(self.directory / "data"),
                       "XDG_RUNTIME_DIR": str(self.directory / "runtime"), "PYTHONOPTIMIZE": "1"}
        probe = NATIVE.parents[2] / "tests/native/linux/storage_probe.py"
        result = subprocess.run([sys.executable, "-B", str(probe), str(self.directory)],
                                env=environment, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires its own dbus-run-session wrapper", result.stderr)

    def service(self, db):
        modules = {"protocol": self.protocol, "database": self.module}
        with patch.dict(sys.modules, modules):
            for name in ("backup", "google", "service"):
                spec = importlib.util.spec_from_file_location(name, NATIVE / (name + ".py"))
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                modules[name] = module
                sys.modules[name] = module
            return modules["service"].Service(db, self.vault, {}, None, None)

    def test_host_info_reports_the_display_language_and_language_set_reaches_the_owner(self):
        service = self.service(self.open())
        info = service.invoke("host.info", {})
        self.assertEqual((info["capabilities"]["languagePreference"], info["language"], info["desktopReason"]), (False, None, None))
        calls = []
        service.language = lambda: {"preference": "zh-TW", "system": ["zh-TW", "en-US"]}
        service.shell = lambda method, args: (calls.append((method, args)), {"preference": args["preference"], "system": ["zh-TW", "en-US"]})[1]
        service.desktop_reason = "reason.desktopUnsupported"
        info = service.invoke("host.info", {})
        self.assertTrue(info["capabilities"]["languagePreference"])
        self.assertEqual(info["language"], {"preference": "zh-TW", "system": ["zh-TW", "en-US"]})
        self.assertEqual(info["desktopReason"], text.t("reason.desktopUnsupported"))
        self.assertEqual(service.invoke("host.language.set", {"preference": "en"}), {"preference": "en", "system": ["zh-TW", "en-US"]})
        self.assertEqual(calls, [("host.language.set", {"preference": "en"})])

    def test_slow_backup_vault_does_not_block_owner_storage_bridge(self):
        db = self.open()
        service = self.service(db)
        entered, release, completed = threading.Event(), threading.Event(), threading.Event()
        original = self.vault.save
        def slow(*args):
            entered.set()
            release.wait(5)
            return original(*args)
        self.vault.save = slow
        errors = []
        def backup():
            try:
                service.invoke("backup.key.create", {"password": "synthetic backup password"})
            except Exception as error:
                errors.append(error)
        def storage():
            try:
                data = self.protocol.encode({"profileId": "local", "revision": 0, "text": "editable during backup vault wait"})
                token = db.stage("workspace", data, self.protocol.digest(data))
                service.staged.add(token)
                service.invoke("storage.commit", {"kind": "workspace", "token": token, "expectedRevision": None})
                self.assertIsNotNone(service.invoke("storage.load", {"kind": "workspace"}))
                completed.set()
            except Exception as error:
                errors.append(error)
        worker = threading.Thread(target=backup)
        worker.start()
        editor = threading.Thread(target=storage)
        try:
            self.assertTrue(entered.wait(2))
            editor.start()
            self.assertTrue(completed.wait(1), f"vault wait blocked owner storage commit/load: {errors}")
        finally:
            release.set()
            worker.join(5)
            if editor.ident is not None:
                editor.join(5)
        self.assertEqual(errors, [])

    def test_vault_backups_are_dispatched_away_from_storage_worker(self):
        tree = ast.parse((NATIVE / "host.py").read_text())
        assignment = next(node for node in ast.walk(tree) if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "worker" for target in node.targets))
        expression = compile(ast.Expression(assignment.value), "host-worker", "eval")
        host = types.SimpleNamespace(network=object(), storage=object())
        for method in ("google.status", "google.unlockVault", "google.signOut", "backup.key.create", "backup.encrypt"):
            self.assertIs(eval(expression, {"self": host, "method": method}), host.network)
        for method in ("storage.commit", "storage.load", "backup.file.create", "host.ready"):
            self.assertIs(eval(expression, {"self": host, "method": method}), host.storage)

    def test_raw_secret_decoding_accepts_utf8_charset_mime_and_checks_capacity(self):
        try:
            import gi
            gi.require_version("Secret", "1")
            from gi.repository import GLib, Secret
        except (ImportError, ValueError):
            self.skipTest("Secret GI is required for MIME decoding compatibility")
        spec = importlib.util.spec_from_file_location("raw_vault_probe", NATIVE / "database.py")
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"protocol": self.protocol}):
            spec.loader.exec_module(module)
        vault = module.Vault(self.APP)
        item = types.SimpleNamespace(get_object_path=lambda: "/custom/item")
        for mime in ("text/plain", "text/plain;charset=utf-8"):
            secret = Secret.Value.new("synthetic 密碼", -1, mime)
            vault.service = types.SimpleNamespace(ensure_session_sync=lambda *_: None,
                get_session_dbus_path=lambda: "/session", decode_dbus_secret=lambda *_: secret)
            vault.call = lambda *_: GLib.Variant("((oayays))", (("/session", [], list(secret.get()), mime),))
            self.assertEqual(vault.read_item(item), "synthetic 密碼")
        secret = Secret.Value.new("x" * 65537, -1, "text/plain")
        with self.assertRaises(self.protocol.Failure) as error:
            vault.read_item(item)
        self.assertEqual(error.exception.code, "vault-unavailable")


if __name__ == "__main__":
    unittest.main()
