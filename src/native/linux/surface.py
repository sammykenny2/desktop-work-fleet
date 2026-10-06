"""GTK input regions and X11/Wayland presentation; all card ordering stays in the renderer."""
import math
import time
import cairo
import gi
gi.require_version("Gtk", "3.0")
gi.require_foreign("cairo")
from gi.repository import Gdk, GLib, Gtk
try:
    gi.require_version("GtkLayerShell", "0.1")
    from gi.repository import GtkLayerShell as Layer
except (ValueError, ImportError):
    Layer = None

import protocol as p
from scenes import intersection


def backend():
    name = type(Gdk.Display.get_default()).__name__.lower()
    if "x11" in name:
        return "x11"
    if "wayland" in name and Layer is not None and Layer.is_supported():
        return "wayland-layer-shell"
    return None


def layers(mode):
    return ("desktop", "floating", "wallpaper") if mode == "wayland-layer-shell" else ("desktop", "floating")


def rectangle(value):
    return {"x": value.x, "y": value.y, "width": value.width, "height": value.height}


class Surface:
    def __init__(self, display, layer, assets, web_factory, dispatch, lost, dismiss, mode):
        p.require(layer in layers(mode), "desktop-layer", "此桌面環境沒有要求的層級。")
        self.id, self.layer, self.display = p.identifier(), layer, display
        self.viewport = display["viewport"]
        self.ready = self.retired = False
        self.active = True
        self.initialized = False
        self.applied = -1
        self.downloading = self.download = None
        self.last_input = 0
        self.last_timestamp = 0
        self.repaint_timer = None
        self.input_region = cairo.Region()
        self.mode, self.dispatch, self.lost = mode, dispatch, lost
        self.window = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
        self.window.set_title("Work Fleet desktop")
        self.window.set_decorated(False)
        self.window.set_resizable(False)
        self.window.set_skip_taskbar_hint(True)
        self.window.set_skip_pager_hint(True)
        self.window.set_focus_on_map(False)
        self.window.set_accept_focus(False)
        self.window.get_style_context().add_class("fleet-desktop")
        css = Gtk.CssProvider()
        css.load_from_data(b".fleet-desktop { background: transparent; }")
        self.window.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        visual = self.window.get_screen().get_rgba_visual()
        if visual is not None:
            self.window.set_visual(visual)
        if mode == "wayland-layer-shell":
            Layer.init_for_window(self.window)
            Layer.set_namespace(self.window, "work-fleet")
            Layer.set_layer(self.window, {"wallpaper": Layer.Layer.BACKGROUND, "desktop": Layer.Layer.BOTTOM, "floating": Layer.Layer.TOP}[layer])
            Layer.set_exclusive_zone(self.window, -1)
            for edge in (Layer.Edge.TOP, Layer.Edge.BOTTOM, Layer.Edge.LEFT, Layer.Edge.RIGHT):
                Layer.set_anchor(self.window, edge, True)
            Layer.set_keyboard_mode(self.window, Layer.KeyboardMode.NONE)
        else:
            self.window.set_type_hint(Gdk.WindowTypeHint.UTILITY if layer == "floating" else Gdk.WindowTypeHint.DESKTOP)
            self.window.set_keep_above(layer == "floating")
            self.window.set_keep_below(layer == "desktop")
            self.window.stick()
        self.local = web_factory(assets, "workfleet://app/desktop/index.html", self.receive, lambda: lost(self))
        self.local.context.connect("download-started", lambda _context, download: download.cancel())
        self.local.web.set_background_color(Gdk.RGBA(0, 0, 0, 0))
        self.local.web.connect("button-press-event", self.input)
        self.local.web.connect("key-press-event", self.input)
        self.window.connect("delete-event", lambda *_: (dismiss(self.id), True)[1])
        self.window.connect("realize", lambda *_: self.suspend())
        self.window.connect("configure-event", self.reconfigured)
        self.window.connect("map-event", self.reconfigured)
        self.window.add(self.local.web)
        self.set_display(display)
        self.window.realize()
        self.suspend()
    def start(self):
        if self.initialized or self.retired:
            return
        self.initialized = True
        # The scene maps with an empty native input region before WebKit starts.
        self.window.show_all()
        self.suspend()
        self.local.load(lambda error: self.lost(self) if error else None)

    def info(self):
        return {"viewId": self.id, "layer": self.layer, "active": self.active, "viewport": self.viewport}

    def input(self, _web, event):
        if self.layer == "wallpaper":
            return True
        self.last_input = time.monotonic()
        self.last_timestamp = int(getattr(event, "time", 0))
        return False

    def receive(self, value):
        try:
            p.require(not self.retired and p.number(value, "v", 1) == 1 and p.is_uuid(value.get("id")) and isinstance(value.get("params"), dict), "scene-command", "桌面訊息無效。")
            result = self.dispatch(self, p.text(value, "method"), value["params"])
            self.local.post({"v": 1, "id": value["id"], "ok": True, "result": result})
        except Exception as error:
            if p.is_uuid(value.get("id")):
                failure = error if isinstance(error, p.Failure) else p.Failure("scene-command", "桌面操作未完成，請保留未保存文字。")
                self.local.post({"v": 1, "id": value["id"], "ok": False, "error": {"code": failure.code, "message": str(failure)}})

    def set_display(self, display):
        self.suspend()
        self.display, self.viewport = display, display["viewport"]
        self.applied = -1
        if self.mode == "wayland-layer-shell":
            Layer.set_monitor(self.window, display["monitor"])
            self.window.set_size_request(int(self.viewport["width"]), int(self.viewport["height"]))
        else:
            self.window.move(int(self.viewport["x"]), int(self.viewport["y"]))
            self.window.resize(int(self.viewport["width"]), int(self.viewport["height"]))
        self.schedule_repaint()

    def reconfigured(self, *_):
        self.schedule_repaint()
        return False

    def schedule_repaint(self):
        if self.repaint_timer is not None:
            GLib.source_remove(self.repaint_timer)
        def repaint():
            self.repaint_timer = None
            if not self.retired and self.initialized:
                self.local.event("desktop-repaint")
            return False
        self.repaint_timer = GLib.timeout_add(120, repaint)

    def set_input_region(self, region):
        self.input_region = region
        # GTK keeps the widget shape when a layer surface receives a new allocation.
        if self.window.get_realized():
            self.window.input_shape_combine_region(region)
        self.window.set_accept_focus(not region.is_empty())
        if self.mode == "wayland-layer-shell":
            Layer.set_keyboard_mode(self.window, Layer.KeyboardMode.NONE if region.is_empty() else Layer.KeyboardMode.ON_DEMAND)
        self.window.queue_draw()

    def suspend(self):
        self.set_input_region(cairo.Region())

    def apply(self, frame):
        cards = [card for card in frame["cards"] if card["layer"] == self.layer and intersection(card["rect"], self.viewport) is not None]
        notice = frame.get("notice") if self.layer == "floating" else None
        if not cards and (notice is None or intersection(notice["rect"], self.viewport) is None):
            self.suspend()
            self.window.hide()
            return
        region = cairo.Region()
        for card in cards:
            paper = intersection(card["rect"], self.viewport)
            x, y = math.floor(paper["x"] - self.viewport["x"]), math.floor(paper["y"] - self.viewport["y"])
            right = math.ceil(paper["x"] + paper["width"] - self.viewport["x"])
            bottom = math.ceil(paper["y"] + paper["height"] - self.viewport["y"])
            clipped = cairo.RectangleInt(x, y, right - x, bottom - y)
            region.subtract(clipped)
            if self.layer != "wallpaper" and card["interactive"]:
                region.union(clipped)
        self.set_input_region(region)
        self.window.show_all()
        self.schedule_repaint()

    def focus(self, timestamp=0):
        if self.layer != "floating" or self.retired or not self.active or self.input_region.is_empty():
            return
        self.window.set_accept_focus(True)
        self.window.present_with_time(timestamp or Gdk.CURRENT_TIME)
        self.local.web.grab_focus()
        self.local.event("desktop-focus")

    def close(self):
        if self.retired:
            return
        self.retired = True
        if self.repaint_timer is not None:
            GLib.source_remove(self.repaint_timer)
            self.repaint_timer = None
        self.local.close()
        self.window.destroy()
