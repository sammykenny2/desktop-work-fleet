"""Compile the real Swift host shell; system login-item registration is opt-in."""

import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "Needs macOS Swift/AppKit SDK")
class MacOSHostShellTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="work-fleet-host-shell-")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.folder = Path(cls.temporary.name)
        root = Path(__file__).resolve().parents[1]
        cls.executable = cls.folder / "HostShellProbe"
        result = subprocess.run([
            "swiftc", "-module-cache-path", str(cls.folder / "module-cache"),
            str(root / "src/native/apple/Shared/FleetProtocol.swift"),
            str(root / "src/native/apple/Shared/FleetText.swift"),
            str(root / "src/native/apple/macos/FleetHostShell.swift"),
            str(root / "tests/native/apple/HostShellProbe.swift"),
            "-o", str(cls.executable),
        ], text=True, capture_output=True, timeout=120)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)

    def run_probe(self, name, executable=None):
        result = subprocess.run([str(executable or self.executable), name],
                                text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS " + name, result.stdout)
        return result.stdout

    def test_unseen_service_keeps_settings_editable(self):
        self.run_probe("notfound-state")

    def test_first_launch_registers_unseen_service(self):
        self.run_probe("first-notfound")

    def test_first_launch_registers_unregistered_service(self):
        self.run_probe("first-disabled")

    def test_existing_preferences_allow_explicit_retry_without_auto_enabling(self):
        self.run_probe("existing-notfound")

    def test_pending_system_approval_is_not_overridden(self):
        self.run_probe("approval")

    def test_enabled_service_is_not_registered_twice(self):
        self.run_probe("enabled")

    def test_disabling_unseen_service_is_saved_without_unregistering(self):
        self.run_probe("off-unseen")

    def test_failed_registration_is_reported_and_retryable(self):
        self.run_probe("registration-error")

    def test_display_language_is_saved_with_startup_settings(self):
        self.run_probe("language")

    def test_display_language_rules_and_host_text(self):
        self.run_probe("language-rules")

    @unittest.skipUnless(os.environ.get("WORK_FLEET_TEST_LOGIN_ITEMS") == "1",
                         "Opt-in: temporarily registers a unique sandboxed login-item probe")
    def test_real_sandboxed_login_item_registration_and_removal(self):
        app = self.folder / "Login Item Probe.app"
        binary = app / "Contents/MacOS/HostShellProbe"
        binary.parent.mkdir(parents=True)
        shutil.copy2(self.executable, binary)
        identity = "app.workfleet.loginprobe.p" + uuid.uuid4().hex
        (app / "Contents/Info.plist").write_bytes(plistlib.dumps({
            "CFBundleIdentifier": identity, "CFBundleExecutable": "HostShellProbe",
            "CFBundleName": "Work Fleet Login Item Probe", "CFBundlePackageType": "APPL",
            "CFBundleVersion": "1", "LSUIElement": True,
        }))
        entitlements = self.folder / "probe.entitlements"
        entitlements.write_bytes(plistlib.dumps({"com.apple.security.app-sandbox": True}))
        subprocess.run(["codesign", "--force", "--sign", "-", "--options", "runtime",
                        "--entitlements", str(entitlements), str(app)],
                       check=True, capture_output=True)
        output = self.run_probe("system", binary)
        print(output, end="")


if __name__ == "__main__":
    unittest.main()
