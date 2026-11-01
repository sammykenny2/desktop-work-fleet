"""Shared closed-wire fixtures for native dataset adapters; no account, network or user data."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests/fixtures/dataset/native-wire.json"
sys.path.insert(0, str(ROOT / "src/native/linux"))
import dataset
import protocol


class LinuxDatasetTests(unittest.TestCase):
    def test_shared_wire_fixtures(self):
        fixture = json.loads(FIXTURE.read_text())
        for item in fixture["queries"]:
            self.assertEqual(dataset.query(item["input"]), item["expected"])
        for item in fixture["files"]:
            self.assertEqual(dataset.file(item["input"]), item["input"])
            dataset.verify(item["metadata"], item["input"])
            with self.assertRaises(protocol.Failure):
                patch = {"spaces": ["drive"]} if item["input"]["kind"] == "dataset-root" else {"parents": ["wrong-parent"]}
                dataset.verify({**item["metadata"], **patch}, item["input"])
        for value in fixture["badQueries"]:
            with self.assertRaises(protocol.Failure):
                dataset.query(value)
        for value in fixture["badFiles"]:
            with self.assertRaises(protocol.Failure):
                dataset.file(value)

    def test_typed_dispatch_and_missing_file_classification(self):
        import google
        import threading
        service = google.Google.__new__(google.Google)
        service.account = "account"
        service.closed = threading.Event()
        calls = []
        service.json = lambda path, **options: calls.append((path, options)) or {"files": []}
        selector = {"scope": "history", "datasetId": "11111111-2222-3333-4444-555555555555", "parentId": "note-folder"}
        service.invoke("google.dataset.list", {"accountId": "account", "query": selector})
        from urllib.parse import parse_qs, urlsplit
        query = parse_qs(urlsplit(calls[0][0]).query)
        self.assertEqual(query["q"], [dataset.query(selector)])
        self.assertEqual(query["orderBy"], ["createdTime desc"])
        self.assertEqual(query["spaces"], ["appDataFolder"])
        with self.assertRaises(protocol.Failure):
            service.invoke("google.dataset.get", {"accountId": "account", "fileId": "bad\n"})
        self.assertEqual(len(calls), 1)

    def test_dataset_upload_readback_and_parent_validation(self):
        import google
        import threading
        service = google.Google.__new__(google.Google)
        service.account = "account"
        service.closed = threading.Event()
        service.uploads = {}
        content = bytes([0, 255, 1, 3])
        descriptor = {"id": "fixture-file", "kind": "revision", "datasetId": "11111111-2222-3333-4444-555555555555",
                      "parentId": "note-folder", "entityId": "one", "revisionId": "r1", "shard": "a", "sha256": protocol.digest(content), "size": 4}
        metadata = {**dataset.metadata(descriptor), "spaces": ["appDataFolder"], "size": "4", "sha256Checksum": descriptor["sha256"]}
        calls = []

        def request(path, method="GET", data=None, headers=None, **options):
            calls.append((path, method))
            if method == "POST":
                self.assertEqual(protocol.decode(data)["parents"], ["note-folder"])
                self.assertEqual(protocol.decode(data)["appProperties"]["wfDataset"], descriptor["datasetId"])
                return 200, b"", {"Location": "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fixture"}
            if method == "PUT":
                self.assertEqual(data, content)
            if "alt=media" in path:
                return 200, content, {}
            return 200, protocol.encode(metadata), {}

        service.request = request
        args = {"accountId": "account", "file": descriptor}
        service.invoke("google.dataset.create", args, content)
        self.assertEqual(service.invoke("google.dataset.read", args), content)
        self.assertEqual(len(calls), 4)
        metadata["parents"] = ["another-note"]
        with self.assertRaises(protocol.Failure):
            service.invoke("google.dataset.read", args)
        self.assertEqual(len(calls), 5, "invalid parent must fail before downloading media")


@unittest.skipUnless(sys.platform == "darwin", "Needs macOS Swift SDK")
class AppleDatasetTests(unittest.TestCase):
    def test_shared_wire_fixtures(self):
        with tempfile.TemporaryDirectory(prefix="work-fleet-dataset-") as folder:
            binary = Path(folder) / "DatasetProbe"
            result = subprocess.run(["swiftc", "-swift-version", "5", "-module-cache-path", str(Path(folder) / "cache"),
                str(ROOT / "src/native/apple/Shared/FleetProtocol.swift"), str(ROOT / "src/native/apple/Shared/FleetDataset.swift"),
                str(ROOT / "tests/native/apple/DatasetProbe.swift"), "-o", str(binary)], capture_output=True, text=True, timeout=240)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(binary), str(FIXTURE)], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("PASS dataset wire", result.stdout)
