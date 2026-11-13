"""Compile the production update presenter; no UI automation, live updater or user data."""

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "Needs macOS Swift/AppKit SDK")
class MacOSUpdatePresentationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="pin-it-anywhere-update-presentation-")
        cls.addClassCleanup(cls.temporary.cleanup)
        folder = Path(cls.temporary.name)
        root = Path(__file__).resolve().parents[1]
        cls.executable = folder / "UpdatePresentationProbe"
        result = subprocess.run([
            "swiftc", "-warnings-as-errors", "-module-cache-path", str(folder / "module-cache"),
            str(root / "src/native/apple/macos/PinItAnywhereUpdatePresentation.swift"),
            str(root / "tests/native/apple/UpdatePresentationProbe.swift"), "-o", str(cls.executable),
        ], text=True, capture_output=True, timeout=120)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)

    def run_probe(self, case):
        result = subprocess.run([str(self.executable), case], text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS " + case, result.stdout)

    def test_multiple_displays_clamping_and_progress_continuity(self):
        self.run_probe("placement")

    def test_activation_wait_timeout_cleanup_and_quit_cancellation(self):
        self.run_probe("activation")

    def test_native_window_levels_restore_without_revealing_main(self):
        self.run_probe("windows")


if __name__ == "__main__":
    unittest.main()
