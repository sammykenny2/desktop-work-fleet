"""Integration tests use real HTTP clients and a temporary, persistent SQLite DB."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "server"))
from work_fleet import Store, make_server


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="work-fleet-test-")
        self.store = Store(Path(self.temp.name) / "fleet.sqlite3")
        self.owner = self.store.bootstrap().read_text()
        self.server = make_server(self.store, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = self.server.origin
        self.epoch = self.call("/api/snapshot")[1]["epoch"]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def call(self, path, body=None, token=None, headers=None):
        req = Request(self.origin + path, data=None if body is None else json.dumps(body).encode(),
                      headers={"Authorization": "Bearer " + (self.owner if token is None else token),
                               "Content-Type": "application/json", **(headers or {})})
        try:
            with urlopen(req, timeout=5) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            with error:
                return error.code, json.load(error)

    def op(self, **patch):
        return {"id": str(uuid.uuid4()), "epoch": self.epoch, "operation": str(uuid.uuid4()),
                "action": "create", "text": "quick capture", "board": "Inbox", **patch}

    def create(self):
        payload = self.op()
        status, response = self.call("/api/operations", payload)
        self.assertEqual(status, 200)
        return response["note"]

    def paired(self, role="editor"):
        invitation = self.store.create_invite(role)
        status, result = self.call("/api/pair", {"code": invitation["code"], "name": "Test device"}, token="")
        self.assertEqual(status, 200)
        return result

    def test_quick_capture_persists_after_restart(self):
        note = self.create()
        self.server.store = Store(self.store.path)
        status, data = self.call("/api/snapshot")
        self.assertEqual(status, 200)
        self.assertEqual(data["notes"][0], note)
        self.assertEqual(data["epoch"], self.epoch)

    def test_competing_writers_one_wins_and_other_gets_current(self):
        note = self.create()
        a, b = self.paired(), self.paired()
        barrier = threading.Barrier(2)
        def write(pair, text):
            barrier.wait()
            return self.call("/api/operations", self.op(id=note["id"], action="update", revision=1,
                                                        patch={"text": text}), token=pair["token"])
        with ThreadPoolExecutor(2) as pool:
            first = pool.submit(write, a, "draft A")
            second = pool.submit(write, b, "draft B")
            results = [first.result(), second.result()]
        self.assertEqual(sorted(r[0] for r in results), [200, 409])
        loser = next(body for code, body in results if code == 409)
        self.assertEqual(loser["current"]["revision"], 2)
        self.assertIn(loser["current"]["text"], {"draft A", "draft B"})

    def test_response_loss_retry_is_identical_after_restart(self):
        payload = self.op()
        _, first = self.call("/api/operations", payload)  # Simulate discarding the acknowledged response.
        self.server.store = Store(self.store.path)
        status, repeated = self.call("/api/operations", payload)
        self.assertEqual((status, repeated), (200, first))
        self.assertEqual(len(self.call("/api/snapshot")[1]["notes"]), 1)
        self.assertEqual(self.call("/api/operations", {**payload, "text": "different"})[0], 409)

    def test_retry_update_does_not_apply_twice(self):
        note = self.create()
        payload = self.op(id=note["id"], action="update", revision=1, patch={"status": "in_progress"})
        self.assertEqual(self.call("/api/operations", payload), self.call("/api/operations", payload))
        current = self.call("/api/snapshot")[1]["notes"][0]
        self.assertEqual((current["revision"], current["text"], current["board"]), (2, note["text"], "Inbox"))

    def test_delete_tombstone_blocks_offline_write_and_id_reuse(self):
        note = self.create()
        self.assertEqual(self.call("/api/operations", self.op(id=note["id"], action="delete", revision=1))[0], 200)
        status, data = self.call("/api/operations", self.op(id=note["id"], action="update", revision=1, patch={"text": "old offline"}))
        self.assertEqual(status, 409)
        self.assertTrue(data["current"]["deleted"])
        self.assertEqual(self.call("/api/operations", self.op(id=note["id"]))[0], 409)
        self.assertEqual(self.call("/api/operations", self.op(id=note["id"], action="update", revision=2, patch={"text": "resurrect"}))[0], 409)
        restored = self.call("/api/operations", self.op(id=note["id"], action="restore", revision=2))[1]["note"]
        self.assertFalse(restored["deleted"])
        self.assertEqual(restored["revision"], 3)

    def test_invite_once_expiry_and_no_admin_escalation(self):
        invite = self.store.create_invite()
        request = {"code": invite["code"], "name": "device"}
        self.assertEqual(self.call("/api/pair", request, token="")[0], 200)
        self.assertEqual(self.call("/api/pair", request, token="")[0], 403)
        expired = self.store.create_invite(ttl=-1)
        self.assertEqual(self.call("/api/pair", {**request, "code": expired["code"]}, token="")[0], 403)
        self.assertEqual(self.call("/api/invites", {"role": "admin"})[0], 400)

    def test_pair_race_only_one_claim(self):
        code = self.store.create_invite()["code"]
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda _: self.call("/api/pair", {"code": code, "name": "racer"}, token="")[0], range(2)))
        self.assertEqual(sorted(results), [200, 403])

    def test_read_only_and_revocation_enforced_on_retry(self):
        viewer = self.paired("viewer")
        self.assertEqual(self.call("/api/snapshot", token=viewer["token"])[0], 200)
        self.assertEqual(self.call("/api/operations", self.op(), token=viewer["token"])[0], 403)
        self.assertEqual(self.call("/api/invites", {}, token=viewer["token"])[0], 403)
        editor = self.paired()
        payload = self.op()
        self.assertEqual(self.call("/api/operations", payload, token=editor["token"])[0], 200)
        self.assertEqual(self.call("/api/revoke", {"device": editor["device"]})[0], 200)
        self.assertEqual(self.call("/api/snapshot", token=editor["token"])[0], 401)
        self.assertEqual(self.call("/api/operations", payload, token=editor["token"])[0], 401)

    def test_backup_restore_rotates_epoch_and_revokes_devices(self):
        note = self.create()
        old_device = self.paired()
        backup = Path(self.temp.name) / "backup.sqlite3"
        self.store.backup(backup)
        self.call("/api/operations", self.op(id=note["id"], action="update", revision=1, patch={"text": "after backup"}))
        restored = Store.restore(backup, Path(self.temp.name) / "restored.sqlite3")
        self.server.store = restored
        self.assertEqual(self.call("/api/snapshot", token=old_device["token"])[0], 401)
        self.assertEqual(self.call("/api/snapshot")[0], 401)
        self.owner = restored.bootstrap().read_text()
        _, snap = self.call("/api/snapshot")
        self.assertNotEqual(snap["epoch"], self.epoch)
        self.assertEqual(snap["notes"][0]["text"], note["text"])
        status, data = self.call("/api/operations", self.op(id=note["id"], action="update", revision=1, patch={"text": "old draft"}))
        self.assertEqual((status, data["error"]), (409, "epoch_changed"))
        with self.assertRaises(Exception):
            Store.restore(backup, restored.path)

    def test_interrupted_restore_never_publishes_old_authority(self):
        self.create()
        backup = Path(self.temp.name) / "backup.sqlite3"
        self.store.backup(backup)
        destination = Path(self.temp.name) / "partial.sqlite3"
        class FailingRestore(Store):
            def __init__(self, path):
                raise OSError("injected interruption after backup copy")
        with self.assertRaises(OSError):
            FailingRestore.restore(backup, destination)
        self.assertFalse(destination.exists())
        self.assertEqual(self.call("/api/snapshot")[0], 200)

    def test_storage_failure_rolls_back_and_retry_can_succeed(self):
        with self.store.connect(write=True) as db:
            db.execute("CREATE TRIGGER fail_note BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END")
        payload = self.op()
        self.assertEqual(self.call("/api/operations", payload)[0], 503)
        self.assertEqual(self.call("/api/snapshot")[1]["notes"], [])
        with self.store.connect(write=True) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM operations").fetchone()[0], 0)
            db.execute("DROP TRIGGER fail_note")
        self.assertEqual(self.call("/api/operations", payload)[0], 200)

    def test_auth_origin_host_and_input_boundaries(self):
        self.assertEqual(self.call("/api/snapshot", token="")[0], 401)
        self.assertEqual(self.call("/api/operations", self.op(), headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.call("/api/snapshot", headers={"Host": "evil.example"})[0], 403)
        for change in [{"status": "agent_running"}, {"id": "../escape"}, {"text": " "}, {"text": "a" * 12001}]:
            self.assertEqual(self.call("/api/operations", self.op(**change))[0], 400)
        self.assertEqual(self.call("/api/operations", self.op(text="x" * 70000))[0], 413)

    def test_invite_does_not_embed_permanent_credential(self):
        _, invitation = self.call("/api/invites", {"role": "viewer"})
        self.assertEqual(invitation["url"], self.origin + "/#pair=" + invitation["code"])
        self.assertNotIn(self.owner, json.dumps(invitation))
        with self.store.connect() as db:
            self.assertNotIn(invitation["code"], str([tuple(row) for row in db.execute("SELECT * FROM invites")]))


if __name__ == "__main__":
    unittest.main()
