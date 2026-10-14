"""Exercise real libsecret Unlock/Prompt against an isolated synthetic D-Bus provider."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ManualUnlockTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "linux" and shutil.which("dbus-run-session"), "requires Linux and dbus-run-session")
    def test_explicit_prompt_cancel_retry_timeout_close_and_noninteractive_reads(self):
        try:
            import gi
            gi.require_version("Secret", "1")
        except (ImportError, ValueError):
            self.skipTest("requires Secret GI")
        with tempfile.TemporaryDirectory(prefix="work-fleet-unlock-") as temporary:
            root = Path(temporary)
            (root / "data").mkdir(mode=0o700)
            (root / "runtime").mkdir(mode=0o700)
            env = {**os.environ, "XDG_DATA_HOME": str(root / "data"), "XDG_RUNTIME_DIR": str(root / "runtime")}
            env.pop("DISPLAY", None)
            env.pop("WAYLAND_DISPLAY", None)
            result = subprocess.run(["dbus-run-session", "--", sys.executable, "-u", "-B",
                                     str(ROOT / "tests/native/linux/unlock_probe.py"), str(root)],
                                    env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stdout.count("PASS "), 9)
            self.assertNotIn("CRITICAL", result.stderr)
