"""Attachment copies are private, bounded and never interpreted as renderer-supplied paths."""
import base64
import importlib.util
from pathlib import Path
import sys
import threading
import unittest

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"


def load(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


previous = sys.modules.get("protocol")
protocol = load("protocol")
sys.modules["protocol"] = protocol
try:
    attachments = load("attachments")
finally:
    if previous is None:
        sys.modules.pop("protocol")
    else:
        sys.modules["protocol"] = previous

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGNQiQ8AIgYIBQAWcgNNdvla9QAAAABJRU5ErkJggg==")


@unittest.skipIf(sys.platform == "win32", "Linux file permissions and temporary-file lifecycle")
class AttachmentTests(unittest.TestCase):
    def test_private_copy_caching_open_and_cleanup(self):
        rendered, opened = [], []
        def render(file):
            self.assertEqual(file.read_bytes(), PNG)
            rendered.append(file)
            return PNG
        def launch(file):
            opened.append(file)
            self.assertEqual(file.read_bytes(), PNG)
            if sys.platform != "win32":
                self.assertEqual(file.stat().st_mode & 0o777, 0o400)
            return True
        files = attachments.AttachmentFiles(render=render, launch=launch)
        try:
            result = files.invoke(PNG, "../../proof.png")
            self.assertEqual(result, {"available": True, "png": base64.b64encode(PNG).decode()})
            self.assertFalse(rendered[0].exists())
            files.invoke(PNG, "../../proof.png")
            self.assertEqual(len(rendered), 1)
            self.assertEqual(files.invoke(PNG, "proof.png", True), {"opened": True})
            self.assertTrue(opened[0].is_relative_to(files.root))
            self.assertEqual(opened[0].name, "proof.png")
        finally:
            # Windows does not allow rmtree to unlink a read-only file; the runtime is Linux.
            if sys.platform == "win32":
                for file in opened:
                    file.chmod(0o600)
            files.close()
        self.assertFalse(files.root.exists())

    def test_no_executable_launch_and_no_png_on_failed_preview(self):
        files = attachments.AttachmentFiles(render=lambda _: None, launch=lambda _: self.fail("must not launch"))
        try:
            self.assertEqual(files.invoke(b"text", "proof.txt"), {"available": True, "png": None})
            for name in ["run.exe", "RUN.CMD ", "shortcut.desktop", "run.sh", "run.js", "RUN.CMD .", "loader.cpl", "run.py"]:
                with self.assertRaises(protocol.Failure) as rejected:
                    files.invoke(b"data", name, True)
                self.assertEqual(rejected.exception.code, "attachment-not-document")
        finally:
            files.close()

    def test_closing_cancels_a_late_thumbnail_without_repopulating_cache(self):
        entered, release = threading.Event(), threading.Event()
        outcomes = []
        def render(_):
            entered.set()
            release.wait(5)
            return PNG
        files = attachments.AttachmentFiles(render=render)
        def run():
            try:
                files.invoke(PNG, "proof.png")
            except protocol.Failure as error:
                outcomes.append(error.code)
        worker = threading.Thread(target=run)
        worker.start()
        self.assertTrue(entered.wait(2))
        files.close()
        self.assertFalse(files.root.exists())
        release.set(); worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(outcomes, ["stale-session"])
        self.assertFalse(files.previews)

    def test_system_pixbuf_thumbnail_when_available(self):
        try:
            import gi
            gi.require_version("GdkPixbuf", "2.0")
            from gi.repository import GdkPixbuf
        except (ImportError, ValueError):
            self.skipTest("GdkPixbuf is not installed")
        files = attachments.AttachmentFiles()
        try:
            result = files.invoke(PNG, "proof.png")
            self.assertTrue(result["png"])
            self.assertTrue(base64.b64decode(result["png"]).startswith(b"\x89PNG\r\n\x1a\n"))
        finally:
            files.close()


if __name__ == "__main__":
    unittest.main()
