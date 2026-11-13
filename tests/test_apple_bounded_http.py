"""Run the production URLSession transport against a disposable HTTP/1.1 loopback server."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "Needs macOS Swift SDK")
class AppleBoundedHTTPTests(unittest.TestCase):
    def test_connection_lifetime_and_per_task_safety(self):
        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_args):
                pass

            def do_GET(self):
                if self.path == "/slow":
                    time.sleep(0.2)
                body = self.headers.get("Authorization", "").encode() if self.path == "/echo" else b"x" * 256
                self.send_response(302 if self.path == "/redirect" else 200)
                if self.path == "/redirect":
                    self.send_header("Location", "/must-not-follow")
                    body = b""
                if self.path == "/chunked":
                    self.send_header("Transfer-Encoding", "chunked")
                    self.end_headers()
                    body = b"100\r\n" + body + b"\r\n0\r\n\r\n"
                else:
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="pin-it-anywhere-http-") as directory:
            executable = Path(directory) / "probe"
            build = subprocess.run(["swiftc", "-swift-version", "5", "-module-cache-path", directory + "/modules",
                                    str(root / "src/native/apple/Shared/PinItAnywhereProtocol.swift"),
                                    str(root / "src/native/apple/Shared/BoundedHTTP.swift"),
                                    str(root / "tests/native/apple/BoundedHTTPProbe.swift"), "-o", str(executable)],
                                   capture_output=True, text=True, timeout=240)
            self.assertEqual(build.returncode, 0, build.stdout + build.stderr)
            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                result = subprocess.run([str(executable), f"http://127.0.0.1:{server.server_port}"],
                                        capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("PASS bounded HTTP", result.stdout)
            finally:
                server.shutdown(); server.server_close(); worker.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
