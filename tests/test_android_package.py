"""Delivery validation rejects renamed Debug APKs and mismatched release identities."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location("android_package", Path(__file__).resolve().parents[1] / "scripts/check_android_package.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AndroidPackageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.apk = Path(self.directory.name) / "renamed-release.apk"
        self.write_inventory()
        self.sha1 = "ab" * 20
        self.signature = f"Signer #1 certificate DN: CN=Release signing\nSigner #1 certificate SHA-1 digest: {self.sha1}\n"
        self.manifest = ('<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.example.app" '
                         'android:versionName="1.2.3" android:versionCode="123"><application /></manifest>')

    def write_inventory(self, variant="release"):
        with zipfile.ZipFile(self.apk, "w") as archive:
            archive.writestr("assets/licenses/native/inventory.json", json.dumps({
                "schemaVersion": 1, "platform": "android", "variant": variant, "libraries": [{"coordinate": "example:library:1"}]}))

    def inspect(self):
        def run(arguments, **kwargs):
            self.assertEqual(arguments[-1], str(self.apk.resolve()))
            self.assertTrue(kwargs["capture_output"])
            self.assertEqual(arguments[1:-1], ["verify", "--verbose", "--print-certs"] if arguments[0] == "apksigner" else ["manifest", "print"])
            return subprocess.CompletedProcess(arguments, 0, self.signature if arguments[0] == "apksigner" else self.manifest)
        with patch.object(module.subprocess, "run", side_effect=run):
            return module.inspect_apk(self.apk, "dev.example.app", "1.2.3", ":".join(["AB"] * 20), "apksigner", "apkanalyzer")

    def test_accepts_signed_release_manifest_and_inventory(self):
        self.assertEqual(self.inspect()["versionCode"], 123)
        self.manifest = self.manifest.replace("<application />", '<application android:debuggable="false" android:testOnly="false" />')
        self.assertFalse(self.inspect()["debuggable"])

    def test_rejects_renamed_debug_or_test_only_application(self):
        for flag in ("debuggable", "testOnly"):
            with self.subTest(flag=flag):
                original = self.manifest
                self.manifest = original.replace("<application />", f'<application android:{flag}="true" />')
                with self.assertRaisesRegex(ValueError, flag):
                    self.inspect()
                self.manifest = original
        self.write_inventory("debug")
        with self.assertRaisesRegex(ValueError, "Release runtime inventory"):
            self.inspect()

    def test_rejects_wrong_identity_version_or_signer(self):
        for old, new in (("dev.example.app", "dev.other.app"), ("1.2.3", "1.2.4"), ('versionCode="123"', 'versionCode="0"')):
            with self.subTest(new=new):
                original = self.manifest
                self.manifest = original.replace(old, new)
                with self.assertRaises(ValueError):
                    self.inspect()
                self.manifest = original
        self.signature = self.signature.replace(self.sha1, "cd" * 20)
        with self.assertRaisesRegex(ValueError, "fingerprint"):
            self.inspect()

    def test_rejects_debug_certificate_even_when_fingerprint_matches(self):
        self.signature = self.signature.replace("CN=Release signing", "C=US, O=Android, CN=Android Debug")
        with self.assertRaisesRegex(ValueError, "Android Debug"):
            self.inspect()

    def test_rejects_multiple_signers_missing_inventory_and_failed_tools(self):
        original = self.signature
        self.signature += self.signature.replace("#1", "#2")
        with self.assertRaisesRegex(ValueError, "fingerprint"):
            self.inspect()
        self.signature = original
        with zipfile.ZipFile(self.apk, "w") as archive:
            archive.writestr("other.txt", "no inventory")
        with self.assertRaisesRegex(ValueError, "inventory"):
            self.inspect()
        with patch.object(module.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "unsigned APK")):
            with self.assertRaisesRegex(ValueError, "apksigner failed"):
                module.inspect_apk(self.apk, "dev.example.app", "1.2.3", self.sha1, "apksigner", "apkanalyzer")


if __name__ == "__main__":
    unittest.main()
