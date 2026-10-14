"""Linux local keys, real AES-GCM migration and credentials; no user data or keyring."""
import base64
import importlib.util
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"


class FakeSecret(types.ModuleType):
    SchemaFlags = types.SimpleNamespace(DONT_MATCH_NAME=2)
    SchemaAttributeType = types.SimpleNamespace(STRING=0)
    ServiceFlags = types.SimpleNamespace(NONE=0)
    SearchFlags = types.SimpleNamespace(ALL=2, UNLOCK=4, LOAD_SECRETS=8)

    def __init__(self):
        super().__init__("Secret")
        self.items, self.searches = [], []
        self.unavailable = False
        secret = self
        self.Schema = types.SimpleNamespace(new=lambda name, flags, attributes: types.SimpleNamespace(flags=flags))
        self.Service = types.SimpleNamespace(get_sync=lambda *_: self)

    def search_sync(self, schema, attributes, flags, _cancellable):
        if self.unavailable:
            raise RuntimeError("no Secret Service")
        assert schema.flags == self.SchemaFlags.DONT_MATCH_NAME
        assert not flags & self.SearchFlags.UNLOCK, "startup must never request an unlock"
        self.searches.append(flags)
        found = [item for item in self.items if all(item["attributes"].get(k) == v for k, v in attributes.items())]
        return [types.SimpleNamespace(get_locked=lambda item=item: item["locked"],
                                     get_secret=lambda item=item: None if item["locked"] else types.SimpleNamespace(get_text=lambda: item["value"]))
                for item in found]


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
    previous = {name: sys.modules.get(name) for name in [*stubs, "protocol"]}
    try:
        spec = importlib.util.spec_from_file_location("protocol", NATIVE / "protocol.py")
        protocol = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(protocol)
        sys.modules.update(stubs, protocol=protocol)
        spec = importlib.util.spec_from_file_location("database", NATIVE / "database.py")
        database = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(database)
        def connect(vault):
            vault.schema = secret.Schema.new("app.workfleet.native.v1", secret.SchemaFlags.DONT_MATCH_NAME, {})
            return secret
        database.Vault.connect = connect
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
        self.assertEqual(self.secret.searches, [10])
        db.close()
        self.secret.unavailable = True
        cloud = self.open("google:fixture")
        self.assertEqual(cloud.record("workspace"), b"private notes")
        self.assertEqual(cloud.attachment("a" * 64), b"attachment")

    def test_locked_legacy_keeps_database_and_staging_without_prompt(self):
        self.legacy_data()
        self.secret.items[0]["locked"] = True
        before = (self.directory / "fleet.sqlite3").read_bytes()
        self.assertIn("鎖定", self.failure("vault-locked"))
        self.assertEqual((self.directory / "fleet.sqlite3").read_bytes(), before)
        self.assertEqual(self.secret.searches, [10])

    def test_missing_legacy_key_keeps_database(self):
        self.legacy_data()
        self.secret.items.clear()
        before = (self.directory / "fleet.sqlite3").read_bytes()
        self.assertIn("缺少原金鑰", self.failure("vault-unavailable"))
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
        with sqlite3.connect(self.directory / "fleet.sqlite3") as connection:
            connection.execute("UPDATE attachments SET data=? WHERE profile='google:fixture'", (b"corrupt",))
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

    def test_credentials_migrate_encrypt_and_survive_reset_and_keyring_loss(self):
        db = self.open()
        self.item("google-account", "fixture", "synthetic refresh token")
        vault = self.module.Credentials(db, self.vault)
        self.assertEqual(vault.read("google-account", "fixture"), "synthetic refresh token")
        row = db.connection.execute("SELECT data FROM credentials").fetchone()[0]
        self.assertNotIn(b"synthetic refresh token", row)
        db.reset()
        db.close()
        self.secret.unavailable = True
        vault = self.module.Credentials(self.open("google:fixture"), self.vault)
        self.assertEqual(vault.read("google-account", "fixture"), "synthetic refresh token")
        vault.save("google-account", "other", "other credential")
        self.assertEqual(vault.read("google-account", "other"), "other credential")

    def test_signout_tombstone_prevents_legacy_reimport_after_restart(self):
        db = self.open()
        self.item("google-account", "fixture", "legacy token")
        vault = self.module.Credentials(db, self.vault)
        vault.remove("google-account", "fixture")
        db.close()
        vault = self.module.Credentials(self.open(), self.vault)
        self.assertIsNone(vault.read("google-account", "fixture"))
        self.assertEqual(self.secret.searches, [])
        self.assertEqual(len(self.secret.items), 1)

    def test_locked_credentials_allow_offline_work_and_reauthentication(self):
        db = self.open()
        self.item("google-account", "fixture", "legacy token", locked=True)
        vault = self.module.Credentials(db, self.vault)
        self.assertIsNone(vault.read("google-account", "fixture"))
        db.secret("backup-key", "fixture", b"offline still works")
        vault.save("google-account", "fixture", "new token")
        self.assertEqual(vault.read("google-account", "fixture"), "new token")
        self.assertEqual(self.secret.searches, [10])

    def test_probe_refuses_a_non_private_bus_before_connecting(self):
        environment = {**os.environ, "XDG_DATA_HOME": str(self.directory / "data"),
                       "XDG_RUNTIME_DIR": str(self.directory / "runtime"), "PYTHONOPTIMIZE": "1"}
        probe = NATIVE.parents[2] / "tests/native/linux/storage_probe.py"
        result = subprocess.run([sys.executable, "-B", str(probe), str(self.directory)],
                                env=environment, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires its own dbus-run-session wrapper", result.stderr)


if __name__ == "__main__":
    unittest.main()
