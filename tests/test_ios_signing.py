"""A registered-device signer rejects the wrong app before modifying its bundle."""
from pathlib import Path
import plistlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
try:
    from sign_ios_app import signing_entitlements, validate_bundle
finally:
    sys.path.pop(0)


class IOSSigningTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="pin-it-anywhere-ios-signing-")
        self.addCleanup(self.directory.cleanup)
        self.app = Path(self.directory.name) / "PinItAnywhereIOS.app"
        self.share = self.app / "PlugIns/PinItAnywhereShare.appex"
        for bundle, identifier in [(self.app, "dev.sammykenny2.pinitanywhere"), (self.share, "dev.sammykenny2.pinitanywhere.share")]:
            bundle.mkdir(parents=True)
            info = {"CFBundleIdentifier": identifier, "CFBundleExecutable": bundle.stem,
                    "CFBundleShortVersionString": "0.3.0", "CFBundleVersion": "300"}
            (bundle / "Info.plist").write_bytes(plistlib.dumps(info))
            (bundle / bundle.stem).write_bytes(b"synthetic executable")

    def change(self, bundle, key, value):
        file = bundle / "Info.plist"
        info = plistlib.loads(file.read_bytes())
        info[key] = value
        file.write_bytes(plistlib.dumps(info))

    def test_accepts_only_matching_app_and_extension(self):
        self.assertEqual(validate_bundle(self.app, "dev.sammykenny2.pinitanywhere"), self.share)
        self.change(self.share, "CFBundleIdentifier", "app.other.share")
        with self.assertRaisesRegex(ValueError, "identifier"):
            validate_bundle(self.app, "dev.sammykenny2.pinitanywhere")

    def test_rejects_missing_executable_and_version_mismatch(self):
        self.change(self.share, "CFBundleVersion", "301")
        with self.assertRaisesRegex(ValueError, "versions"):
            validate_bundle(self.app, "dev.sammykenny2.pinitanywhere")
        self.change(self.share, "CFBundleVersion", "300")
        self.change(self.app, "CFBundleExecutable", "../outside")
        with self.assertRaisesRegex(ValueError, "executable"):
            validate_bundle(self.app, "dev.sammykenny2.pinitanywhere")

    def test_rejects_an_unexpected_extension(self):
        (self.app / "PlugIns/Other.appex").mkdir()
        with self.assertRaisesRegex(ValueError, "expected share extension"):
            validate_bundle(self.app, "dev.sammykenny2.pinitanywhere")

    def test_preserves_account_keychain_identity_and_scopes_extension(self):
        app = signing_entitlements("ABCDE12345", "dev.sammykenny2.pinitanywhere", "group.dev.sammykenny2.pinitanywhere", True)
        share = signing_entitlements("ABCDE12345", "dev.sammykenny2.pinitanywhere.share", "group.dev.sammykenny2.pinitanywhere")
        self.assertEqual(app["keychain-access-groups"], ["ABCDE12345.dev.sammykenny2.pinitanywhere"])
        self.assertNotIn("keychain-access-groups", share)
        self.assertEqual(app["com.apple.security.application-groups"], share["com.apple.security.application-groups"])
        self.assertEqual(share["application-identifier"], "ABCDE12345.dev.sammykenny2.pinitanywhere.share")


if __name__ == "__main__":
    unittest.main()
