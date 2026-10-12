"""The shared-memory WebKit renderer is only the default on Raspberry Pi/V3D, using a fake filesystem root."""
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

    def test_raspberry_pi_disables_dmabuf(self):
        root = self.root(files=[("proc/device-tree/model", b"Raspberry Pi 4 Model B Rev 1.5\x00")])
        self.assertTrue(renderer.disable_dmabuf(root))

    def test_v3d_driver_disables_dmabuf(self):
        self.assertTrue(renderer.disable_dmabuf(self.root(directories=["sys/module/v3d"])))

    def test_other_machines_keep_the_webkit_default(self):
        self.assertFalse(renderer.disable_dmabuf(self.root()))
        board = self.root(files=[("proc/device-tree/model", b"Generic ARM board\x00")], directories=["sys/module/vc4x"])
        self.assertFalse(renderer.disable_dmabuf(board))

    def test_host_decides_before_importing_webkit(self):
        source = (NATIVE / "host.py").read_text("utf-8")
        self.assertLess(source.index("renderer.disable_dmabuf()"), source.index("import gi"))
        self.assertNotIn('\nos.environ.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER"', source, "the default is no longer unconditional")


if __name__ == "__main__":
    unittest.main()
