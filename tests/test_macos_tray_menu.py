"""Production AppKit menu actions with a disposable window and synthetic state; no product data or UI automation."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "Needs macOS Swift/AppKit SDK")
class MacOSTrayMenuTests(unittest.TestCase):
    def test_native_menu_actions_state_and_focus(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="pin-it-anywhere-menu-") as temporary:
            folder = Path(temporary); executable = folder / "TrayMenuProbe"
            result = subprocess.run([
                "swiftc", "-swift-version", "5", "-warnings-as-errors", "-module-cache-path", str(folder / "module-cache"),
                str(root / "src/native/apple/Shared/PinItAnywhereProtocol.swift"),
                str(root / "src/native/apple/Shared/PinItAnywhereText.swift"),
                str(root / "src/native/apple/macos/PinItAnywhereTrayMenu.swift"),
                str(root / "tests/native/apple/TrayMenuProbe.swift"), "-o", str(executable),
            ], text=True, capture_output=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(executable), str(root / "tests/fixtures/tray-menu.json")],
                                    text=True, capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("PASS tray menu", result.stdout)


if __name__ == "__main__":
    unittest.main()
