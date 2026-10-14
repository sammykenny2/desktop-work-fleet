"""Compile the real public Atom release parser; no App, network, account or installation."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "Needs macOS Swift SDK")
class MacOSReleaseFeedTests(unittest.TestCase):
    def test_public_feed_selection_and_refusals(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="work-fleet-release-feed-") as temporary:
            folder = Path(temporary)
            executable = folder / "ReleaseFeedProbe"
            build = subprocess.run([
                "swiftc", "-module-cache-path", str(folder / "module-cache"),
                str(root / "src/native/apple/Shared/FleetProtocol.swift"),
                str(root / "src/native/apple/macos/FleetReleaseFeed.swift"),
                str(root / "tests/native/apple/ReleaseFeedProbe.swift"), "-o", str(executable),
            ], capture_output=True, text=True, timeout=120)
            self.assertEqual(build.returncode, 0, build.stdout + build.stderr)
            probe = subprocess.run([str(executable), str(root / "tests/fixtures/update-feed.json")],
                                   capture_output=True, text=True, timeout=30)
            self.assertEqual(probe.returncode, 0, probe.stdout + probe.stderr)
            self.assertIn("PASS release-feed", probe.stdout)


if __name__ == "__main__":
    unittest.main()
