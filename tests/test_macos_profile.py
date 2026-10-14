"""Runner provisioning rejects profiles for another app, team, or certificate."""
import copy
import datetime
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("macos_profile", Path(__file__).resolve().parents[1] / "scripts/check-macos-profile.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MacOSProfileTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.datetime(2026, 10, 14, tzinfo=datetime.timezone.utc)
        self.certificate = b"synthetic public certificate"
        self.profile = {
            "UUID": "12345678-1234-1234-1234-123456789abc",
            "ExpirationDate": datetime.datetime(2031, 9, 17),
            "TeamIdentifier": ["ABCDE12345"], "Platform": ["OSX"], "ProvisionsAllDevices": True,
            "DeveloperCertificates": [self.certificate],
            "Entitlements": {"com.apple.application-identifier": "ABCDE12345.app.workfleet.preview",
                             "keychain-access-groups": ["ABCDE12345.*"]},
        }

    def validate(self, profile):
        return module.validate_profile(profile, self.certificate, "ABCDE12345", "app.workfleet.preview", self.now)

    def test_accepts_matching_distribution_profile(self):
        self.assertEqual(self.validate(self.profile), self.profile["UUID"])
        self.profile["Entitlements"]["keychain-access-groups"] = ["ABCDE12345.app.workfleet.preview"]
        self.assertEqual(self.validate(self.profile), self.profile["UUID"])

    def test_rejects_invalid_distribution_metadata(self):
        for field, value in [("ExpirationDate", self.now), ("ExpirationDate", None), ("TeamIdentifier", ["OTHER12345"]),
                             ("Platform", ["iOS"]), ("ProvisionsAllDevices", False), ("DeveloperCertificates", [b"another cert"]),
                             ("UUID", "../unsafe-profile")]:
            with self.subTest(field=field, value=value):
                profile = copy.deepcopy(self.profile)
                profile[field] = value
                with self.assertRaises(ValueError):
                    self.validate(profile)

    def test_rejects_wrong_app_group_and_development_entitlements(self):
        for field, value in [("com.apple.application-identifier", "ABCDE12345.app.other"),
                             ("keychain-access-groups", ["OTHER12345.*"]), ("get-task-allow", True),
                             ("com.apple.security.get-task-allow", True)]:
            with self.subTest(field=field):
                profile = copy.deepcopy(self.profile)
                profile["Entitlements"][field] = value
                with self.assertRaises(ValueError):
                    self.validate(profile)


if __name__ == "__main__":
    unittest.main()
