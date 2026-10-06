"""Linux Google token requests carry a configured Desktop client secret, and only then; no network is used."""
from pathlib import Path
import sys
import unittest
from urllib.parse import parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/native/linux"))
import google  # noqa: E402
import protocol as p  # noqa: E402


class FakeVault:
    def read(self, *_args):
        return None


class TokenRequest(unittest.TestCase):
    def capture(self, config):
        sent = []
        original = google.http
        google.http = lambda url, method, data, headers, maximum: (sent.append(parse_qs(data.decode("ascii"))), (200, b'{"access_token":"a"}', {}))[1]
        try:
            google.Google(FakeVault(), config, "local", None).token_request({"client_id": "c", "grant_type": "refresh_token"})
        finally:
            google.http = original
        return sent[0]

    def test_secret_is_sent_when_configured(self):
        form = self.capture({"google": {"clients": {"linux": "1-a.apps.googleusercontent.com"}, "secrets": {"linux": "GOCSPX-synthetic"}}})
        self.assertEqual(form["client_secret"], ["GOCSPX-synthetic"])
        self.assertEqual(form["client_id"], ["c"])

    def test_secret_is_omitted_without_one(self):
        self.assertNotIn("client_secret", self.capture({"google": {"clients": {"linux": "1-a.apps.googleusercontent.com"}}}))

    def test_malformed_secret_is_rejected(self):
        for secret in ("has space", "x" * 257, 7):
            with self.assertRaises(p.Failure):
                google.Google(FakeVault(), {"google": {"clients": {}, "secrets": {"linux": secret}}}, "local", None)


if __name__ == "__main__":
    unittest.main()
