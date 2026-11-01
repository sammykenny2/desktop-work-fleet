"""Real Apple SQLite/AES-GCM record tests with disposable data and a synthetic key."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "Needs macOS Swift SDK")
class MacOSRecordStorageTests(unittest.TestCase):
    def test_transactions_reopen_and_incompatible_profile(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="work-fleet-records-") as temporary:
            folder = Path(temporary)
            executable = folder / "RecordStoreProbe"
            compile_result = subprocess.run([
                "swiftc", "-swift-version", "5", "-module-cache-path", str(folder / "module-cache"),
                str(root / "src/native/apple/Shared/FleetProtocol.swift"),
                str(root / "src/native/apple/Shared/FleetDatabase.swift"),
                str(root / "tests/native/apple/RecordStoreProbe.swift"), "-o", str(executable),
            ], text=True, capture_output=True, timeout=240)
            self.assertEqual(compile_result.returncode, 0, compile_result.stdout + compile_result.stderr)
            result = subprocess.run([str(executable), str(folder / "data")], text=True, capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("PASS record CAS", result.stdout)


if __name__ == "__main__":
    unittest.main()
