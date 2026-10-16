"""Run the production Apple authorization service with in-memory SDK, HTTP and Keychain fakes; no UI or real account."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "Needs macOS Swift SDK")
class AppleGoogleSignInTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="work-fleet-sign-in-")
        cls.addClassCleanup(cls.temporary.cleanup)
        folder = Path(cls.temporary.name)
        root = Path(__file__).resolve().parents[1]
        sources = root / "tests/native/apple"
        common = ["swiftc", "-swift-version", "5", "-module-cache-path", str(folder / "module-cache"), "-I", str(folder), "-L", str(folder)]
        commands = [
            common + ["-emit-library", "-emit-module", "-module-name", "AppKit", str(sources / "GoogleAppKitStub.swift"), "-o", str(folder / "libAppKit.dylib")],
            common + ["-emit-library", "-emit-module", "-module-name", "GoogleSignIn", str(sources / "GoogleSignInStub.swift"), "-lAppKit", "-o", str(folder / "libGoogleSignIn.dylib")],
            common + [str(root / "src/native/apple/Shared/FleetProtocol.swift"), str(root / "src/native/apple/Shared/FleetGoogle.swift"),
                      str(sources / "GoogleSignInProbe.swift"), "-lAppKit", "-lGoogleSignIn", "-Xlinker", "-rpath", "-Xlinker", str(folder), "-o", str(folder / "GoogleSignInProbe")],
        ]
        for command in commands:
            result = subprocess.run(command, cwd=folder, text=True, capture_output=True, timeout=120)
            if result.returncode:
                raise RuntimeError(result.stdout + result.stderr)
        cls.executable = folder / "GoogleSignInProbe"

    def test_authorization_contract(self):
        for name in ("cancel", "success", "scope-denied", "closed", "wrong-account", "errors"):
            with self.subTest(name=name):
                result = subprocess.run([str(self.executable), name], text=True, capture_output=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("PASS " + name, result.stdout)


if __name__ == "__main__":
    unittest.main()
