"""Real GTK/WebKit/layer-shell probe in an isolated graphical Linux session."""
import base64
import cairo
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/native/linux"))
from host import LocalWeb
from desktop import Desktop
from surface import Layer
import protocol as p
from gi.repository import Gdk, GLib, Gtk, WebKit2


def spin(predicate, seconds=20):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        while GLib.MainContext.default().pending():
            GLib.MainContext.default().iteration(False)
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("Native scene timed out")


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def publish(desktop, frame):
    frame = {**frame, "sessionId": desktop.session, "topology": desktop.topology}
    data = p.encode(frame)
    token = desktop.invoke("desktop.frame.begin", {"size": len(data), "sha256": p.digest(data)})["token"]
    for offset in range(0, len(data), p.CHUNK):
        desktop.invoke("desktop.frame.append", {"token": token, "offset": offset, "base64": base64.b64encode(data[offset:offset + p.CHUNK]).decode()})
    desktop.invoke("desktop.frame.publish", {"token": token})
    try:
        spin(lambda: all(view.ready and view.applied == frame["sequence"] for view in desktop.views if view.active))
    except Exception:
        print(json.dumps({"pending": desktop.pending, "topology": desktop.topology,
            "views": [{**view.info(), "ready": view.ready, "applied": view.applied,
                "download": view.downloading is not None} for view in desktop.views]}), flush=True)
        raise


def snapshot(view, path):
    result = []
    def saved(web, request, *_):
        try:
            image = web.get_snapshot_finish(request)
            image.write_to_png(str(path))
            result.append(None)
        except Exception as error:
            result.append(error)
    view.local.web.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, saved, None)
    spin(lambda: bool(result))
    if result[0]:
        raise result[0]
    image = cairo.ImageSurface.create_from_png(str(path))
    image.flush()
    # An opaque paper must really render, rather than only reporting a mapped HWND.
    data = image.get_data()
    check(any(data[index] > 200 for index in range(3, len(data), 4)), "WebKit produced a blank/transparent paper")


def compositor_image(path):
    start = time.monotonic()
    spin(lambda: time.monotonic() - start > 0.2)
    subprocess.run(["grim", str(path)], check=True)
    return cairo.ImageSurface.create_from_png(str(path))


def color_at(image, card):
    rect = card["rect"]
    return pixel_at(image, int(rect["x"] + rect["width"] / 2), int(rect["y"] + rect["height"] * 0.8))


def pixel_at(image, x, y):
    data = image.get_data()
    offset = y * image.get_stride() + x * 4
    return tuple(data[offset + index] for index in (2, 1, 0))


