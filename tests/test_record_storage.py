"""Real SQLite tests of record CAS, paging and rollback, without any user database or keyring."""
import json
import sqlite3
import sys
import threading
import types
import unittest
import uuid
from unittest.mock import patch

from test_linux_vault import FakeSecret, load_database


class RecordStorageTests(unittest.TestCase):
    def setUp(self):
        stubs = {"fcntl": types.ModuleType("fcntl")} if sys.platform == "win32" else {}
        with patch.dict(sys.modules, stubs):
            module, self.protocol = load_database(FakeSecret())
        self.db = module.Database.__new__(module.Database)
        self.db.profile, self.db.lock = "local", threading.RLock()
        self.db.connection = sqlite3.connect(":memory:", isolation_level=None)
        self.addCleanup(self.db.connection.close)
        self.db.connection.executescript("""
            CREATE TABLE records(profile TEXT,kind TEXT,revision INTEGER,data BLOB,PRIMARY KEY(profile,kind));
            CREATE TABLE attachments(profile TEXT,id TEXT,data BLOB,PRIMARY KEY(profile,id));
            CREATE TABLE staging(profile TEXT,token TEXT,kind TEXT,digest TEXT,size INTEGER,data BLOB);
        """)
        self.db.initialize_records()
        self.db.seal = lambda _kind, _key, data: data
        self.db.open = lambda _kind, _key, data: data

    @staticmethod
    def row(collection, key, ordinal=0, value=None, entity="card:one"):
        return dict(collection=collection, key=key, ordinal=ordinal, value=value or {"text": key}, entity=entity)

    def batch(self, revision=0, puts=None, deletes=None):
        return dict(format="work-fleet-record-transaction", schemaVersion=1, profileId=self.db.profile,
                    revision=revision, commitId=str(uuid.uuid4()), puts=puts or [], deletes=deletes or [])

    def stage(self, value):
        data = json.dumps(value, separators=(",", ":")).encode()
        return self.db.stage("workspace", data, self.protocol.digest(data))

    def commit(self, value, expected):
        return self.db.commit_records(self.stage(value), expected, [])

    def test_atomic_failure_and_exact_replay(self):
        initial = self.batch(puts=[self.row("current", "one"), self.row("history", "r0")])
        receipt = self.commit(initial, None)
        self.assertEqual(self.commit(initial, None), receipt)
        self.assertEqual(self.db.connection.execute("SELECT count(*) FROM staging").fetchone()[0], 0)
        new = self.batch(1, [self.row("current", "one", 1, {"text": "new"}), self.row("history", "r1", 1)])
        self.db.connection.execute("CREATE TRIGGER fail_receipt BEFORE UPDATE ON record_heads BEGIN SELECT RAISE(ABORT,'disk full'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.commit(new, 0)
        self.assertEqual(self.db.record_status(), receipt)
        self.assertEqual(json.loads(self.db.record_entry("current", "one"))["value"]["text"], "one")
        self.assertIsNone(self.db.record_entry("history", "r1"))
        self.db.connection.execute("DROP TRIGGER fail_receipt")
        self.commit(new, 0)
        with self.assertRaises(self.protocol.Failure) as error:
            self.commit(self.batch(1), 0)
        self.assertEqual(error.exception.code, "stale-writer")

    def test_history_is_immutable_and_pages_use_indexes(self):
        self.commit(self.batch(puts=[self.row("history", f"r{i:03}", entity=f"card:{i % 2}") for i in range(120)]), None)
        query = dict(collection="history", entity="card:1", limit=7, expectedRevision=0)
        seen = []
        while True:
            page = json.loads(self.db.record_page(query))
            self.assertLessEqual(len(page["rows"]), 7)
            seen.extend(row["key"] for row in page["rows"])
            if page["next"] is None:
                break
            query["after"] = page["next"]
        self.assertEqual(seen, [f"r{i:03}" for i in range(119, -1, -2)])
        plan = self.db.connection.execute("EXPLAIN QUERY PLAN SELECT * FROM record_entries WHERE profile=? AND collection=? AND entity=? ORDER BY ordinal DESC,id DESC LIMIT 8", ("local", "history", "card:1")).fetchall()
        self.assertIn("record_entity", str(plan))
        self.assertNotIn("TEMP B-TREE", str(plan))
        continuation = self.db.connection.execute("EXPLAIN QUERY PLAN SELECT * FROM record_entries WHERE profile=? AND collection=? AND entity=? AND (ordinal,id)<(?,?) ORDER BY ordinal DESC,id DESC LIMIT 8", ("local", "history", "card:1", 0, "r059")).fetchall()
        self.assertIn("record_entity", str(continuation))
        self.assertIn("(ordinal,id)<(?,?)", str(continuation))
        self.assertNotIn("TEMP B-TREE", str(continuation))
        with self.assertRaises(self.protocol.Failure) as error:
            self.commit(self.batch(1, [self.row("history", "r001", 1, {"text": "collision"}, "card:1")]), 0)
        self.assertEqual(error.exception.code, "revision-collision")
        self.assertEqual(self.db.record_status()["revision"], 0)

    def test_typing_updates_one_row_independently_of_history(self):
        self.commit(self.batch(puts=[self.row("history", f"r{i}") for i in range(500)]), None)
        updates = []
        self.db.connection.set_trace_callback(updates.append)
        self.commit(self.batch(1, [self.row("draft", "one", 1)]), 0)
        writes = [sql for sql in updates if sql.startswith("INSERT INTO record_entries")]
        self.assertEqual(len(writes), 1)
        self.assertFalse(any("SELECT data FROM record_entries" in sql for sql in updates))
        self.db.profile = "google:other"
        self.assertIsNone(self.db.record_entry("draft", "one"))
        self.assertIsNone(self.db.record_status())

    def test_legacy_detection_does_not_parse_or_replace_data(self):
        old = b"intentionally unreadable old workspace"
        self.db.connection.execute("INSERT INTO records VALUES('local','workspace',9,?)", (old,))
        self.assertEqual(self.db.record_status(), {"format": "legacy-workspace", "profileId": "local"})
        with self.assertRaises(self.protocol.Failure) as error:
            self.commit(self.batch(), None)
        self.assertEqual(error.exception.code, "incompatible-local-data")
        self.assertEqual(self.db.connection.execute("SELECT data FROM records").fetchone()[0], old)

    def test_attachment_failure_rolls_back_records_and_receipt(self):
        self.commit(self.batch(), None)
        data = b"atomic attachment"
        attachment = self.db.stage("attachment", data, self.protocol.digest(data))
        transaction = self.stage(self.batch(1, [self.row("draft", "one", 1)]))
        self.db.connection.execute("CREATE TRIGGER fail_attachment BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT,'disk full'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.commit_records(transaction, 0, [attachment])
        self.assertIsNone(self.db.record_entry("draft", "one"))
        self.assertEqual(self.db.record_status()["revision"], 0)
        self.db.connection.execute("DROP TRIGGER fail_attachment")
        self.db.commit_records(transaction, 0, [attachment])
        self.assertEqual(self.db.attachment(self.protocol.digest(data)), data)
        self.assertEqual(self.db.connection.execute("SELECT count(*) FROM staging").fetchone()[0], 0)

    def test_attachment_budget_is_checked_from_metadata_before_row_writes(self):
        self.commit(self.batch(), None)
        tokens = [self.db.stage("attachment", bytes([i]), self.protocol.digest(bytes([i]))) for i in range(6)]
        self.db.connection.execute("UPDATE staging SET size=? WHERE kind='attachment'", (25 * 1024 * 1024,))
        with self.assertRaises(self.protocol.Failure) as error:
            self.db.commit_records(self.stage(self.batch(1, [self.row("draft", "one", 1)])), 0, tokens)
        self.assertEqual(error.exception.code, "invalid-record-transaction")
        self.assertIsNone(self.db.record_entry("draft", "one"))
        self.assertEqual(self.db.record_status()["revision"], 0)


if __name__ == "__main__":
    unittest.main()
