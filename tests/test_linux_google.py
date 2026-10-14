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


class SignOut(unittest.TestCase):
    """ADR-021 (amended 2026-10-15): signing out forgets this device's credentials and never revokes the grant at Google,
    which would sign out every other device on the same account."""

    def test_sign_out_removes_local_credentials_without_network(self):
        removed, calls = [], []

        class Vault(FakeVault):
            def remove(self, *args):
                removed.append(args)
        original = google.http
        google.http = lambda *args, **kwargs: calls.append(args)
        try:
            g = google.Google(Vault(), {"google": {"clients": {}}}, "local", None)
            g.credentials = {"accountId": "123", "refreshToken": "synthetic-refresh"}
            g.sign_out()
            g.sign_out()
        finally:
            google.http = original
        self.assertEqual(removed, [("google-account", "123")])
        self.assertIsNone(g.credentials)
        self.assertEqual(calls, [])


class UploadSession(unittest.TestCase):
    """Resumable upload sessions follow the Location Google returns, and only to Google's own upload endpoint."""
    base = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable"

    def start(self, location):
        g = google.Google(FakeVault(), {"google": {"clients": {}}}, "local", None)
        sent = []

        def request(path, method="GET", data=None, headers=None, **_):
            sent.append(path)
            return (200, b"", {"Location": location}) if method == "POST" else (200, b"{}", {})
        g.request = request
        g.completed = lambda body, file: sent[-1]
        return g.create_file({"id": "allocated-id", "kind": "attachment", "sha256": "0" * 64, "size": 4}, b"\0\1\2\3")

    def test_google_session_shape_is_used_as_given(self):
        # Shape observed from Drive on 2026-10-06: the request's fields echoed and Google's own session_crd; values made up.
        location = self.base + "&fields=id%2Csize%2Cspaces&upload_id=AHVr-x_y.z&session_crd=AHSo-Bq_9"
        self.assertEqual(self.start(location), location[len("https://www.googleapis.com"):])

    def test_other_destinations_and_ambiguous_sessions_are_rejected(self):
        for location in ("https://attacker.invalid/upload/drive/v3/files?uploadType=resumable&upload_id=x",
                         "http://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x",
                         self.base + "&upload_id=x&upload_id=y", self.base + "&uploadType=multipart&upload_id=x",
                         self.base, self.base + "&upload_id=x#fragment", self.base.replace("resumable", "multipart") + "&upload_id=x"):
            with self.assertRaises(p.Failure) as caught:
                self.start(location)
            self.assertEqual(caught.exception.code, "invalid-upload-uri")


if __name__ == "__main__":
    unittest.main()
