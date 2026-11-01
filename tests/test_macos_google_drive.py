"""Exercise the real Apple Drive adapter with synthetic credentials and HTTP responses."""

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "Needs macOS Swift SDK")
class MacOSGoogleDriveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="work-fleet-drive-")
        cls.addClassCleanup(cls.temporary.cleanup)
        folder = Path(cls.temporary.name)
        root = Path(__file__).resolve().parents[1]
        cls.executable = folder / "GoogleDriveProbe"
        result = subprocess.run([
            "swiftc", "-swift-version", "5", "-module-cache-path", str(folder / "module-cache"),
            str(root / "src/native/apple/Shared/FleetProtocol.swift"),
            str(root / "src/native/apple/Shared/FleetDataset.swift"),
            str(root / "src/native/apple/Shared/FleetDrive.swift"),
            str(root / "tests/native/apple/GoogleDriveProbe.swift"),
            "-o", str(cls.executable),
        ], text=True, capture_output=True, timeout=240)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)

    def run_probe(self, name):
        result = subprocess.run([str(self.executable), name],
                                text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS " + name, result.stdout)

    def test_literal_commas_in_echoed_fields_are_accepted(self):
        self.run_probe("literal-fields")

    def test_dataset_upload_readback_and_parent_validation(self):
        self.run_probe("dataset")

    def test_percent_encoded_fields_are_preserved(self):
        self.run_probe("encoded-fields")

    def test_invalid_locations_are_rejected_before_sending_content(self):
        self.run_probe("invalid-locations")

    def test_network_retry_uses_the_accepted_session(self):
        self.run_probe("retry")

    def test_recreated_adapter_requests_a_new_session_for_the_same_file(self):
        self.run_probe("restart")


if __name__ == "__main__":
    unittest.main()
