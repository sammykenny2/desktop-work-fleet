"""Linux X11 global shortcuts use Keybinder's raw matching so Ctrl+Shift chords reach their handlers; fake GI, no display."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"


class FakeKeybinder(types.ModuleType):
    """Records calls like libkeybinder; a bind succeeds and keeps its handler."""
    def __init__(self):
        super().__init__("Keybinder")
        self.calls, self.handlers = [], {}

    def init(self):
        self.calls.append(("init",))

    def set_use_cooked_accelerators(self, value):
        self.calls.append(("cooked", value))

    def bind(self, chord, handler, _data):
        self.calls.append(("bind", chord)); self.handlers[chord] = handler
        return True

    def unbind(self, chord):
        self.calls.append(("unbind", chord)); self.handlers.pop(chord, None)

    def get_current_event_time(self):
        return 42


def install_fakes(test, keybinder):
    """Keybinder is imported when Shortcuts starts, so the fake GI stays installed for the whole test."""
    fake_gi = types.ModuleType("gi")
    fake_gi.require_version = lambda *_: None
    repository = types.ModuleType("gi.repository")
    repository.Gdk = repository.Gio = repository.GLib = types.SimpleNamespace()
    repository.Keybinder = keybinder
    fake_gi.repository = repository
    stubs = {"gi": fake_gi, "gi.repository": repository}
    previous = {name: sys.modules.get(name) for name in [*stubs, "protocol"]}

    def restore():
        for name, module in previous.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module
    test.addCleanup(restore)
    sys.modules.update(stubs)
    spec = importlib.util.spec_from_file_location("protocol", NATIVE / "protocol.py")
    protocol = importlib.util.module_from_spec(spec); spec.loader.exec_module(protocol)
    sys.modules["protocol"] = protocol
    spec = importlib.util.spec_from_file_location("shortcuts", NATIVE / "shortcuts.py")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


class LinuxShortcutTests(unittest.TestCase):
    def test_x11_shortcuts_use_raw_matching_before_any_binding(self):
        keybinder = FakeKeybinder()
        shortcuts = install_fakes(self, keybinder).Shortcuts("x11", lambda *_: None, lambda _values: None)
        self.assertEqual(keybinder.calls[:2], [("init",), ("cooked", False)])
        self.assertIs(shortcuts.keybinder, keybinder)

    def test_a_ctrl_shift_chord_runs_its_action(self):
        keybinder, actions = FakeKeybinder(), []
        shortcuts = install_fakes(self, keybinder).Shortcuts("x11", lambda target, time, token: actions.append((target, time)), lambda _values: None)
        result = shortcuts.configure({"bindings": [{"key": "Ctrl+Shift+D", "target": "@toggle"}, {"key": "Ctrl+Shift+1", "target": "group-1"}]})
        self.assertEqual([value["status"] for value in result["registrations"]], ["available", "available"])
        self.assertEqual(sorted(keybinder.handlers), ["<Control><Shift>1", "<Control><Shift>d"])
        keybinder.handlers["<Control><Shift>d"]("<Control><Shift>d", None)
        self.assertEqual(actions, [("@toggle", 42)])
        shortcuts.suspend(True)
        self.assertEqual(keybinder.handlers, {}, "a focused Work Fleet window releases the global chords")

    def test_labwc_keys_are_available_once_written_even_while_work_fleet_has_the_focus(self):
        class Labwc:
            def __init__(self):
                self.written = []
            def keys(self):
                return list(self.written)
            def write(self, keys):
                self.written = list(keys)
            def status(self, keys):
                return {"state": "current" if sorted(keys) == sorted(self.written) else "outdated", "path": "rc.xml"}
        config, events = Labwc(), []
        shortcuts = install_fakes(self, FakeKeybinder()).Shortcuts("wayland-layer-shell", lambda *_: None, events.append, config)
        self.assertIsNone(shortcuts.bus, "labwc has no GlobalShortcuts portal to ask")
        result = shortcuts.configure({"bindings": [{"key": "Ctrl+Shift+1", "target": "group-1"}, {"key": "Ctrl+C", "target": "group-2"}]})
        self.assertEqual([value["status"] for value in result["registrations"]], ["unwritten", "editing"])
        self.assertEqual(shortcuts.labwc_status()["state"], "outdated")
        shortcuts.write_labwc()
        self.assertEqual(config.written, ["Ctrl+Shift+1"], "keys the app keeps for text editing are not written")
        shortcuts.suspend(True)
        self.assertEqual([value["status"] for value in events[-1]], ["available", "editing"])
        self.assertEqual(shortcuts.labwc_status()["state"], "current")


if __name__ == "__main__":
    unittest.main()
