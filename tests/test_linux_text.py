"""The Linux host's own text and display language (docs/i18n.md): matching rules, system languages, the string table and
host.language.set. No GI or display."""
import ast
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "src/native/linux"


def load(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


text = load("text")
protocol = load("protocol")
hostsettings = load("hostsettings")
PLACEHOLDER = re.compile(r"\{([A-Za-z0-9_]+)\}")
# Protocol methods that share a prefix with table keys.
METHODS = {"update.state", "update.check", "update.download", "update.install"}


class LocaleRules(unittest.TestCase):
    def tearDown(self):
        text.set_locale("en")

    def test_tags_match_like_the_renderer(self):
        # The same cases as tests/i18n.test.js, "system languages resolve with the documented rules".
        for tag, expected in (("en", "en"), ("en-US", "en"), ("EN_gb", "en"), ("zh", "zh-TW"), ("zh-TW", "zh-TW"),
                              ("zh_TW.UTF-8", "zh-TW"), ("zh-Hant", "zh-TW"), ("zh-Hant-TW", "zh-TW"), ("zh-HK", "zh-TW"),
                              ("zh-MO", "zh-TW"), ("zh-CN", None), ("zh-Hans-CN", None), ("zh-SG", None), ("ja-JP", None),
                              ("C", None), ("C.UTF-8", None), ("", None), (None, None)):
            with self.subTest(tag=tag):
                self.assertEqual(text.match_locale(tag), expected)
        self.assertEqual(text.match_locale("en_US.UTF-8@euro"), "en")
        self.assertEqual(text.match_locale(" zh_HK "), "zh-TW")

    def test_preferences_resolve_like_the_renderer(self):
        self.assertEqual(text.resolve_locale("auto", ["ja-JP", "zh-CN", "zh-TW", "en-US"]), "zh-TW")
        self.assertEqual(text.resolve_locale("auto", ["fr-FR"]), "en")
        self.assertEqual(text.resolve_locale("auto", []), "en")
        self.assertEqual(text.resolve_locale("en", ["zh-TW"]), "en")
        self.assertEqual(text.resolve_locale("zh-TW", ["en-US"]), "zh-TW")
        self.assertEqual(text.resolve_locale("fr", ["zh-TW"]), "zh-TW")

    def test_system_languages_come_from_the_posix_variables_in_order(self):
        environ = {"LANGUAGE": "zh_TW:ja::en_US", "LC_ALL": "", "LC_MESSAGES": "de_DE.UTF-8@euro", "LANG": "zh_TW.UTF-8"}
        self.assertEqual(text.system_languages(environ), ["zh-TW", "ja", "en-US", "de-DE"])
        self.assertEqual(text.system_languages({"LC_ALL": "C.UTF-8", "LANG": "POSIX"}), [])
        self.assertEqual(text.system_languages({}), [])
        self.assertEqual(text.system_languages({"LC_ALL": "en_GB.UTF-8", "LANG": "zh_TW.UTF-8"}), ["en-GB", "zh-TW"])
        self.assertEqual(text.resolve_locale("auto", text.system_languages({"LANG": "zh_CN.UTF-8", "LANGUAGE": "zh_CN:zh_TW"})), "zh-TW")

    def test_lookup_interpolates_and_falls_back(self):
        self.assertEqual(text.t("dialog.upToDate", version="1.2.3"), "Work Fleet 1.2.3 is up to date.")
        self.assertEqual(text.t("dialog.upToDate"), "Work Fleet {version} is up to date.")
        self.assertEqual(text.t("missing.key.for.test"), "missing.key.for.test")
        text.set_locale("zh-TW")
        self.assertEqual(text.get_locale(), "zh-TW")
        self.assertEqual(text.t("tray.saveAndQuit"), text.ZH_TW["tray.saveAndQuit"])
        self.assertEqual(text.t("missing.key.for.test"), "missing.key.for.test")
        text.set_locale("fr")
        self.assertEqual(text.get_locale(), "en")

    def test_preference_values_match_the_settings_file(self):
        self.assertEqual(text.PREFERENCES, hostsettings.LANGUAGES)
        self.assertEqual(text.LOCALES, ("en", "zh-TW"))


class StringTable(unittest.TestCase):
    def test_both_blocks_have_the_same_keys_and_placeholders(self):
        self.assertEqual(sorted(text.EN), sorted(text.ZH_TW))
        for key, value in text.EN.items():
            with self.subTest(key=key):
                self.assertRegex(key, r"^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$")
                self.assertTrue(value.strip() and text.ZH_TW[key].strip())
                self.assertEqual(sorted(PLACEHOLDER.findall(value)), sorted(PLACEHOLDER.findall(text.ZH_TW[key])))

    def test_every_key_the_host_looks_up_exists(self):
        used = set()
        for file in NATIVE.glob("*.py"):
            source = file.read_text("utf-8")
            used.update(re.findall(r"""(?<![\w.])t\(\s*"([A-Za-z0-9.]+)\"""", source))
            used.update(re.findall(r"""translations\(\s*"([A-Za-z0-9.]+)\"""", source))
            # Keys kept in tables and passed on: fatal and desktop reasons, pause reasons, update errors and reasons.
            used.update(re.findall(r"""\"((?:fatal|reason|sync|update|startup|tray|shortcut)\.[a-z][A-Za-z0-9]*)\"""", source))
        self.assertTrue(used)
        self.assertEqual(sorted(key for key in used - METHODS if key not in text.EN), [])

    def test_blocks_follow_the_marker_format(self):
        lines = (NATIVE / "text.py").read_text("utf-8").splitlines()
        markers = [line.strip() for line in lines if "i18n:" in line]
        self.assertEqual(markers, ["# i18n:" + "en", "# i18n:" + "end", "# i18n:" + "zh-TW", "# i18n:" + "end"])


class HostLanguage(unittest.TestCase):
    """host.language.set and host.info, with FleetApp's methods run on a stand-in owner: no GTK."""
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.directory)
        self.addCleanup(text.set_locale, "en")
        tree = ast.parse((NATIVE / "host.py").read_text("utf-8"))
        owner = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "FleetApp")
        methods = [node for node in owner.body if isinstance(node, ast.FunctionDef) and node.name in ("shell_invoke", "describe_language", "apply_language")]
        self.assertEqual(len(methods), 3)
        scope = {"p": protocol, "hostsettings": hostsettings, "text": text, "t": text.t, "os": os}
        exec(compile(ast.Module(body=methods, type_ignores=[]), "host-language", "exec"), scope)
        relabels = self.relabels = []
        self.owner = type("Owner", (), {node.name: scope[node.name] for node in methods})()
        self.owner.directory = self.directory
        self.owner.preferences = hostsettings.read_preferences(self.directory)[0]
        self.owner.system_languages = ["zh-TW", "en-US"]
        self.owner.tray = types.SimpleNamespace(relabel=lambda: relabels.append(text.get_locale()))

    @unittest.skipUnless(os.name == "posix", "host files use POSIX directory sync")
    def test_setting_stores_the_preference_relabels_the_tray_and_answers(self):
        result = self.owner.shell_invoke("host.language.set", {"preference": "zh-TW"})
        self.assertEqual(result, {"preference": "zh-TW", "system": ["zh-TW", "en-US"]})
        self.assertEqual((text.get_locale(), self.relabels), ("zh-TW", ["zh-TW"]))
        stored = json.loads((self.directory / "host-preferences.json").read_text("utf-8"))
        self.assertEqual((stored["version"], stored["language"]), (1, "zh-TW"))
        self.assertEqual(self.owner.shell_invoke("host.language.set", {"preference": "en"})["preference"], "en")
        self.assertEqual(self.relabels, ["zh-TW", "en"])
        # auto follows the system languages again.
        self.owner.shell_invoke("host.language.set", {"preference": "auto"})
        self.assertEqual(text.get_locale(), "zh-TW")
        self.assertEqual(hostsettings.read_preferences(self.directory)[0]["language"], "auto")

    def test_anything_else_is_an_invalid_request_and_changes_nothing(self):
        for args in ({}, {"preference": ""}, {"preference": "fr"}, {"preference": "zh-tw"}, {"preference": None}, {"preference": ["en"]}):
            with self.subTest(args=args):
                with self.assertRaises(protocol.Failure) as error:
                    self.owner.shell_invoke("host.language.set", args)
                self.assertEqual(error.exception.code, "invalid-request")
        self.assertFalse((self.directory / "host-preferences.json").exists())
        self.assertEqual(self.relabels, [])

    def test_the_method_is_routed_to_the_main_window_shell(self):
        tree = ast.parse((NATIVE / "service.py").read_text("utf-8"))
        shell = next(node for node in ast.walk(tree) if isinstance(node, ast.Compare) and isinstance(node.comparators[0], ast.Tuple)
                     and any(isinstance(item, ast.Constant) and item.value == "host.preferences.get" for item in node.comparators[0].elts))
        self.assertIn("host.language.set", [item.value for item in shell.comparators[0].elts])


if __name__ == "__main__":
    unittest.main()
