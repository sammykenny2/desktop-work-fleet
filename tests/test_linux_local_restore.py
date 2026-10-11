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
        return self.stage("workspace", json.dumps({"profileId": self.db.profile, "revision": revision}).encode())

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
