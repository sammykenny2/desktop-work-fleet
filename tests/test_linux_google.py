"""Linux Google token requests carry a configured Desktop client secret, and only then; no network is used."""
import json
import ast
from contextlib import nullcontext
from pathlib import Path
import time
import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from urllib.parse import parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/native/linux"))
import google  # noqa: E402
import protocol as p  # noqa: E402


class FakeVault:
    def read(self, *_args):
        return None


class WorkspaceDescriptor(unittest.TestCase):
    def test_workspace_control_files_use_the_revision_size_limit_and_exact_metadata(self):
        g = google.Google(FakeVault(), {"google": {"clients": {}}}, "local", None)
        descriptor = {"id": "init-plan", "kind": "workspace", "sha256": "a" * 64, "size": 8 * 1024 * 1024}
        self.assertEqual(g.file({"file": descriptor}), descriptor)
        metadata = {"id": descriptor["id"], "size": str(descriptor["size"]), "spaces": ["appDataFolder"],
                    "appProperties": {"wfFormat": "work-fleet-file", "wfSchema": "1", "wfKind": "workspace", "wfSha256": descriptor["sha256"]}}
        g.metadata(metadata, descriptor)
        with self.assertRaises(p.Failure):
            g.file({"file": {**descriptor, "size": descriptor["size"] + 1}})
        with self.assertRaises(p.Failure):
            g.metadata({**metadata, "appProperties": {**metadata["appProperties"], "wfKind": "revision"}}, descriptor)


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


class DisconnectedSignOut(unittest.TestCase):
    def test_disconnected_account_is_revoked_locally_without_a_network_request(self):
        removed = []
        vault = FakeVault()
        vault.remove = lambda kind, account: removed.append((kind, account))
        g = google.Google(vault, {"google": {"clients": {}}}, "google:fixture", None)
        g.uploads["file"] = "pending"
        g.sign_out()
        self.assertEqual(removed, [("google-account", "fixture")])
        self.assertIsNone(g.credentials)
        self.assertEqual(g.uploads, {})


