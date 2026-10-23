"""SPEC-006 DO on Linux: what a failed open of the local data reports, and setting a damaged database aside. Pure Python."""
from datetime import datetime
import errno
import importlib.util
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"


def load_native(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


previous = sys.modules.get("protocol")
sys.modules["protocol"] = p = load_native("protocol")
try:
    datafailure = load_native("datafailure")
finally:
    if previous is None:
        sys.modules.pop("protocol")
    else:
        sys.modules["protocol"] = previous


class LinuxDataFailureTests(unittest.TestCase):
    def test_a_file_that_is_not_sqlite_is_damaged(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fleet.sqlite3"
            path.write_bytes(b"these bytes are not a SQLite database")
            with self.assertRaises(sqlite3.DatabaseError) as raised:
                connection = sqlite3.connect(path)
                try:
                    connection.execute("PRAGMA journal_mode=WAL")
                finally:
                    connection.close()
            self.assertEqual(datafailure.classify(raised.exception), datafailure.DAMAGED)

    def test_other_causes_and_errors_that_keep_their_message(self):
        self.assertEqual(datafailure.classify(sqlite3.OperationalError("database or disk is full")), datafailure.FULL)
        self.assertEqual(datafailure.classify(sqlite3.OperationalError("database is locked")), datafailure.IN_USE)
        self.assertEqual(datafailure.classify(sqlite3.OperationalError("attempt to write a readonly database")), datafailure.DENIED)
        self.assertEqual(datafailure.classify(OSError(errno.ENOSPC, "No space left")), datafailure.FULL)
        self.assertEqual(datafailure.classify(OSError(errno.EACCES, "Permission denied")), datafailure.DENIED)
        for code in ("native-version", "workspace-owned", "vault-locked", "storage-integrity"):
            self.assertIsNone(datafailure.classify(p.Failure(code, "own message")))
        self.assertIsNone(datafailure.classify(ValueError("not a data failure")))
        self.assertEqual([cause for cause in datafailure.CAUSES if datafailure.can_set_aside(cause)],
                         [datafailure.DAMAGED, datafailure.KEY])
        self.assertEqual(datafailure.failure(datafailure.FULL).code, datafailure.FULL)

    def test_every_cause_has_dialog_text_in_both_tables(self):
        text = load_native("text")
        self.assertEqual(set(datafailure.TEXT_KEYS), set(datafailure.CAUSES))
        for key in datafailure.TEXT_KEYS.values():
            self.assertIn(key, text.EN)
            self.assertIn(key, text.ZH_TW)

    def test_setting_aside_moves_the_database_and_its_key_together(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("fleet.sqlite3", "fleet.sqlite3-wal", "storage-key", "profile.txt", "host-preferences.json"):
                (root / name).write_text(name)
            folder = datafailure.set_aside(root, datetime(2026, 10, 23, 9, 30))
            self.assertEqual(folder, root / "set-aside-20261023-093000")
            self.assertEqual(sorted(path.name for path in folder.iterdir()), ["fleet.sqlite3", "fleet.sqlite3-wal", "storage-key"])
            self.assertEqual(sorted(path.name for path in root.iterdir() if path.is_file()), ["host-preferences.json", "profile.txt"])
            with self.assertRaises(p.Failure) as raised:
                datafailure.set_aside(root, datetime(2026, 10, 23, 9, 31))
            self.assertEqual(raised.exception.code, "data-set-aside", "nothing left to set aside")

    def test_a_failed_move_puts_back_what_it_moved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("fleet.sqlite3", "fleet.sqlite3-wal", "storage-key"):
                (root / name).write_text(name)
            real = os.rename

            def rename(source, target):
                if Path(source).name == "storage-key":
                    raise OSError(errno.EBUSY, "held")
                return real(source, target)
            with mock.patch.object(datafailure.os, "rename", rename), self.assertRaises(p.Failure) as raised:
                datafailure.set_aside(root, datetime(2026, 10, 23, 9, 30))
            self.assertEqual(raised.exception.code, "data-set-aside")
            self.assertEqual(sorted(path.name for path in root.iterdir()), ["fleet.sqlite3", "fleet.sqlite3-wal", "storage-key"])

    def test_a_failed_put_back_says_where_the_files_are(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("fleet.sqlite3", "storage-key"):
                (root / name).write_text(name)
            real = os.rename

            def rename(source, target):
                # The key can't move, and the database can't move back either.
                if Path(source).name == "storage-key" or Path(target).parent == root:
                    raise OSError(errno.EBUSY, "held")
                return real(source, target)
            with mock.patch.object(datafailure.os, "rename", rename), self.assertRaises(p.Failure) as raised:
                datafailure.set_aside(root, datetime(2026, 10, 23, 9, 30))
            self.assertEqual(raised.exception.code, "data-set-aside-incomplete")
            self.assertIn("set-aside-20261023-093000", str(raised.exception))
            self.assertTrue((root / "set-aside-20261023-093000" / "fleet.sqlite3").exists())


if __name__ == "__main__":
    unittest.main()
