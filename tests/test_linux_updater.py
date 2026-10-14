"""ADR-044 Linux updater: the shared feed rules, the HTTP allowlist, checksums, DEB checks and the install flow. No GI or network."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("updater", ROOT / "src/native/linux/updater.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
FIXTURE = json.loads((ROOT / "tests/fixtures/update-feed.json").read_text("utf-8"))
FEED = (ROOT / "tests/fixtures" / FIXTURE["feed"]).read_bytes()


def feed_for(tag=None):
    entry = f'<entry><link href="https://github.com/o/r/releases/tag/{tag}" /></entry>' if tag else ""
    return f'<feed xmlns="http://www.w3.org/2005/Atom">{entry}</feed>'.encode()


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class Opener:
    """Answers by URL: bytes for a 200, (code, location or headers) for a redirect or error."""
    def __init__(self, routes):
        self.routes, self.requests = routes, []

    def open(self, request, timeout):
        self.requests.append(request)
        answer = self.routes[request.full_url]
        if isinstance(answer, tuple):
            code, location = answer
            headers = location if isinstance(location, dict) else {"Location": location} if location else {}
            raise urllib.error.HTTPError(request.full_url, code, "status", headers, io.BytesIO())
        return Response(answer)


def completed(code=0, stdout="", stderr=""):
    return subprocess.CompletedProcess([], code, stdout, stderr)


class LinuxUpdaterTests(unittest.TestCase):
    def test_feed_and_manifest_rules_match_the_shared_fixture(self):
        for case in FIXTURE["selection"]:
            with self.subTest(case["name"]):
                if "error" in case:
                    with self.assertRaises(updater.UpdateError) as caught:
                        updater.latest(FEED, FIXTURE["repository"], case["platform"], case["channel"], updater.parse_version(case["current"]))
                    self.assertEqual(caught.exception.code, case["error"])
                    continue
                chosen = updater.latest(FEED, FIXTURE["repository"], case["platform"], case["channel"], updater.parse_version(case["current"]))
                self.assertEqual(chosen and chosen["tag"], case["expected"])
        release = updater.latest(FEED, FIXTURE["repository"], "windows", "preview", (0, 1, 2))
        self.assertEqual(release["tag"], FIXTURE["manifestRelease"])
        for case in FIXTURE["manifests"]:
            with self.subTest(case["name"]):
                data = json.dumps(case["manifest"]).encode()
                if case["expected"] is None:
                    with self.assertRaises(updater.UpdateError) as caught:
                        updater.manifest(data, release, "windows", "x64")
                    self.assertEqual(caught.exception.code, "metadata_invalid")
                else:
                    package = updater.manifest(data, release, "windows", "x64")
                    self.assertEqual({key: package[key] for key in case["expected"]}, case["expected"])
        for damaged in [text.encode() for text in FIXTURE["invalidFeeds"]] + [b"\xff"]:
            with self.assertRaises(updater.UpdateError):
                updater.latest(damaged, "o/r", "windows", "preview", (0, 1, 2))
        self.assertEqual(updater.parse_version("0.1.10"), (0, 1, 10))
        for text in ("01.2.3", "1.2", "1.2.3.4", "1.2.3-beta", "1.2.3\n", None):
            self.assertIsNone(updater.parse_version(text))

    def test_manifest_cannot_redirect_or_escape_the_release_or_update_folder(self):
        release = updater.latest(FEED, "o/r", "windows", "preview", (0, 1, 2))
        good = FIXTURE["manifests"][0]["manifest"]
        for name in ("../outside.msix", "sub/file.msix", "sub\\file.msix", "https://evil.example/x", "file.msix?x",
                     "file.msix#x", "file.msix\n", "%2e%2e.msix", ""):
            with self.subTest(name=name):
                value = {**good, "assets": [{**good["assets"][0], "name": name}]}
                with self.assertRaises(updater.UpdateError) as caught:
                    updater.manifest(json.dumps(value).encode(), release, "windows", "x64")
                self.assertEqual(caught.exception.code, "metadata_invalid")

    def test_feed_from_another_repository_is_refused(self):
        with self.assertRaises(updater.UpdateError) as caught:
            updater.latest(FEED, "another/repository", "windows", "preview", (0, 1, 2))
        self.assertEqual(caught.exception.code, "metadata_invalid")

    def test_fetcher_follows_only_allowed_https_redirects(self):
        feed = "https://github.com/o/r/releases.atom"
        asset = "https://github.com/o/r/releases/download/linux-v0.2.0/work-fleet-update.json"
        storage = "https://release-assets.githubusercontent.com/x"
        opener = Opener({feed: feed_for(), asset: (302, storage), storage: b"manifest"})
        fetcher = updater.Fetcher("WorkFleet/0.1.0", opener)
        self.assertEqual(fetcher.fetch(feed, 100, updater.FEED_HOSTS), feed_for())
        self.assertEqual(opener.requests[0].get_header("User-agent"), "WorkFleet/0.1.0")
        self.assertIsNone(opener.requests[0].get_header("Authorization"))
        self.assertEqual(opener.requests[0].get_header("Accept"), "application/atom+xml")
        self.assertIsNone(opener.requests[0].get_header("X-github-api-version"))
        self.assertEqual(fetcher.fetch(asset, 100, updater.DOWNLOAD_HOSTS), b"manifest")
        for routes, url, hosts, code in (
                ({asset: (302, "https://evil.example/x")}, asset, updater.DOWNLOAD_HOSTS, "provider_rejected"),
                ({}, "http://github.com/o/r", updater.DOWNLOAD_HOSTS, "provider_rejected"),
                ({}, "https://api.github.com/repos/o/r/releases", updater.FEED_HOSTS, "provider_rejected"),
                ({feed: (302, storage)}, feed, updater.FEED_HOSTS, "provider_rejected"),
                ({feed: (403, None)}, feed, updater.FEED_HOSTS, "provider_rejected"),
                ({feed: (403, {"Retry-After": "60"})}, feed, updater.FEED_HOSTS, "rate_limited"),
                ({feed: (429, None)}, feed, updater.FEED_HOSTS, "rate_limited"),
                ({feed: (500, None)}, feed, updater.FEED_HOSTS, "provider_rejected"),
                ({asset: (302, asset)}, asset, updater.DOWNLOAD_HOSTS, "provider_rejected")):
            with self.subTest(url=url, code=code):
                with self.assertRaises(updater.UpdateError) as caught:
                    updater.Fetcher("WorkFleet/0.1.0", Opener(routes)).fetch(url, 100, hosts)
                self.assertEqual(caught.exception.code, code)
        with self.assertRaises(updater.UpdateError) as caught:
            updater.Fetcher("WorkFleet/0.1.0", Opener({feed: b"x" * 101})).fetch(feed, 100, updater.FEED_HOSTS)
        self.assertEqual(caught.exception.code, "metadata_invalid")

    def test_download_checks_size_and_digest(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder)
        url = "https://github.com/o/r/releases/download/linux-v0.2.0/work-fleet_0.2.0_all.deb"
        data = b"package bytes"
        fetcher = updater.Fetcher("WorkFleet/0.1.0", Opener({url: data}))
        seen = []
        fetcher.download(url, folder / "ok", len(data), hashlib.sha256(data).hexdigest(), seen.append)
        self.assertEqual((folder / "ok").read_bytes(), data)
        self.assertEqual(seen[-1], len(data))
        for size, digest in ((len(data), "0" * 64), (len(data) - 1, hashlib.sha256(data).hexdigest()), (len(data) + 1, hashlib.sha256(data).hexdigest())):
            with self.assertRaises(updater.UpdateError) as caught:
                fetcher.download(url, folder / "bad", size, digest, lambda _received: None)
            self.assertEqual(caught.exception.code, "checksum_mismatch")

    def test_deb_must_be_this_package_newer_and_architecture_compatible(self):
        def run(fields):
            return lambda *_args, **_kwargs: completed(stdout="".join(f"{key}: {value}\n" for key, value in fields.items()))
        good = {"Package": "work-fleet", "Version": "0.2.0", "Architecture": "all"}
        updater.check_deb("x.deb", "0.2.0", (0, 1, 0), run(good), "arm64")
        updater.check_deb("x.deb", "0.2.0", (0, 1, 0), run({**good, "Architecture": "arm64"}), "arm64")
        for fields, version, current in (({**good, "Package": "other"}, "0.2.0", (0, 1, 0)), ({**good, "Version": "0.2.1"}, "0.2.0", (0, 1, 0)),
                                         (good, "0.2.0", (0, 2, 0)), ({**good, "Architecture": "amd64"}, "0.2.0", (0, 1, 0))):
            with self.subTest(fields=fields, current=current):
                with self.assertRaises(updater.UpdateError) as caught:
                    updater.check_deb("x.deb", version, current, run(fields), "arm64")
                self.assertEqual(caught.exception.code, "identity_mismatch")

        def broken(*_args, **_kwargs):
            raise subprocess.CalledProcessError(2, "dpkg-deb")
        with self.assertRaises(updater.UpdateError):
            updater.check_deb("x.deb", "0.2.0", (0, 1, 0), broken, "arm64")

    def updater_for(self, folder, routes, run, distribution="deb", tools=True):
        states = []
        self.recorded = []
        instance = updater.Updater(folder, {"update": {"repository": "o/r", "channel": "preview"}}, "0.1.0", distribution, states.append,
                                   self.recorded.append, fetcher=updater.Fetcher("WorkFleet/0.1.0", Opener(routes)), run=run,
                                   which=lambda name: f"/usr/bin/{name}" if tools else None)
        return instance, states

    def wait(self, instance, start):
        finished = threading.Event()
        start(lambda: finished.set())
        self.assertTrue(finished.wait(10))

    def test_capability_needs_a_deb_install_tools_and_a_repository(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder)
        for distribution, tools, reason in (("bundle", True, "DEB"), ("source", True, "DEB"), ("deb", False, "pkexec")):
            instance, _ = self.updater_for(folder, {}, None, distribution, tools)
            self.assertFalse(instance.capable)
            self.assertEqual(instance.snapshot()["status"], "unavailable")
            self.assertIn(reason, instance.snapshot()["reason"])
            self.assertFalse(instance.check())
        bad = updater.Updater(folder, {"update": {"repository": "https://github.com/o/r"}}, "0.1.0", "deb", lambda _s: None, lambda _t: None,
                              which=lambda name: name)
        self.assertFalse(bad.capable)

    def test_check_download_and_install_flow(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder)
        deb = b"debian package"
        feed = "https://github.com/o/r/releases.atom"
        base = "https://github.com/o/r/releases/download/linux-v0.2.0/"
        manifest = json.dumps({"schemaVersion": 1, "platform": "linux", "version": "0.2.0", "tag": "linux-v0.2.0", "summary": "新版",
                               "assets": [{"arch": "all", "name": "work-fleet_0.2.0_all.deb", "size": len(deb), "sha256": hashlib.sha256(deb).hexdigest()}]}).encode()
        releases = feed_for("linux-v0.2.0")
        commands = []
        pkexec = {"code": 126}

        def run(command, **_kwargs):
            commands.append(command)
            if command[0] == "dpkg-deb":
                return completed(stdout="Package: work-fleet\nVersion: 0.2.0\nArchitecture: all\n")
            if command[0] == "dpkg":
                return completed(stdout="amd64\n")
            return completed(pkexec["code"], stderr="dpkg: error\n")
        routes = {feed: releases, base + "work-fleet-update.json": manifest, base + "work-fleet_0.2.0_all.deb": deb}
        instance, states = self.updater_for(folder, routes, run)
        self.assertEqual(instance.snapshot()["nextAction"], "check")
        self.wait(instance, instance.check)
        snapshot = instance.snapshot()
        self.assertEqual((snapshot["status"], snapshot["version"], snapshot["summary"], snapshot["nextAction"]), ("update_available", "0.2.0", "新版", "download"))
        self.assertEqual(len(self.recorded), 1)
        requests = instance.fetcher.opener.requests
        self.assertEqual([request.full_url for request in requests], [feed, base + "work-fleet-update.json"])
        self.assertTrue(all("api.github.com" not in request.full_url for request in requests))
        self.wait(instance, instance.download)
        self.assertEqual(instance.snapshot()["status"], "downloaded")
        self.assertEqual((folder / "updates/work-fleet_0.2.0_all.deb").read_bytes(), deb)
        self.assertIn("downloading", [state["status"] for state in states])
        results = []
        done = threading.Event()
        instance.install(lambda ok: (results.append(ok), done.set()))
        self.assertTrue(done.wait(10))
        self.assertEqual(results, [False])
        self.assertEqual((instance.snapshot()["status"], instance.snapshot()["error"]["code"]), ("downloaded", "authorization_cancelled"))
        self.assertEqual(commands[-1][0], "pkexec")
        self.assertTrue(commands[-1][-1].endswith("work-fleet_0.2.0_all.deb"))
        pkexec["code"] = 0
        done.clear()
        instance.install(lambda ok: (results.append(ok), done.set()))
        self.assertTrue(done.wait(10))
        self.assertEqual(results, [False, True])
        # A later check that finds the same version keeps the verified download.
        self.wait(instance, instance.check)
        self.assertEqual(instance.snapshot()["status"], "downloaded")
        # A changed file is caught right before installing.
        (folder / "updates/work-fleet_0.2.0_all.deb").write_bytes(b"tampered")
        done.clear()
        instance.install(lambda ok: (results.append(ok), done.set()))
        self.assertTrue(done.wait(10))
        self.assertEqual(results[-1], False)
        self.assertEqual(instance.snapshot()["error"]["code"], "checksum_mismatch")

    def test_up_to_date_cleans_old_downloads(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder)
        (folder / "updates").mkdir()
        (folder / "updates/old.deb").write_bytes(b"old")
        feed = "https://github.com/o/r/releases.atom"
        instance, _ = self.updater_for(folder, {feed: feed_for()}, None)
        self.wait(instance, instance.check)
        self.assertEqual(instance.snapshot()["status"], "up_to_date")
        self.assertEqual(list((folder / "updates").iterdir()), [])

    def test_unsupported_channel_is_not_silently_changed_to_preview(self):
        with tempfile.TemporaryDirectory() as folder:
            feed = "https://github.com/o/r/releases.atom"
            instance = updater.Updater(folder, {"update": {"repository": "o/r", "channel": "stable"}}, "0.1.0", "deb",
                                       lambda _state: None, lambda _time: None,
                                       fetcher=updater.Fetcher("WorkFleet/0.1.0", Opener({feed: feed_for("linux-v0.2.0")})),
                                       which=lambda name: name)
            self.wait(instance, instance.check)
            self.assertEqual(instance.snapshot()["channel"], "stable")
            self.assertEqual(instance.snapshot()["status"], "failed")
            self.assertEqual(instance.snapshot()["error"]["code"], "metadata_invalid")


if __name__ == "__main__":
    unittest.main()
