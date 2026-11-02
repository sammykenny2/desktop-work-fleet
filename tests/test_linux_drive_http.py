"""Exercise the Linux Drive connection pool against a disposable HTTP/1.1 server."""
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/native/linux"))
import drive_http
import protocol as p


class LinuxDriveHTTPTests(unittest.TestCase):
    def setUp(self):
        self.seen = []
        seen = self.seen

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_args):
                pass

            def do_GET(self):
                seen.append((self.path, self.client_address[1], self.headers.get("Authorization")))
                if self.path == "/slow":
                    time.sleep(0.1)
                body = b"x" * 256 if self.path in ("/large", "/chunked") else b"ok"
                self.send_response(302 if self.path == "/redirect" else 200)
                if self.path == "/redirect":
                    self.send_header("Location", "https://example.invalid/not-followed")
                self.send_header("Transfer-Encoding", "chunked") if self.path == "/chunked" else self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if self.path == "/chunked":
                    body = b"100\r\n" + body + b"\r\n0\r\n\r\n"
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(self.server.server_close); self.addCleanup(self.server.shutdown)
        self.fallback = lambda *args: self.fail("Direct requests must use the pool")
        self.pool = drive_http.DriveHTTP(self.fallback)
        self.addCleanup(self.pool.close)
        # Only the connection endpoint is substituted; production bounds/lifetime/header logic runs unchanged.
        self.factory = patch.object(drive_http, "HTTPSConnection", lambda *_args, **_kwargs: HTTPConnection("127.0.0.1", self.server.server_port, timeout=2))
        self.factory.start(); self.addCleanup(self.factory.stop)
        self.proxy = patch.object(drive_http, "getproxies", return_value={})
        self.proxy.start(); self.addCleanup(self.proxy.stop)

    def request(self, path="/ok", **kwargs):
        return self.pool.request("https://www.googleapis.com" + path, **kwargs)

    def test_reuses_drained_responses_without_sharing_authorization(self):
        self.request(headers={"Authorization": "Bearer first"})
        self.request(headers={"Authorization": "Bearer second"})
        self.request()
        self.assertEqual(len({row[1] for row in self.seen}), 1)
        self.assertEqual([row[2] for row in self.seen], ["Bearer first", "Bearer second", None])
        self.assertEqual(self.request("/redirect")[0], 302)
        self.assertEqual(len(self.seen), 4, "Redirects must not be followed")

    def test_bounds_each_response_and_retires_failures(self):
        for path in ("/large", "/chunked"):
            with self.assertRaises(p.Failure) as error:
                self.request(path, maximum=32)
            self.assertEqual(error.exception.code, "source-capacity")
            self.assertEqual(self.request()[1], b"ok")
            self.assertNotEqual(self.seen[-1][1], self.seen[-2][1])

    def test_parallel_requests_and_context_retirement(self):
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(lambda _: self.request("/slow"), range(8)))
            self.assertTrue(all(item[1] == b"ok" for item in results))
            pending = executor.submit(self.request, "/slow")
            deadline = time.monotonic() + 2
            while len(self.seen) < 9 and time.monotonic() < deadline:
                time.sleep(0.001)
            self.pool.close()
            with self.assertRaises(p.Failure):
                pending.result(timeout=2)
        with self.assertRaises(p.Failure) as error:
            self.request()
        self.assertEqual(error.exception.code, "stale-session")
        self.assertEqual(self.pool.idle, [])

    def test_proxy_routing_and_endpoint_restrictions_are_preserved(self):
        with patch.object(drive_http, "getproxies", return_value={"https": "http://proxy.invalid"}), \
                patch.object(drive_http, "proxy_bypass", return_value=False):
            calls = []
            self.pool.fallback = lambda *args: calls.append(args) or (200, b"proxied", {})
            self.assertEqual(self.request()[1], b"proxied")
            self.assertEqual(len(calls), 1)
            self.assertEqual(self.seen, [])
        for url in ("http://www.googleapis.com/", "https://example.invalid/", "https://user@www.googleapis.com/", "https://www.googleapis.com/#fragment"):
            with self.assertRaises(p.Failure) as error:
                self.pool.request(url)
            self.assertEqual(error.exception.code, "invalid-source")


if __name__ == "__main__":
    unittest.main()