class VaultPause(unittest.TestCase):
    def fixture(self):
        class Vault:
            def __init__(self):
                self.locked, self.reads = False, 0
                self.unlocks, self.cancelled, self.unavailable = 0, False, False
            def read(self, kind, account):
                self.reads += 1
                if self.unavailable:
                    raise p.Failure("vault-unavailable", "service unavailable")
                if self.locked:
                    raise p.Failure("vault-locked", "同步暫停，便箋仍可使用")
                return json.dumps({"accountId": account, "email": "synthetic@example.test", "clientId": "client", "scope": google.SCOPE,
                                   "accessToken": "synthetic-access", "refreshToken": "synthetic-refresh", "expiresAt": int(time.time()) + 3600})
            def writable(self):
                if self.locked:
                    raise p.Failure("vault-locked", "vault locked")
            def interaction(self, _closed, _deadline=None, _cancelled=None):
                return nullcontext()
            def unlock(self, _closed=None):
                self.unlocks += 1
                if self.cancelled:
                    raise p.Failure("vault-unlock-cancelled", "已取消解鎖")
                self.locked = False
        vault = Vault()
        g = google.Google(vault, {"google": {"clients": {"linux": "client"}}}, "google:fixture", lambda _: self.fail("browser should not launch"))
        return g, vault

    def test_owner_construction_does_not_read_vault_and_locked_status_is_nonfatal(self):
        g, vault = self.fixture()
        self.assertEqual(vault.reads, 0)
        vault.locked = True
        status = g.status()
        self.assertFalse(status["connected"])
        self.assertTrue(status["paused"])
        self.assertEqual(status["accountId"], "fixture")
        self.assertIn("暫停", status["pauseReason"])
        self.assertIn("立即同步", status["pauseReason"])
        self.assertEqual(vault.unlocks, 0)

    def test_manual_unlock_resumes_same_account_without_oauth(self):
        g, vault = self.fixture()
        vault.locked = True
        self.assertTrue(g.status()["paused"])
        result = g.unlock_vault()
        self.assertTrue(result["connected"])
        self.assertFalse(result["paused"])
        self.assertEqual(result["accountId"], "fixture")
        self.assertEqual(g.token(), "synthetic-access")
        self.assertEqual(vault.unlocks, 1)
        g.unlock_vault()
        self.assertEqual(vault.unlocks, 1)

    def test_cancelled_manual_unlock_stays_paused_and_can_retry(self):
        g, vault = self.fixture()
        vault.locked = vault.cancelled = True
        with self.assertRaises(p.Failure) as error:
            g.unlock_vault()
        self.assertEqual(error.exception.code, "vault-unlock-cancelled")
        self.assertIsNone(g.credentials)
        self.assertTrue(g.status()["paused"])
        self.assertEqual(vault.unlocks, 1)
        vault.cancelled = False
        self.assertTrue(g.unlock_vault()["connected"])
        self.assertEqual(vault.unlocks, 2)

    def test_missing_service_does_not_request_unlock_or_oauth(self):
        g, vault = self.fixture()
        vault.unavailable = True
        with self.assertRaises(p.Failure) as error:
            g.unlock_vault()
        self.assertEqual(error.exception.code, "vault-unavailable")
        self.assertEqual(vault.unlocks, 0)

    def test_account_change_admission_cancels_unlock_even_while_it_is_queued(self):
        tree = ast.parse((Path(__file__).resolve().parents[1] / "src/native/linux/host.py").read_text())
        host_class = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "FleetApp")
        receive = next(node for node in host_class.body if isinstance(node, ast.FunctionDef) and node.name == "receive")
        scope = {"p": p, "time": time, "Vault": SimpleNamespace(UNLOCK_TIMEOUT=90), "GLib": SimpleNamespace()}
        exec(compile(ast.Module(body=[receive], type_ignores=[]), "host-receive", "exec"), scope)
        for method in ("google.signIn", "google.open", "google.local", "google.signOut", "storage.reset", "host.closeReady"):
            g, vault = self.fixture()
            vault.locked = True
            submitted = []
            def submit(function, *args):
                submitted.append((function, args))
                return SimpleNamespace(add_done_callback=lambda _callback: None)
            worker = SimpleNamespace(submit=submit)
            def invoke(method, _args, deadline, cancelled):
                return g.unlock_vault(deadline, cancelled) if method == "google.unlockVault" else {"profileId": "local"}
            host = SimpleNamespace(stopped=False, admitted=0, service=SimpleNamespace(google=g, invoke=invoke),
                                   epoch=0, view=object(), network=worker, storage=worker)
            def admit(method):
                scope["receive"](host, {"v": 1, "id": p.identifier(), "method": method, "params": {}})
            admit("google.unlockVault")
            self.assertEqual(len(submitted), 1)
            old_request = submitted[0]
            admit(method)
            self.assertEqual(len(submitted), 2)
            with self.assertRaises(p.Failure) as error:
                old_request[0](*old_request[1])
            self.assertEqual(error.exception.code, "vault-unlock-cancelled", method)
            self.assertEqual((vault.reads, vault.unlocks), (0, 0), method)
            # Cancelling an old request does not poison a newly admitted action.
            admit("google.unlockVault")
            fresh_request = submitted[-1]
            self.assertTrue(fresh_request[0](*fresh_request[1])["connected"])

    def test_close_cancels_pending_manual_unlock(self):
        g, vault = self.fixture()
        vault.locked = True
        vault.unlock = lambda *_: g.close()
        cancelled = []
        vault.cancel_unlock = lambda: cancelled.append(True)
        with self.assertRaises(p.Failure) as error:
            g.unlock_vault()
        self.assertEqual(error.exception.code, "stale-session")
        self.assertEqual(cancelled, [True])

    def test_keyring_lock_clears_cached_token_and_unlock_resumes_without_oauth(self):
        g, vault = self.fixture()
        self.assertTrue(g.status()["connected"])
        self.assertEqual(g.token(), "synthetic-access")
        vault.locked = True
        with self.assertRaises(p.Failure) as error:
            g.token()
        self.assertEqual(error.exception.code, "vault-locked")
        self.assertIsNone(g.credentials)
        vault.locked = False
        self.assertEqual(g.token(), "synthetic-access")
        self.assertFalse(g.status()["paused"])

    def test_locked_sign_in_stops_before_system_browser_or_network(self):
        g, vault = self.fixture()
        vault.locked = True
        with self.assertRaises(p.Failure) as error:
            g.sign_in()
        self.assertEqual(error.exception.code, "vault-locked")

    def test_401_refresh_survives_vault_reload_and_temporary_lock(self):
        g, vault = self.fixture()
        saved = [vault.read("google-account", "fixture")]
        reads, refreshes = [], []
        def read(*_):
            if vault.locked:
                raise p.Failure("vault-locked", "locked")
            return saved[0]
        vault.read = read
        vault.save = lambda _kind, _account, value: saved.__setitem__(0, value)
        def http(url, method="GET", data=None, headers=None, maximum=0):
            if url == "https://oauth2.googleapis.com/token":
                refreshes.append(parse_qs(data.decode()))
                return 200, b'{"access_token":"new-access","expires_in":3600}', {}
            if url.endswith("/userinfo"):
                return 200, b'{"sub":"fixture"}', {}
            reads.append(headers["Authorization"])
            return (401, b"{}", {}) if headers["Authorization"] == "Bearer synthetic-access" else (200, b"{}", {})
        with patch.object(google, "http", http):
            with self.assertRaises(p.Failure) as error:
                g.request("/drive/v3/files")
            self.assertEqual(error.exception.code, "unauthorized")
            vault.locked = True
            with self.assertRaises(p.Failure) as error:
                g.request("/drive/v3/files")
            self.assertEqual(error.exception.code, "vault-locked")
            vault.locked = False
            self.assertEqual(g.request("/drive/v3/files")[0], 200)
            self.assertEqual(g.token(), "new-access")
        self.assertEqual(reads, ["Bearer synthetic-access", "Bearer new-access"])
        self.assertEqual(len(refreshes), 1)
        self.assertEqual(refreshes[0]["grant_type"], ["refresh_token"])


if __name__ == "__main__":
    unittest.main()
