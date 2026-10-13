"""labwc shortcuts: Work Fleet only rewrites its own marked rc.xml block, using temporary files instead of the user's config."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import xml.etree.ElementTree as ElementTree

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"
spec = importlib.util.spec_from_file_location("labwc", NATIVE / "labwc.py")
labwc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(labwc)
APP = "app.workfleet.preview"


class LinuxLabwcTests(unittest.TestCase):
    def directory(self):
        path = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(path))
        return path

    def keybinds(self, text):
        keyboard = ElementTree.fromstring(text).find("keyboard")
        return [(value.get("key"), value.find("action").get("command")) for value in keyboard.findall("keybind")]

    def test_keys_use_labwc_modifiers_and_unshifted_letters(self):
        # Verified against a headless labwc 0.20 with a virtual keyboard: C-S-d fires on Ctrl+Shift+D.
        self.assertEqual(labwc.keybind("Ctrl+Shift+1"), "C-S-1")
        self.assertEqual(labwc.keybind("Ctrl+Shift+D"), "C-S-d")
        self.assertEqual(labwc.keybind("Ctrl+Alt+Meta+F12"), "C-A-W-F12")

    def test_the_block_runs_gapplication_with_the_key(self):
        text = labwc.insert(labwc.MINIMAL, APP, ["Ctrl+Shift+1", "Ctrl+Shift+D"])
        self.assertEqual(self.keybinds(text), [("C-S-1", f"gapplication action {APP} shortcut \"'Ctrl+Shift+1'\""),
                                               ("C-S-d", f"gapplication action {APP} shortcut \"'Ctrl+Shift+D'\"")])
        self.assertEqual(labwc.written(text, APP), ["Ctrl+Shift+1", "Ctrl+Shift+D"])
        self.assertEqual(labwc.written(text, "app.other"), [])
        self.assertIsNone(labwc.written(labwc.MINIMAL, APP))

    def test_rewriting_replaces_only_the_block(self):
        original = ('<?xml version="1.0"?>\n<labwc_config>\n  <!-- mine -->\n  <keyboard>\n'
                    '    <keybind key="W-t"><action name="Execute" command="lxterminal"/></keybind>\n  </keyboard>\n</labwc_config>\n')
        first = labwc.insert(original, APP, ["Ctrl+Shift+1"])
        second = labwc.insert(first, APP, ["Ctrl+Shift+2"])
        self.assertEqual([key for key, _ in self.keybinds(second)], ["C-S-2", "W-t"])
        self.assertEqual(labwc.insert(second, APP, ["Ctrl+Shift+1"]), first, "writing the same keys again gives the same file")
        self.assertIn("<!-- mine -->", second)
        self.assertEqual(second.count(labwc.BEGIN), 1)

    def test_the_block_finds_or_makes_a_keyboard_section(self):
        cases = {
            "self-closing": '<labwc_config><keyboard/></labwc_config>',
            "missing": '<?xml version="1.0"?>\n<labwc_config>\n  <core/>\n</labwc_config>\n',
            "commented": '<labwc_config>\n<!-- <keyboard> example </keyboard> -->\n</labwc_config>\n',
            "openbox root": '<openbox_config>\n</openbox_config>\n',
        }
        for name, original in cases.items():
            with self.subTest(name):
                text = labwc.insert(original, APP, ["Ctrl+Shift+1"])
                self.assertEqual([key for key, _ in self.keybinds(text)], ["C-S-1"])

    def test_a_file_that_is_not_well_formed_is_refused(self):
        for original in ("<labwc_config><keyboard></labwc_config>", "", "<other/>"):
            with self.subTest(original=original), self.assertRaises(labwc.ConfigError):
                labwc.insert(original, APP, ["Ctrl+Shift+1"])

    def test_a_new_file_holds_only_the_block_when_labwc_merges_the_system_config(self):
        base = self.directory()
        system = base / "system.xml"
        system.write_text('<labwc_config><keyboard><keybind key="A-Tab"><action name="NextWindow"/></keybind></keyboard></labwc_config>')
        with mock.patch.object(labwc.subprocess, "run") as reload:
            labwc.Config(APP, base / "merged/rc.xml", True, system).write(["Ctrl+Shift+1"])
            labwc.Config(APP, base / "single/rc.xml", False, system).write(["Ctrl+Shift+1"])
        self.assertEqual(reload.call_args.args[0], ["labwc", "--reconfigure"])
        self.assertEqual([key for key, _ in self.keybinds((base / "merged/rc.xml").read_text())], ["C-S-1"])
        self.assertEqual([key for key, _ in self.keybinds((base / "single/rc.xml").read_text())], ["C-S-1", "A-Tab"],
                         "without -m a user rc.xml replaces the system one, so it starts as a copy")
        self.assertFalse((base / "merged/rc.xml.work-fleet-backup").exists(), "there was nothing to back up")

    def test_the_first_write_backs_up_the_user_file_once(self):
        path = self.directory() / "rc.xml"
        path.write_text("<labwc_config>\n</labwc_config>\n")
        path.chmod(0o600)
        config = labwc.Config(APP, path, True, None)
        self.assertEqual(config.status(["Ctrl+Shift+1"]), {"state": "absent", "path": str(path)})
        with mock.patch.object(labwc.subprocess, "run"):
            config.write(["Ctrl+Shift+1"])
            config.write(["Ctrl+Shift+2"])
        self.assertEqual(path.with_name("rc.xml.work-fleet-backup").read_text(), "<labwc_config>\n</labwc_config>\n")
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(config.keys(), ["Ctrl+Shift+2"])
        self.assertEqual(config.status(["Ctrl+Shift+2"])["state"], "current")
        self.assertEqual(config.status(["Ctrl+Shift+1"])["state"], "outdated")
        path.write_text("<labwc_config><keyboard></labwc_config>")
        with self.assertRaises(labwc.ConfigError):
            config.write(["Ctrl+Shift+1"])
        self.assertEqual(path.read_text(), "<labwc_config><keyboard></labwc_config>", "a broken file is left as it was")

    def test_detection_reads_the_running_labwc(self):
        proc = self.directory()
        (proc / "1633").mkdir()
        environ = {"LABWC_PID": "1633", "HOME": "/home/user", "XDG_CONFIG_DIRS": str(proc / "none")}
        (proc / "1633/cmdline").write_bytes(b"/usr/bin/labwc\0-m\0")
        config = labwc.Config.detect("wayland-layer-shell", APP, environ, proc)
        self.assertEqual((config.path, config.merged, config.system), (Path("/home/user/.config/labwc/rc.xml"), True, None))
        (proc / "1633/cmdline").write_bytes(b"labwc\0--config-dir\0/tmp/session\0")
        config = labwc.Config.detect("wayland-layer-shell", APP, environ, proc)
        self.assertEqual((config.path, config.merged), (Path("/tmp/session/rc.xml"), False))
        self.assertIsNone(labwc.Config.detect("x11", APP, environ, proc))
        self.assertIsNone(labwc.Config.detect("wayland-layer-shell", None, environ, proc))
        self.assertIsNone(labwc.Config.detect("wayland-layer-shell", "bad id; rm", environ, proc))
        self.assertIsNone(labwc.Config.detect("wayland-layer-shell", APP, {"HOME": "/home/user"}, proc))
        (proc / "1633/cmdline").write_bytes(b"/usr/bin/sway\0")
        self.assertIsNone(labwc.Config.detect("wayland-layer-shell", APP, environ, proc))


if __name__ == "__main__":
    unittest.main()
