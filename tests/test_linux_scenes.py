"""The Linux native frame boundary runs without GI or a display server."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"
def load_native(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

previous = sys.modules.get("protocol")
protocol = load_native("protocol")
sys.modules["protocol"] = protocol
try:
    scenes = load_native("scenes")
finally:
    if previous is None:
        sys.modules.pop("protocol")
    else:
        sys.modules["protocol"] = previous


def projection(layer="wallpaper"):
    return {"protocol": 1, "sessionId": "layer-probe", "sequence": 1, "topology": 0,
            "workspaceRevision": 1, "layoutRevision": 1, "groups": [],
            "cards": [{"id": "paper", "groupId": "group", "text": "Synthetic layer probe",
                       "color": "#ff7799", "rect": {"x": -100, "y": 80, "width": 200, "height": 120},
                       "layer": layer, "interactive": False, "draggable": False, "editing": False,
                       "selected": False, "completed": False, "mine": False}]}


class LinuxSceneTests(unittest.TestCase):
    def test_attachment_metadata_is_presentation_only(self):
        value = projection()
        value["cards"][0]["attachments"] = [{"id": "a" * 64, "name": "proof.pdf"}]
        self.parse(value)
        value["cards"][0]["attachments"][0]["bytes"] = "not presentation data"
        with self.assertRaises(protocol.Failure):
            self.parse(value)

    def parse(self, value):
        return scenes.frame(protocol.encode(value), "layer-probe", -1)

    def test_the_owner_locale_reaches_the_scenes(self):
        # src/desktop/projection.js sends the main window's UI locale with every frame (docs/i18n.md).
        for locale in ("en", "zh-TW"):
            with self.subTest(locale=locale):
                value = {**projection(), "locale": locale}
                self.assertEqual(self.parse(value)["locale"], locale)
        self.assertNotIn("locale", self.parse(projection()))
        for locale in ("", None, 1, ["en"], "x" * 17):
            with self.subTest(locale=locale):
                with self.assertRaises(protocol.Failure):
                    self.parse({**projection(), "locale": locale})

    def test_three_layers_keep_physical_geometry(self):
        for layer in ("wallpaper", "desktop", "floating"):
            with self.subTest(layer=layer):
                value = projection(layer)
                self.assertEqual(self.parse(value), value)

    def test_wallpaper_rejects_each_input_flag(self):
        for flag in ("interactive", "draggable", "editing"):
            with self.subTest(flag=flag):
                value = projection()
                value["cards"][0][flag] = True
                with self.assertRaises(protocol.Failure):
                    self.parse(value)

    def test_unknown_layers_and_duplicate_cards_are_rejected(self):
        for value in (projection("background"), projection()):
            if value["cards"][0]["layer"] == "wallpaper":
                value["cards"].append(copy.deepcopy(value["cards"][0]))
            with self.assertRaises(protocol.Failure):
                self.parse(value)

    def test_floating_remains_interactive(self):
        value = projection("floating")
        value["cards"][0].update(interactive=True, draggable=True, editing=True)
        self.assertEqual(self.parse(value), value)

    def test_old_sessions_and_old_sequences_are_rejected(self):
        value = projection()
        with self.assertRaises(protocol.Failure):
            scenes.frame(protocol.encode(value), "other-session", -1)
        with self.assertRaises(protocol.Failure):
            scenes.frame(protocol.encode(value), "layer-probe", 1)


if __name__ == "__main__":
    unittest.main()
