"""Raspberry Pi/V3D defaults WebKit to shared-memory DMA-BUF renderer buffers, using a fake filesystem root."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"
spec = importlib.util.spec_from_file_location("renderer", NATIVE / "renderer.py")
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class LinuxRendererTests(unittest.TestCase):
    def root(self, files=(), directories=()):
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(base))
        for name, data in files:
            (base / name).parent.mkdir(parents=True, exist_ok=True)
            (base / name).write_bytes(data)
        for name in directories:
            (base / name).mkdir(parents=True)
        return base

    def configured(self, root, environ=None):
        environ = dict(environ or {})
        renderer.configure(environ, root)
        return environ

    def test_raspberry_pi_keeps_dmabuf_on_shared_memory_buffers(self):
        root = self.root(files=[("proc/device-tree/model", b"Raspberry Pi 4 Model B Rev 1.5\x00")])
        self.assertEqual(self.configured(root), {"WEBKIT_DMABUF_RENDERER_FORCE_SHM": "1"},
                         "disabling the DMA-BUF renderer blanks a scene once the pointer moves")

    def test_v3d_driver_keeps_dmabuf_on_shared_memory_buffers(self):
        self.assertEqual(self.configured(self.root(directories=["sys/module/v3d"])), {"WEBKIT_DMABUF_RENDERER_FORCE_SHM": "1"})

    def test_other_machines_keep_the_webkit_default(self):
        self.assertEqual(self.configured(self.root()), {})
        board = self.root(files=[("proc/device-tree/model", b"Generic ARM board\x00")], directories=["sys/module/vc4x"])
        self.assertEqual(self.configured(board), {})

    def test_a_user_setting_wins_on_the_pi(self):
        root = self.root(directories=["sys/module/v3d"])
        for environ in ({"WEBKIT_DISABLE_DMABUF_RENDERER": "1"}, {"WEBKIT_DISABLE_DMABUF_RENDERER": "0"}, {"WEBKIT_DMABUF_RENDERER_FORCE_SHM": "0"}):
            with self.subTest(environ=environ):
                self.assertEqual(self.configured(root, environ), environ)

    def test_host_decides_before_importing_webkit(self):
        source = (NATIVE / "host.py").read_text("utf-8")
        self.assertLess(source.index("renderer.configure(os.environ)"), source.index("import gi"))
        self.assertNotIn("WEBKIT_DISABLE_DMABUF_RENDERER", source, "the host no longer turns the DMA-BUF renderer off")

if __name__ == "__main__":
    unittest.main()
