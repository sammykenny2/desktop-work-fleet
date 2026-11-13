"""The Linux tray shows a hidden main window only when a tray it had goes away (ADR-043), using fake GI without a display."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"
# tray.py imports the host's string table, text.py, which needs no GI.
sys.path.insert(0, str(NATIVE))
import text  # noqa: E402


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


class Notifier:
    def __init__(self, _app_id, _menu, activate, popup, menu_active, connected, _icon):
        self.activate, self.popup, self.menu_active, self.connected = activate, popup, menu_active, connected

    def relabel(self):
        pass

    def close(self):
        pass


class MenuItem:
    """Records its label, as the indicator exports it."""
    def __init__(self, label):
        self.label = label

    @classmethod
    def new_with_label(cls, label):
        return cls(label)

    def set_label(self, label):
        self.label = label

    def connect(self, *_args):
        pass


class Window:
    def __init__(self, visible=False):
        self.visible = visible

    def get_visible(self):
        return self.visible


class LinuxTrayTests(unittest.TestCase):
    def setUp(self):
        self.session_bus = True
        gi = types.ModuleType("gi")

        repository = types.ModuleType("gi.repository")
        repository.Gtk = Anything()
        repository.Gtk.StatusIcon = StatusIcon
        repository.Gtk.MenuItem = MenuItem
        repository.GLib = types.SimpleNamespace(Error=RuntimeError)
        repository.Gdk = types.SimpleNamespace(Display=types.SimpleNamespace(get_default=lambda: types.SimpleNamespace(__gtype__=types.SimpleNamespace(name="GdkX11Display"))))
        gi.repository = repository
        def notifier(*args):
            if not self.session_bus:
                raise RuntimeError("No session bus")
            return Notifier(*args)
        patcher = mock.patch.dict(sys.modules, {"gi": gi, "gi.repository": repository,
                                              "statusnotifier": types.SimpleNamespace(StatusNotifier=notifier)})
        patcher.start()
        self.addCleanup(patcher.stop)
        spec = importlib.util.spec_from_file_location("tray", NATIVE / "tray.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.revealed, self.changes = [], []

    def create(self, visible=False):
        self.window = Window(visible)
        self.actions, self.menu_states = [], []
        return self.module.Tray("dev.sammykenny2.pinitanywhere.test", self.window, lambda target, *_: self.actions.append(target), None, self.menu_states.append, reveal=lambda: self.revealed.append(True),
                                changed=self.changes.append)

    def test_primary_click_opens_the_window_in_both_tray_backends(self):
        tray = self.create()
        tray.indicator.activate()
        self.assertEqual(self.actions, ["show"])
        self.assertEqual(self.menu_states, [False])
        tray.icon.handlers["activate"]()
        self.assertEqual(self.actions, ["show", "show"])

    def test_the_native_context_menu_does_not_activate_the_window(self):
        tray = self.create()
        tray.menu = mock.Mock()
        tray.icon.handlers["popup-menu"](tray.icon, 3, 1234)
        tray.menu.popup.assert_called_once()
        self.assertEqual(self.actions, [])

    def labels(self, tray):
        return [item.label for item, _key in tray.items]

    def test_the_menu_follows_the_display_language(self):
        self.addCleanup(text.set_locale, "en")
        tray = self.module.Tray("dev.sammykenny2.pinitanywhere.test", Window(), None, None, None, update=lambda: None)
        self.assertEqual(self.labels(tray), ["Open Pin It Anywhere", "Quick capture", "Adjust all groups", "Show or hide desktop notes",
                                             "Check for updates…", "Save and quit"])
        text.set_locale("zh-TW")
        tray.relabel()
        self.assertEqual(self.labels(tray), [text.ZH_TW[key] for key in ("tray.open", "tray.quickCapture", "tray.adjustAll",
                                                                          "tray.toggleDesktop", "tray.checkUpdates", "tray.saveAndQuit")])
        # A tray started in Traditional Chinese, as at a sign-in start, draws it from the first frame.
        self.assertEqual(self.labels(self.module.Tray("dev.sammykenny2.pinitanywhere.test", Window(), None, None, None))[0], text.ZH_TW["tray.open"])
        text.set_locale("en")
        tray.close()
        tray.relabel()
        self.assertEqual(self.labels(tray)[0], text.ZH_TW["tray.open"], "a closed tray is left alone")

    def test_a_watcher_not_there_yet_leaves_a_hidden_start_to_the_wait(self):
        tray = self.create()
        changed = lambda _indicator, connected: tray.indicator.connected(connected)
        # A missing StatusNotifierWatcher at startup does not mean an available tray was lost.
        changed(tray.indicator, False)
        self.assertEqual((tray.available, self.revealed), (False, []))
        changed(tray.indicator, True)
        self.assertEqual((tray.available, self.revealed), (True, []))
        # Only changes reach host.log: the first report of a missing watcher was not one.
        changed(tray.indicator, True)
        self.assertEqual(self.changes, [True])

    def test_losing_a_connected_tray_shows_the_hidden_window(self):
        tray = self.create()
        changed = lambda _indicator, connected: tray.indicator.connected(connected)
        changed(tray.indicator, True)
        changed(tray.indicator, False)
        self.assertEqual((tray.available, self.revealed), (False, [True]))

    def test_losing_the_tray_leaves_a_visible_window_and_a_closed_tray_alone(self):
        tray = self.create(visible=True)
        changed = lambda _indicator, connected: tray.indicator.connected(connected)
        changed(tray.indicator, True)
        changed(tray.indicator, False)
        self.assertEqual(self.revealed, [])
        tray = self.create()
        changed = lambda _indicator, connected: tray.indicator.connected(connected)
        changed(tray.indicator, True)
        tray.close()
        changed(tray.indicator, False)
        self.assertEqual(self.revealed, [])

    def test_a_status_icon_waits_for_embedding_before_a_loss_counts(self):
        self.session_bus = False
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
