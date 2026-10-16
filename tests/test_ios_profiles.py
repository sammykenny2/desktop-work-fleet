"""Device IPA signing must cover the app, extension, certificate and same devices."""
import copy
import datetime
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("ios_profiles", Path(__file__).resolve().parents[1] / "scripts/check_ios_profiles.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IOSProfileTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.datetime(2026, 10, 17, tzinfo=datetime.timezone.utc)
        self.certificate = b"synthetic iOS development certificate"
        self.app = {
            "UUID": "12345678-1234-1234-1234-123456789abc",
            "ExpirationDate": datetime.datetime(2030, 10, 17),
            "TeamIdentifier": ["ABCDE12345"], "Platform": ["iOS"],
            "DeveloperCertificates": [self.certificate], "ProvisionedDevices": ["device-one", "device-two"],
            "Entitlements": {"application-identifier": "ABCDE12345.app.workfleet.preview",
                             "com.apple.developer.team-identifier": "ABCDE12345", "get-task-allow": True,
                             "com.apple.security.application-groups": ["group.app.workfleet.preview"],
                             "keychain-access-groups": ["ABCDE12345.*"]},
        }
        self.share = copy.deepcopy(self.app)
        self.share["UUID"] = "87654321-1234-1234-1234-123456789abc"
        self.share["Entitlements"]["application-identifier"] += ".share"
        del self.share["Entitlements"]["keychain-access-groups"]

    def validate(self):
        return module.validate_profiles(self.app, self.share, self.certificate, "ABCDE12345",
                                        "app.workfleet.preview", "group.app.workfleet.preview", self.now)

    def test_accepts_valid_pair_without_exposing_device_identifiers(self):
        self.share["ProvisionedDevices"].reverse()
        result = self.validate()
        self.assertEqual(result["app_profile"], self.app["UUID"])
        self.assertEqual(result["share_profile"], self.share["UUID"])
        self.assertEqual(result["device_count"], 2)
        self.assertNotIn("device-one", str(result))
        self.app["Entitlements"]["keychain-access-groups"] = ["ABCDE12345.app.workfleet.preview"]
        self.validate()

    def test_rejects_expired_or_wrong_team_platform_and_certificate(self):
        for name in ("app", "share"):
            for field, value in [("ExpirationDate", self.now), ("ExpirationDate", None),
                                 ("TeamIdentifier", ["OTHER12345"]), ("Platform", ["OSX"]),
                                 ("DeveloperCertificates", [b"another certificate"]), ("UUID", "../unsafe")]:
                with self.subTest(profile=name, field=field):
                    original = getattr(self, name)
                    changed = copy.deepcopy(original)
                    changed[field] = value
                    setattr(self, name, changed)
                    with self.assertRaises(ValueError):
                        self.validate()
                    setattr(self, name, original)

    def test_rejects_wrong_bundle_team_app_group_and_distribution_profiles(self):
        for name in ("app", "share"):
            for field, value in [("application-identifier", "ABCDE12345.app.other"),
                                 ("com.apple.developer.team-identifier", "OTHER12345"),
                                 ("com.apple.security.application-groups", ["group.other"]),
                                 ("get-task-allow", False)]:
                with self.subTest(profile=name, field=field):
                    profile = getattr(self, name)
                    original = profile["Entitlements"][field]
                    profile["Entitlements"][field] = value
                    with self.assertRaises(ValueError):
                        self.validate()
                    profile["Entitlements"][field] = original

    def test_rejects_missing_or_mismatched_device_authorization(self):
        for devices in [None, [], [None], ["device-one"], ["device-three", "device-two"]]:
            with self.subTest(devices=devices):
                self.share["ProvisionedDevices"] = devices
                with self.assertRaises(ValueError):
                    self.validate()

    def test_rejects_all_devices_profiles(self):
        self.app["ProvisionsAllDevices"] = True
        with self.assertRaisesRegex(ValueError, "development profile"):
            self.validate()

    def test_rejects_missing_app_keychain_access(self):
        self.app["Entitlements"]["keychain-access-groups"] = ["OTHER12345.*"]
        with self.assertRaisesRegex(ValueError, "Keychain"):
            self.validate()


if __name__ == "__main__":
    unittest.main()
