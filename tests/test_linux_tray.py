"""The Linux tray shows a hidden main window only when a tray it had goes away (ADR-043), using fake GI without a display."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"


class Anything:
    """Stands in for GTK widgets: every attribute is callable and returns another stand-in."""
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return Anything()

    def __call__(self, *_args, **_kwargs):
        return Anything()


class Indicator:
    def __init__(self):
        self.handlers = {}
        self.title = None

    @classmethod
    def new(cls, *_args):
        return cls()

    def connect(self, name, handler):
        self.handlers[name] = handler

    def set_title(self, title):
        self.title = title

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return lambda *_args, **_kwargs: None


class StatusIcon(Indicator):
    embedded = False
    position_menu = None

    @classmethod
    def new_from_icon_name(cls, _name):
        return cls()

    def is_embedded(self):
        return self.embedded


class Window:
    def __init__(self, visible=False):
        self.visible = visible

    def get_visible(self):
        return self.visible


class LinuxTrayTests(unittest.TestCase):
    def setUp(self):
        self.indicators = {"AyatanaAppIndicator3"}
        gi = types.ModuleType("gi")

        def require_version(namespace, _version):
            if namespace.endswith("AppIndicator3") and namespace not in self.indicators:
                raise ValueError(namespace)
        gi.require_version = require_version
        repository = types.ModuleType("gi.repository")
        repository.Gtk = Anything()
        repository.Gtk.StatusIcon = StatusIcon
        repository.AyatanaAppIndicator3 = types.SimpleNamespace(
            Indicator=Indicator, IndicatorCategory=types.SimpleNamespace(APPLICATION_STATUS=0),
            IndicatorStatus=types.SimpleNamespace(ACTIVE=1, PASSIVE=0))
        gi.repository = repository
        patcher = mock.patch.dict(sys.modules, {"gi": gi, "gi.repository": repository})
        patcher.start()
        self.addCleanup(patcher.stop)
        spec = importlib.util.spec_from_file_location("tray", NATIVE / "tray.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.revealed, self.changes = [], []

    def create(self, visible=False):
        self.window = Window(visible)
        return self.module.Tray("app.workfleet.test", self.window, None, None, None, reveal=lambda: self.revealed.append(True),
                                changed=self.changes.append)

    def test_the_indicator_shows_the_product_name_on_hover(self):
        self.assertEqual(self.create().indicator.title, "Work Fleet")

    def test_a_watcher_not_there_yet_leaves_a_hidden_start_to_the_wait(self):
        tray = self.create()
        changed = tray.indicator.handlers["connection-changed"]
        # libayatana reports the missing StatusNotifierWatcher at once, before the panel that owns it has started.
        changed(tray.indicator, False)
        self.assertEqual((tray.available, self.revealed), (False, []))
        changed(tray.indicator, True)
        self.assertEqual((tray.available, self.revealed), (True, []))
        # Only changes reach host.log: the first report of a missing watcher was not one.
        changed(tray.indicator, True)
        self.assertEqual(self.changes, [True])

    def test_losing_a_connected_tray_shows_the_hidden_window(self):
        tray = self.create()
        changed = tray.indicator.handlers["connection-changed"]
        changed(tray.indicator, True)
        changed(tray.indicator, False)
        self.assertEqual((tray.available, self.revealed), (False, [True]))

    def test_losing_the_tray_leaves_a_visible_window_and_a_closed_tray_alone(self):
        tray = self.create(visible=True)
        changed = tray.indicator.handlers["connection-changed"]
        changed(tray.indicator, True)
        changed(tray.indicator, False)
        self.assertEqual(self.revealed, [])
        tray = self.create()
        changed = tray.indicator.handlers["connection-changed"]
        changed(tray.indicator, True)
        tray.close()
        changed(tray.indicator, False)
        self.assertEqual(self.revealed, [])

    def test_a_status_icon_waits_for_embedding_before_a_loss_counts(self):
        self.indicators = set()
        tray = self.create()
        self.assertIsNone(tray.indicator)
        embedded = tray.icon.handlers["notify::embedded"]
        embedded()
        self.assertEqual((tray.available, self.revealed), (False, []))
        tray.icon.embedded = True
        embedded()
        tray.icon.embedded = False
        embedded()
        self.assertEqual((tray.available, self.revealed), (False, [True]))


if __name__ == "__main__":
    unittest.main()
