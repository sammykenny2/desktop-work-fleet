"""Linux scene windows take the viewport size and the desktop shell's layer set, using fake GI/cairo without a display."""
import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"
VIEWPORT = {"x": 70, "y": 27, "width": 954, "height": 741}


class Fake:
    """Stands in for any GI object: attributes are further fakes and every call is logged by its dotted path."""
    def __init__(self, journal, path):
        self._journal, self._path = journal, path

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return Fake(self._journal, f"{self._path}.{name}")

    def __call__(self, *args, **_kwargs):
        self._journal.append((self._path, args))
        return Fake(self._journal, self._path + "()")


class Region:
    def __init__(self):
        self.rectangles = []

    def is_empty(self):
        return not self.rectangles

    def union(self, rectangle):
        self.rectangles.append(rectangle)

    def subtract(self, rectangle):
        self.rectangles = [value for value in self.rectangles if value != rectangle]


def load_native(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_surface(journal):
    fake_gi = types.ModuleType("gi")
    fake_gi.require_version = fake_gi.require_foreign = lambda *_: None
    repository = types.ModuleType("gi.repository")
    for name in ("Gdk", "GLib", "Gtk"):
        setattr(repository, name, Fake(journal, name))
    fake_gi.repository = repository
    cairo = types.ModuleType("cairo")
    cairo.Region = Region
    cairo.RectangleInt = lambda *values: values
    stubs = {"gi": fake_gi, "gi.repository": repository, "cairo": cairo}
    previous = {name: sys.modules.get(name) for name in [*stubs, "protocol", "scenes"]}
    try:
        sys.modules.update(stubs)
        sys.modules["protocol"] = load_native("protocol")
        sys.modules["scenes"] = load_native("scenes")
        return load_native("surface")
    finally:
        for name, module in previous.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


class LinuxSurfaceTests(unittest.TestCase):
    def setUp(self):
        self.journal = []
        self.surface = load_surface(self.journal)

    def create(self, layer, desktop=""):
        display = {"id": "display-1", "viewport": dict(VIEWPORT), "monitor": None}
        web = lambda *_: Fake(self.journal, "web")
        with mock.patch.dict(os.environ, {"XDG_CURRENT_DESKTOP": desktop}):
            return self.surface.Surface(display, layer, "assets", web, None, None, None, "x11")

    def window_calls(self, method):
        return [args for path, args in self.journal if path == f"Gtk.Window().{method}"]

    def test_gnome_x11_offers_wallpaper_and_floating(self):
        layers = self.surface.layers
        for desktop in ("ubuntu:GNOME", "GNOME", "GNOME-Classic:GNOME", "gnome"):
            with self.subTest(desktop=desktop):
                self.assertEqual(layers("x11", {"XDG_CURRENT_DESKTOP": desktop}), ("wallpaper", "floating"))
        for environ in ({"XDG_CURRENT_DESKTOP": "LXDE"}, {"XDG_CURRENT_DESKTOP": "XFCE"}, {}):
            with self.subTest(environ=environ):
                self.assertEqual(layers("x11", environ), ("desktop", "floating"))
        self.assertEqual(layers("wayland-layer-shell", {"XDG_CURRENT_DESKTOP": "ubuntu:GNOME"}), ("desktop", "floating", "wallpaper"))

    def test_wallpaper_placement_names_the_window_kind(self):
        placement = self.surface.wallpaper_placement
        self.assertEqual(placement("wayland-layer-shell", ("desktop", "floating", "wallpaper")), "background")
        self.assertEqual(placement("x11", ("wallpaper", "floating")), "desktop-window")
        self.assertEqual(placement("x11", ("desktop", "floating")), "unavailable")

    def test_x11_scenes_cover_the_work_area(self):
        geometry, work = {"x": 0, "y": 0, "width": 1024, "height": 768}, dict(VIEWPORT)
        self.assertEqual(self.surface.scene_viewport("x11", geometry, work), work)
        self.assertEqual(self.surface.scene_viewport("wayland-layer-shell", geometry, work), geometry)

    def test_x11_window_takes_the_viewport_size(self):
        view = self.create("floating")
        self.assertIn((VIEWPORT["width"], VIEWPORT["height"]), self.window_calls("set_size_request"))
        self.assertIn((VIEWPORT["x"], VIEWPORT["y"]), self.window_calls("move"))
        self.journal.clear()
        view.set_display({"id": "display-2", "viewport": {"x": 0, "y": 0, "width": 1280, "height": 800}, "monitor": None})
        self.assertEqual(self.window_calls("set_size_request"), [(1280, 800)], "a new display resizes the window")

    def test_gnome_wallpaper_is_a_desktop_window_kept_below(self):
        self.create("wallpaper", "ubuntu:GNOME")
        self.assertEqual([args[0]._path for args in self.window_calls("set_type_hint")], ["Gdk.WindowTypeHint.DESKTOP"])
        self.assertEqual(self.window_calls("set_keep_below"), [(True,)])
        self.assertEqual(self.window_calls("set_keep_above"), [(False,)])
        self.journal.clear()
        self.create("floating", "ubuntu:GNOME")
        self.assertEqual([args[0]._path for args in self.window_calls("set_type_hint")], ["Gdk.WindowTypeHint.UTILITY"])
        self.assertEqual(self.window_calls("set_keep_below"), [(False,)])
        self.assertEqual(self.window_calls("set_keep_above"), [(True,)])

    def test_gnome_x11_refuses_the_desktop_layer(self):
        with self.assertRaises(Exception) as caught:
            self.create("desktop", "ubuntu:GNOME")
        self.assertEqual(getattr(caught.exception, "code", None), "desktop-layer")


if __name__ == "__main__":
    unittest.main()
