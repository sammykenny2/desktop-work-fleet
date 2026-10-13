"""Linux scene windows take the viewport size and the desktop shell's layer set, using fake GI/cairo without a display."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"
VIEWPORT = {"x": 70, "y": 27, "width": 954, "height": 741}
XWAYLAND = {"XDG_CURRENT_DESKTOP": "ubuntu:GNOME", "XDG_SESSION_TYPE": "wayland", "WAYLAND_DISPLAY": "wayland-0"}
XORG = {"XDG_CURRENT_DESKTOP": "ubuntu:GNOME", "XDG_SESSION_TYPE": "x11"}
OTHER = {"XDG_CURRENT_DESKTOP": "LXDE", "XDG_SESSION_TYPE": "x11"}


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
        # The machine running the tests may have its own pcmanfm desktop; each test chooses.
        self.surface.shared_background = lambda: False

    def create(self, layer, environ=OTHER, mode="x11"):
        display = {"id": "display-1", "viewport": dict(VIEWPORT), "monitor": None}
        web = lambda *_: Fake(self.journal, "web")
        if mode == "wayland-layer-shell":
            self.surface.Layer = Fake(self.journal, "Layer")
        # The session decides the layers, so the test pins it instead of inheriting the one it runs in.
        with mock.patch.dict(os.environ, environ, clear=True):
            return self.surface.Surface(display, layer, "assets", web, None, None, None, mode)

    def type_hints(self):
        return [args[0]._path.rsplit(".", 1)[1] for args in self.window_calls("set_type_hint")]

    def window_calls(self, method):
        return [args for path, args in self.journal if path == f"Gtk.Window().{method}"]

    def keyboard_modes(self):
        return [args[1]._path.rsplit(".", 1)[1] for path, args in self.journal if path == "Layer.set_keyboard_mode"]

    def test_gnome_xwayland_offers_wallpaper_and_floating(self):
        layers = self.surface.layers
        for desktop in ("ubuntu:GNOME", "GNOME", "GNOME-Classic:GNOME", "gnome"):
            with self.subTest(desktop=desktop):
                self.assertEqual(layers("x11", {**XWAYLAND, "XDG_CURRENT_DESKTOP": desktop}), ("wallpaper", "floating"))
        self.assertEqual(layers("x11", {"XDG_CURRENT_DESKTOP": "GNOME", "WAYLAND_DISPLAY": "wayland-0"}), ("wallpaper", "floating"))
        for environ in (OTHER, {"XDG_CURRENT_DESKTOP": "XFCE"}, {}):
            with self.subTest(environ=environ):
                self.assertEqual(layers("x11", environ), ("desktop", "floating"))
        self.assertEqual(layers("wayland-layer-shell", XWAYLAND), ("desktop", "floating", "wallpaper"))

    def test_gnome_xorg_offers_all_three_layers_without_the_overlay(self):
        self.assertEqual(self.surface.layers("x11", XORG), ("desktop", "floating", "wallpaper"))
        self.assertEqual(self.surface.resident_layers("x11", XORG), ("desktop", "floating", "wallpaper"))
        self.assertFalse(self.surface.adjust_overlay("x11", XORG))
        self.assertEqual(self.surface.wallpaper_placement("x11", self.surface.layers("x11", XORG)), "desktop-window")

    def test_gnome_xorg_desktop_layer_is_an_ordinary_window_kept_below(self):
        expected = {"desktop": ("NORMAL", True, False), "wallpaper": ("DESKTOP", True, False), "floating": ("UTILITY", False, True)}
        for layer, (hint, below, above) in expected.items():
            with self.subTest(layer=layer):
                self.journal.clear()
                self.assertFalse(self.create(layer, XORG).info()["adjustOverlay"])
                self.assertEqual(self.type_hints(), [hint])
                self.assertEqual(self.window_calls("set_keep_below"), [(below,)])
                self.assertEqual(self.window_calls("set_keep_above"), [(above,)])
        self.journal.clear()
        self.create("desktop", OTHER)
        self.assertEqual(self.type_hints(), ["DESKTOP"], "other X11 desktops keep the desktop-type window")

    def test_gnome_xorg_topmost_scene_takes_focus_with_its_papers(self):
        view = self.create("floating", XORG)
        paper = {"layer": "floating", "rect": {"x": 100, "y": 100, "width": 200, "height": 120}, "interactive": True}
        self.journal.clear()
        view.apply({"operationScope": {"kind": "group"}, "cards": [paper]})
        self.assertEqual(view.input_region.rectangles, [(30, 73, 200, 120)], "no overlay on GNOME Xorg")
        self.assertEqual(self.window_calls("set_accept_focus"), [(True,)])

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

    def test_gnome_xwayland_wallpaper_is_a_desktop_window_kept_below(self):
        self.create("wallpaper", XWAYLAND)
        self.assertEqual(self.type_hints(), ["DESKTOP"])
        self.assertEqual(self.window_calls("set_keep_below"), [(True,)])
        self.assertEqual(self.window_calls("set_keep_above"), [(False,)])
        self.journal.clear()
        self.create("floating", XWAYLAND)
        self.assertEqual(self.type_hints(), ["UTILITY"])
        self.assertEqual(self.window_calls("set_keep_below"), [(False,)])
        self.assertEqual(self.window_calls("set_keep_above"), [(True,)])

    def test_gnome_xwayland_adjust_mode_is_an_overlay_and_papers_rest_on_the_wallpaper(self):
        gnome, other = XWAYLAND, OTHER
        self.assertTrue(self.surface.adjust_overlay("x11", gnome))
        self.assertFalse(self.surface.adjust_overlay("x11", other))
        self.assertEqual(self.surface.resident_layers("x11", gnome), ("wallpaper",))
        self.assertEqual(self.surface.resident_layers("x11", other), ("desktop", "floating"))
        self.assertTrue(self.create("floating", XWAYLAND).info()["adjustOverlay"])
        self.assertFalse(self.create("wallpaper", XWAYLAND).info()["adjustOverlay"])
        self.assertFalse(self.create("floating", OTHER).info()["adjustOverlay"])

    def frame(self, kind, cards=()):
        return {"operationScope": {"kind": kind}, "cards": list(cards)}

    def test_gnome_xwayland_overlay_covers_the_work_area_while_adjusting(self):
        view = self.create("floating", XWAYLAND)
        self.journal.clear()
        view.apply(self.frame("group"))
        self.assertEqual(view.input_region.rectangles, [(0, 0, VIEWPORT["width"], VIEWPORT["height"])],
                         "the overlay takes the whole work area even on a monitor without papers")
        self.assertTrue(self.window_calls("show_all"))
        self.assertEqual(len(self.window_calls("present")), 1, "the overlay takes the keys as it appears")
        self.journal.clear()
        view.apply(self.frame("group"))
        self.assertEqual(self.window_calls("present"), [], "a later frame does not take the focus again")
        paper = {"layer": "floating", "rect": {"x": 100, "y": 100, "width": 200, "height": 120}, "interactive": True}
        view.apply(self.frame("none", [paper]))
        self.assertEqual(view.input_region.rectangles, [(30, 73, 200, 120)], "outside adjust mode only papers take clicks")
        self.journal.clear()
        view.apply(self.frame("none"))
        self.assertTrue(self.window_calls("hide"))

    def processes(self, *entries):
        root = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(root))
        (root / "self").mkdir()
        for pid, argv, environ in entries:
            (root / pid).mkdir()
            (root / pid / "cmdline").write_bytes(b"\0".join(argv) + b"\0")
            (root / pid / "environ").write_bytes(b"".join(key + b"=" + value + b"\0" for key, value in environ.items()))
        return root

    def test_pcmanfm_desktop_counts_only_on_this_wayland_display(self):
        ours = {"XDG_RUNTIME_DIR": "/run/user/1000", "WAYLAND_DISPLAY": "wayland-0"}
        session = {b"XDG_RUNTIME_DIR": b"/run/user/1000", b"WAYLAND_DISPLAY": b"wayland-0"}
        desktop = (b"pcmanfm", b"--desktop")
        self.assertTrue(self.surface.pcmanfm_desktop(ours, self.processes(("2080", desktop, session))))
        self.assertTrue(self.surface.pcmanfm_desktop(ours, self.processes(("2080", (b"/usr/bin/pcmanfm", b"--desktop"), session))))
        cases = {
            "file manager window": self.processes(("2080", (b"pcmanfm", b"/home"), session)),
            "another session": self.processes(("2080", desktop, {**session, b"XDG_RUNTIME_DIR": b"/tmp/headless"})),
            "no Wayland display": self.processes(("2080", desktop, {b"XDG_RUNTIME_DIR": b"/run/user/1000"})),
            "other program": self.processes(("2080", (b"pcmanfm-pi", b"--desktop"), session)),
            "none": self.processes(),
        }
        for name, root in cases.items():
            with self.subTest(name):
                self.assertFalse(self.surface.pcmanfm_desktop(ours, root))
        self.assertFalse(self.surface.pcmanfm_desktop({}, self.processes(("2080", desktop, session))))

    def test_layer_shell_under_pcmanfm_desktop_has_no_wallpaper_layer(self):
        self.surface.shared_background = lambda: True
        self.assertEqual(self.surface.layers("wayland-layer-shell"), ("desktop", "floating"))
        self.assertEqual(self.surface.resident_layers("wayland-layer-shell"), ("desktop", "floating"))
        self.assertEqual(self.surface.wallpaper_placement("wayland-layer-shell", self.surface.layers("wayland-layer-shell")), "unavailable")
        self.assertTrue(self.surface.adjust_overlay("wayland-layer-shell"))
        with self.assertRaises(Exception) as caught:
            self.create("wallpaper", mode="wayland-layer-shell")
        self.assertEqual(getattr(caught.exception, "code", None), "desktop-layer")
        self.assertEqual(self.surface.layers("x11", XORG), ("desktop", "floating", "wallpaper"), "X11 does not look for pcmanfm")

    def test_layer_shell_adjust_mode_is_an_overlay_and_papers_keep_every_layer(self):
        for environ in ({"XDG_CURRENT_DESKTOP": "labwc:wlroots", "XDG_SESSION_TYPE": "wayland"}, {"XDG_CURRENT_DESKTOP": "KDE"}, {}):
            with self.subTest(environ=environ):
                self.assertTrue(self.surface.adjust_overlay("wayland-layer-shell", environ))
                self.assertEqual(self.surface.resident_layers("wayland-layer-shell", environ), ("desktop", "floating", "wallpaper"))
        self.assertTrue(self.create("floating", mode="wayland-layer-shell").info()["adjustOverlay"])
        for layer in ("desktop", "wallpaper"):
            with self.subTest(layer=layer):
                self.assertFalse(self.create(layer, mode="wayland-layer-shell").info()["adjustOverlay"])

    def test_layer_shell_overlay_covers_the_screen_and_takes_the_keyboard_while_adjusting(self):
        view = self.create("floating", mode="wayland-layer-shell")
        resting = {"layer": "floating", "rect": {"x": 100, "y": 100, "width": 200, "height": 120}, "interactive": True}
        self.journal.clear()
        view.apply(self.frame("group", [resting]))
        self.assertEqual(view.input_region.rectangles, [(0, 0, VIEWPORT["width"], VIEWPORT["height"])],
                         "resting topmost papers sit under the overlay, which takes every click")
        self.assertEqual(self.keyboard_modes(), ["EXCLUSIVE"], "Esc reaches the overlay without a click first")
        self.journal.clear()
        view.apply(self.frame("none", [resting]))
        self.assertEqual(view.input_region.rectangles, [(30, 73, 200, 120)])
        self.assertEqual(self.keyboard_modes(), ["ON_DEMAND"], "resting papers take the keys only when clicked")
        self.journal.clear()
        view.apply(self.frame("none"))
        self.assertEqual(self.keyboard_modes(), ["NONE"])
        self.assertTrue(self.window_calls("hide"))

    def test_other_x11_topmost_scene_keeps_paper_regions_while_adjusting(self):
        view = self.create("floating", OTHER)
        paper = {"layer": "floating", "rect": {"x": 100, "y": 100, "width": 200, "height": 120}, "interactive": True}
        view.apply(self.frame("group", [paper]))
        self.assertEqual(view.input_region.rectangles, [(30, 73, 200, 120)])

    def test_a_hidden_window_returns_where_it_was(self):
        class Window:
            def __init__(self, maximized):
                self.calls, self.maximized = [], maximized
            def get_position(self):
                return (296, 234)
            def get_size(self):
                return (715, 518)
            def is_maximized(self):
                return self.maximized
            def __getattr__(self, name):
                return lambda *args: self.calls.append((name, args))
        for maximized in (False, True):
            with self.subTest(maximized=maximized):
                window = Window(maximized)
                self.surface.restore_place(window, self.surface.remember_place(window))
                expected = [("move", (296, 234)), ("resize", (715, 518))] + ([("maximize", ())] if maximized else [])
                self.assertEqual(window.calls, expected)

    def test_gnome_xwayland_refuses_the_desktop_layer(self):
        with self.assertRaises(Exception) as caught:
            self.create("desktop", XWAYLAND)
        self.assertEqual(getattr(caught.exception, "code", None), "desktop-layer")


if __name__ == "__main__":
    unittest.main()