def main():
    Gtk.init([])
    output, scenarios = Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text())
    output.mkdir(parents=True, exist_ok=True)
    events = []
    main = Gtk.Window()
    cover = Gtk.Window()
    cover.set_decorated(False)
    cover.set_default_size(1280, 720)
    cover.set_name("probe-normal-app")
    css = Gtk.CssProvider()
    css.load_from_data(b"#probe-normal-app { background: #154ba8; }")
    cover.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    desktop = Desktop(ROOT / "build/app", LocalWeb, lambda name, **values: events.append((name, values)), main, lambda: False)
    check(desktop.mode == "wayland-layer-shell", "The test requires a real layer-shell compositor")
    try:
        info = desktop.invoke("desktop.start", {})
        check(info["layers"] == ["desktop", "floating", "wallpaper"], "Missing third native scene")
        check(info["wallpaperPlacement"] == "background", "Linux must report the icon-stacking limitation")
        check(info["adjustOverlay"] is True and info["residentLayers"] == info["layers"], "Layer-shell adjust mode must be an overlay over every resting layer")
        spin(lambda: all(view.ready for view in desktop.views))
        views = {view.layer: view for view in desktop.views}
        for layer, native in (("wallpaper", Layer.Layer.BACKGROUND), ("desktop", Layer.Layer.BOTTOM), ("floating", Layer.Layer.TOP)):
            check(Layer.get_layer(views[layer].window) == native, "Wrong native layer: " + layer)
            check(views[layer].window.get_size().width > 0, "Zero-size WebKit surface")
        for scenario in scenarios:
            if scenario["name"] == "operate-group":
                cover.maximize()
                cover.show_all()
                spin(lambda: cover.get_allocated_width() >= 1000)
            if scenario["name"] == "wallpaper-again":
                cover.hide()
            publish(desktop, scenario["frame"])
            cards = scenario["frame"]["cards"]
            for layer, view in views.items():
                visible = [card for card in cards if card["layer"] == layer]
                notice = layer == "floating" and scenario["frame"].get("notice") is not None
                check(view.window.get_visible() == bool(visible or notice), "Unexpected scene visibility: " + scenario["name"] + "/" + layer)
                if notice and not visible:
                    check(view.input_region.is_empty(), "Stage notice captured input")
                if layer == "wallpaper":
                    check(view.input_region.is_empty() and not view.window.get_accept_focus(), "Wallpaper captured input")
                    check(Layer.get_keyboard_mode(view.window) == Layer.KeyboardMode.NONE, "Wallpaper captured keyboard")
                    view.focus()
                    check(not view.window.get_accept_focus(), "Wallpaper accepted explicit focus")
                if layer == "floating" and scenario["frame"]["operationScope"]["kind"] != "none":
                    width, height = view.window.get_size()
                    check(view.input_region.contains_point(1, 1) and view.input_region.contains_point(width - 2, height - 2), "Adjust overlay left clicks to the windows below")
                    check(Layer.get_keyboard_mode(view.window) == Layer.KeyboardMode.EXCLUSIVE, "Adjust overlay did not take the keyboard")
                if visible:
                    # Snapshot the real WebKit view after native map/reconfigure repaint.
                    spin(lambda: view.repaint_timer is None)
                    snapshot(view, output / (scenario["name"] + "-" + layer + ".png"))
            image = compositor_image(output / (scenario["name"] + "-compositor.png"))
            primary = next((card for card in cards if card["id"] == scenario["primary"]), None)
            if primary is not None:
                actual = color_at(image, primary)
                if cover.get_visible() and primary["layer"] != "floating":
                    expected = (21, 75, 168)
                else:
                    expected = tuple(int(primary["color"][index:index + 2], 16) for index in (1, 3, 5))
                check(all(abs(a - b) < 5 for a, b in zip(actual, expected)), "Wrong actual compositor stacking/pixels: " + scenario["name"] + str(actual))
            if cover.get_visible():
                # Away from every paper the cover app shows through, tinted only while the adjust overlay is up.
                blue = pixel_at(image, image.get_width() - 40, image.get_height() - 40)[2]
                adjusting = scenario["frame"]["operationScope"]["kind"] != "none"
                check(blue < 150 if adjusting else abs(blue - 168) < 5, "Wrong adjust overlay tint: " + scenario["name"] + str(blue))
            print("PASS native scene " + scenario["name"], flush=True)
        ids = [view.id for view in desktop.views]
        desktop.refresh_displays()
        spin(lambda: any(name == "desktop-displays" for name, _ in events))
        topology = next(value["topology"] for name, value in reversed(events) if name == "desktop-displays")
        desktop.apply_displays({"topology": topology, "editorViewId": None})
        check(ids == [view.id for view in desktop.views], "Topology unnecessarily recreated WebViews")
        final = {**scenarios[0]["frame"], "sequence": 100}
        publish(desktop, final)
        wallpaper = views["wallpaper"]
        wallpaper.window.resize(640, 480)
        spin(lambda: wallpaper.repaint_timer is None)
        check(wallpaper.input_region.is_empty(), "Reconfigure lost the passive shape")
        snapshot(wallpaper, output / "reconfigured-wallpaper.png")
        check(not any(name == "desktop-error" for name, _ in events), "Native scene reported an error")
        print("PASS native topology reuse, repeated map and passive reconfigure", flush=True)
        (output / "result.json").write_text(json.dumps({"backend": desktop.mode, "layers": info["layers"],
            "gtk": [Gtk.get_major_version(), Gtk.get_minor_version(), Gtk.get_micro_version()],
            "webkit": [WebKit2.get_major_version(), WebKit2.get_minor_version(), WebKit2.get_micro_version()],
            "scenarios": [value["name"] for value in scenarios]}, indent=2) + "\n")
    except Exception:
        print("EVENTS " + repr(events), flush=True)
        raise
    finally:
        desktop.close()
        main.destroy()
        cover.destroy()


if __name__ == "__main__":
    main()
