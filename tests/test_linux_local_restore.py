"""Real SQLite transaction coverage for Linux replacement; no desktop, keyring or user database."""
import json
import sqlite3
import sys
import threading
import types
import unittest
from unittest.mock import patch

from test_linux_vault import FakeSecret, load_database


class LinuxLocalRestoreTests(unittest.TestCase):
    def setUp(self):
        # Only the platform import is substituted on Windows; these tests never acquire a file lock.
        stubs = {"fcntl": types.ModuleType("fcntl")} if sys.platform == "win32" else {}
        with patch.dict(sys.modules, stubs):
            module, self.protocol = load_database(FakeSecret())
        self.db = module.Database.__new__(module.Database)
        self.db.profile = "local"
        self.db.lock = threading.RLock()
        self.db.connection = sqlite3.connect(":memory:", isolation_level=None)
        self.addCleanup(self.db.connection.close)
        self.db.connection.executescript("""
            CREATE TABLE records(profile TEXT, kind TEXT, revision INTEGER, data BLOB, PRIMARY KEY(profile,kind));
            CREATE TABLE attachments(profile TEXT, id TEXT, data BLOB, PRIMARY KEY(profile,id));
            CREATE TABLE staging(profile TEXT, token TEXT, kind TEXT, digest TEXT, size INTEGER, data BLOB);
        """)
        # Crypto is outside this transaction test; the actual SQL, staging and commit methods run unchanged.
        self.db.seal = lambda _kind, _key, data: data
        self.db.open = lambda _kind, _key, data: data
        self.old = b"old local attachment"
        self.old_id = self.protocol.digest(self.old)
        self.db.commit("workspace", self.record(0), None, [self.stage("attachment", self.old)])
        self.db.connection.execute("INSERT INTO attachments VALUES(?,?,?)", ("other", self.old_id, self.old))

    def stage(self, kind, data):
        return self.db.stage(kind, data, self.protocol.digest(data))

    def record(self, revision):
        return self.stage("workspace", json.dumps({"profileId": self.db.profile, "revision": revision, "schemaVersion": 1}).encode())

    def versioned_record(self, revision, schema):
        data = json.dumps({"profileId": self.db.profile, "revision": revision, "schemaVersion": schema, "text": "original notes"}).encode()
        return self.stage("workspace", data), data

    def test_migration_snapshot_and_workspace_roll_back_together_then_retry(self):
        old_token, old = self.versioned_record(1, 1)
        self.db.commit("workspace", old_token, 0, [])
        token, new = self.versioned_record(2, 2)
        with self.assertRaises(self.protocol.Failure) as raised:
            self.db.commit("workspace", token, 1, [])
        self.assertEqual(raised.exception.code, "migration-required")
        self.db.connection.execute("CREATE TRIGGER fail_migration BEFORE INSERT ON records WHEN NEW.kind='workspace' BEGIN SELECT RAISE(ABORT,'disk full'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.commit("workspace", token, 1, [], migration_from=1)
        self.assertEqual(self.db.record("workspace"), old)
        self.assertIsNone(self.db.recovery("workspace", 1))
        self.assertEqual(self.db.attachment(self.old_id), self.old)
        self.db.connection.execute("DROP TRIGGER fail_migration")
        with self.assertRaises(self.protocol.Failure):
            self.db.commit("workspace", token, 0, [], migration_from=1)
        with self.assertRaises(self.protocol.Failure):
            self.db.commit("workspace", token, 1, [], migration_from=2)
        self.assertIsNone(self.db.recovery("workspace", 1))
        self.db.commit("workspace", token, 1, [], migration_from=1)
        self.assertEqual(self.db.record("workspace"), new)
        self.assertEqual(self.db.recovery("workspace", 1), old)
        self.assertEqual(self.db.attachment(self.old_id), self.old)
        self.db.profile = "other"
        self.assertIsNone(self.db.recovery("workspace", 1))
        self.db.profile = "local"
        with self.assertRaises(self.protocol.Failure):
            self.db.recovery("migration:workspace:1", 1)
        for version in (0, True, "1"):
            with self.assertRaises(self.protocol.Failure):
                self.db.recovery("workspace", version)
        replaced, _ = self.versioned_record(3, 2)
        self.db.commit("workspace", replaced, 2, [], replace_attachments=True)
        self.assertIsNone(self.db.recovery("workspace", 1))

    def test_replace_and_empty_replace_preserve_other_profile(self):
        new = b"new backup attachment"
        self.db.commit("workspace", self.record(1), 0, [self.stage("attachment", new)], replace_attachments=True)
        self.assertIsNone(self.db.attachment(self.old_id))
        self.assertEqual(self.db.attachment(self.protocol.digest(new)), new)
        self.assertEqual(self.db.connection.execute("SELECT data FROM attachments WHERE profile='other'").fetchone()[0], self.old)
        self.db.commit("workspace", self.record(2), 1, [], replace_attachments=True)
        self.assertIsNone(self.db.attachment(self.protocol.digest(new)))

    def test_abort_and_stale_cas_leave_original_bytes_and_staging_retryable(self):
        new = b"new backup attachment"
        record, file = self.record(1), self.stage("attachment", new)
        self.db.connection.execute("CREATE TRIGGER fail_commit BEFORE INSERT ON records BEGIN SELECT RAISE(ABORT,'disk full'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.commit("workspace", record, 0, [file], replace_attachments=True)
        self.assertEqual(json.loads(self.db.record("workspace"))["revision"], 0)
        self.assertEqual(self.db.attachment(self.old_id), self.old)
        self.assertIsNone(self.db.attachment(self.protocol.digest(new)))
        self.db.connection.execute("DROP TRIGGER fail_commit")
        with self.assertRaises(self.protocol.Failure):
            self.db.commit("workspace", record, None, [file], replace_attachments=True)
        self.assertEqual(self.db.attachment(self.old_id), self.old)
        self.db.commit("workspace", record, 0, [file], replace_attachments=True)
        self.assertEqual(self.db.attachment(self.protocol.digest(new)), new)

    def test_cloud_and_journal_replacement_are_rejected_before_deletion(self):
        with self.assertRaises(self.protocol.Failure):
            self.db.commit("journal", "unused", None, [], replace_attachments=True)
        self.db.profile = "google:fixture"
        with self.assertRaises(self.protocol.Failure):
            self.db.commit("workspace", "unused", None, [], replace_attachments=True)
        self.db.profile = "local"
        self.assertEqual(self.db.attachment(self.old_id), self.old)


if __name__ == "__main__":
    unittest.main()
