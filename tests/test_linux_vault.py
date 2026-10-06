"""The Linux storage key tells a locked keyring from a missing key, using a fake libsecret without GI or a keyring."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"


class FakeSecret(types.ModuleType):
    """Matches by attributes like libsecret; a lookup that only finds locked items behaves like a dismissed unlock."""
    COLLECTION_DEFAULT = "/org/freedesktop/secrets/aliases/default"
    SchemaFlags = types.SimpleNamespace(NONE=0, DONT_MATCH_NAME=2)
    SchemaAttributeType = types.SimpleNamespace(STRING=0)
    ServiceFlags = types.SimpleNamespace(NONE=0)
    SearchFlags = types.SimpleNamespace(NONE=0, ALL=2, UNLOCK=4, LOAD_SECRETS=8)

    def __init__(self):
        super().__init__("Secret")
        self.items, self.searches = [], []
        secret = self

        class Schema:
            @staticmethod
            def new(name, flags, attributes):
                return types.SimpleNamespace(name=name, flags=flags, attributes=attributes)

        class Service:
            @staticmethod
            def get_sync(_flags, _cancellable):
                return types.SimpleNamespace(search_sync=secret.search_sync)

        self.Schema, self.Service = Schema, Service

    def matching(self, schema, attributes):
        assert schema.flags & self.SchemaFlags.DONT_MATCH_NAME, "a locked collection hides the schema name"
        return [item for item in self.items if all(item["attributes"].get(k) == v for k, v in attributes.items())]

    def search_sync(self, schema, attributes, flags, _cancellable):
        self.searches.append(flags)
        return self.matching(schema, attributes)

    def password_lookup_sync(self, schema, attributes, _cancellable):
        unlocked = [item for item in self.matching(schema, attributes) if not item["locked"]]
        return unlocked[0]["value"] if unlocked else None

    def password_store_sync(self, schema, attributes, _collection, _label, value, _cancellable):
        self.items.append({"attributes": dict(attributes), "value": value, "locked": False})
        return True

    def password_clear_sync(self, schema, attributes, _cancellable):
        found = self.matching(schema, attributes)
        self.items = [item for item in self.items if item not in found]
        return bool(found)


def load_database(secret):
    fake_gi = types.ModuleType("gi")
    fake_gi.require_version = lambda *_: None
    repository = types.ModuleType("gi.repository")
    repository.Gio = types.SimpleNamespace(Cancellable=lambda: object())
    repository.Secret = secret
    fake_gi.repository = repository
    aead = types.ModuleType("cryptography.hazmat.primitives.ciphers.aead")
    aead.AESGCM = lambda key: types.SimpleNamespace(key=key)
    stubs = {"gi": fake_gi, "gi.repository": repository, "cryptography": types.ModuleType("cryptography"),
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
        return database, protocol
    finally:
        for name, module in previous.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


@unittest.skipIf(sys.platform == "win32", "the Linux host needs fcntl")
class LinuxVaultTests(unittest.TestCase):
    ATTRIBUTES = {"application": "app.workfleet.test", "kind": "storage-key", "id": "v1"}

    def setUp(self):
        self.secret = FakeSecret()
        self.database, self.protocol = load_database(self.secret)
        self.vault = self.database.Vault("app.workfleet.test")
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.directory = Path(folder.name) / "WorkFleet"

    def existing_data(self):
        self.directory.mkdir(mode=0o700)
        (self.directory / "fleet.sqlite3").write_bytes(b"encrypted records")

    def locked_key(self):
        self.secret.items.append({"attributes": dict(self.ATTRIBUTES), "value": "locked", "locked": True})

    def open_failure(self):
        with self.assertRaises(self.protocol.Failure) as raised:
            self.database.Database(self.directory, "local", self.vault)
        self.assertEqual(raised.exception.code, "vault-unavailable")
        return str(raised.exception)

    def test_schema_matches_locked_items_by_attributes(self):
        self.assertEqual(self.vault.schema.flags, self.secret.SchemaFlags.DONT_MATCH_NAME)

    def test_locked_key_with_data_is_reported_locked_and_data_is_kept(self):
        self.existing_data()
        self.locked_key()
        message = self.open_failure()
        self.assertIn("已鎖定", message)
        self.assertNotIn("缺少原金鑰", message)
        self.assertEqual((self.directory / "fleet.sqlite3").read_bytes(), b"encrypted records")
        self.assertEqual(len(self.secret.items), 1)
        self.assertEqual(self.secret.searches, [self.secret.SearchFlags.ALL])

    def test_locked_key_without_data_creates_no_second_key(self):
        self.locked_key()
        self.assertIn("未建立新金鑰", self.open_failure())
        self.assertEqual(len(self.secret.items), 1)
        self.assertFalse((self.directory / "fleet.sqlite3").exists())

    def test_missing_key_with_data_is_reported_missing(self):
        self.existing_data()
        self.assertIn("缺少原金鑰", self.open_failure())
        self.assertEqual(self.secret.items, [])

    def test_first_run_creates_one_key_and_reuses_it(self):
        first = self.database.Database(self.directory, "local", self.vault)
        first.close()
        self.assertEqual([item["attributes"] for item in self.secret.items], [self.ATTRIBUTES])
        created = first.cipher.key
        second = self.database.Database(self.directory, "local", self.vault)
        second.close()
        self.assertEqual(second.cipher.key, created)
        self.assertEqual(len(self.secret.items), 1)

    def test_unlocked_key_is_used_beside_a_locked_duplicate(self):
        first = self.database.Database(self.directory, "local", self.vault)
        first.close()
        self.secret.searches.clear()
        self.secret.items.insert(0, {"attributes": dict(self.ATTRIBUTES), "value": "locked", "locked": True})
        reopened = self.database.Database(self.directory, "local", self.vault)
        reopened.close()
        self.assertEqual(reopened.cipher.key, first.cipher.key)
        self.assertEqual(self.secret.searches, [])


if __name__ == "__main__":
    unittest.main()
