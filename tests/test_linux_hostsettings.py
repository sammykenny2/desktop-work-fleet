"""ADR-043 host settings on Linux: the shared placement rule, host files and the XDG autostart entry. No GI or display."""
import importlib.util
import json
import os
import re
from pathlib import Path
import shutil
import stat
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("hostsettings", ROOT / "src/native/linux/hostsettings.py")
hostsettings = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hostsettings)


@unittest.skipUnless(os.name == "posix", "Linux host files use POSIX directory sync and permissions")
class LinuxHostSettingsTests(unittest.TestCase):
    def folder(self):
        base = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, base)
        return base

    def test_placement_rule_matches_the_shared_fixture(self):
        fixture = json.loads((ROOT / "tests/fixtures/window-placement.json").read_text("utf-8"))
        size = fixture["defaultSize"]
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(hostsettings.resolve(case["saved"], case["areas"], size["width"], size["height"]), case["expected"])

    def test_placement_round_trip_and_damaged_files(self):
        folder = self.folder() / "WorkFleet"
        for value in ({"x": -1200, "y": 40, "width": 900, "height": 700, "maximized": True},
                      {"x": None, "y": None, "width": 800, "height": 600, "maximized": False}):
            hostsettings.write_placement(folder, value)
            self.assertEqual(hostsettings.read_placement(folder), value)
        self.assertEqual(stat.S_IMODE(folder.stat().st_mode), 0o700)
        self.assertEqual([path.name for path in folder.iterdir()], ["window-placement.json"])
        for text in ("", "{", "[]", '{"version":2,"x":0,"y":0,"width":10,"height":10,"maximized":false}',
                     '{"version":1,"x":0,"y":0,"width":0,"height":10,"maximized":false}', '{"version":1,"x":0,"width":10,"height":10,"maximized":false}',
                     '{"version":1,"x":0,"y":0,"width":10,"height":10}', '{"version":1,"x":0.5,"y":0,"width":10,"height":10,"maximized":false}',
                     '{"version":1,"version":1,"x":0,"y":0,"width":10,"height":10,"maximized":false}', '{"version":true,"x":0,"y":0,"width":10,"height":10,"maximized":false}'):
            (folder / "window-placement.json").write_text(text, "utf-8")
            self.assertIsNone(hostsettings.read_placement(folder), text)
        hostsettings.remove_placement(folder)
        hostsettings.remove_placement(folder)
        self.assertIsNone(hostsettings.read_placement(folder))

    def test_preferences_default_once_and_round_trip(self):
        folder = self.folder()
        value, existed = hostsettings.read_preferences(folder)
        self.assertFalse(existed)
        self.assertEqual(value, {"startAtLogin": True, "closeToTray": True, "openMainAtLogin": False, "lastUpdateCheck": None, "language": "auto"})
        changed = hostsettings.change(hostsettings.change(value, "startAtLogin", False), "openMainAtLogin", True)
        hostsettings.write_preferences(folder, changed)
        self.assertEqual(hostsettings.read_preferences(folder), (changed, True))
        with self.assertRaises(ValueError):
            hostsettings.change(value, "unknown", True)
        with self.assertRaises(ValueError):
            hostsettings.change(value, "closeToTray", "no")
        (folder / "host-preferences.json").write_text('{"version":1,"startAtLogin":"no","closeToTray":false}', "utf-8")
        self.assertEqual(hostsettings.read_preferences(folder)[0]["startAtLogin"], True)
        self.assertEqual(hostsettings.read_preferences(folder)[0]["closeToTray"], False)

    def test_display_language_round_trips_and_damaged_values_follow_the_system(self):
        folder = self.folder()
        value, _ = hostsettings.read_preferences(folder)
        for language in ("zh-TW", "en", "auto"):
            hostsettings.write_preferences(folder, {**value, "language": language})
            stored = json.loads((folder / "host-preferences.json").read_text("utf-8"))
            self.assertEqual((stored["version"], stored["language"]), (1, language))
            self.assertEqual(hostsettings.read_preferences(folder), ({**value, "language": language}, True))
        # A preference the host cannot read never blocks startup: the other settings stay, the language is auto.
        for language in ('"fr"', '"zh-tw"', '"ZH-TW"', '""', "null", "1", "true", '["en"]', '{"value":"en"}'):
            with self.subTest(language=language):
                (folder / "host-preferences.json").write_text('{"version":1,"closeToTray":false,"language":' + language + "}", "utf-8")
                read = hostsettings.read_preferences(folder)[0]
                self.assertEqual((read["language"], read["closeToTray"]), ("auto", False))
        (folder / "host-preferences.json").write_text('{"version":1,"startAtLogin":false}', "utf-8")
        self.assertEqual(hostsettings.read_preferences(folder)[0]["language"], "auto")
        hostsettings.write_preferences(folder, {**value, "language": "fr"})
        self.assertEqual(json.loads((folder / "host-preferences.json").read_text("utf-8"))["language"], "auto")
        # Changing another setting keeps the language.
        changed = hostsettings.change({**value, "language": "en"}, "closeToTray", False)
        self.assertEqual(changed["language"], "en")
        with self.assertRaises(ValueError):
            hostsettings.change(value, "language", "en")

    def test_distribution_version_and_sign_in_command(self):
        base = self.folder()
        bundle = base / "work fleet $1"
        (bundle / "Assets").mkdir(parents=True)
        (bundle / "run-work-fleet.sh").write_text("#!/bin/bash\n", "utf-8")
        (bundle / "package.json").write_text('{"version": "0.2.0"}', "utf-8")
        self.assertEqual(hostsettings.distribution(bundle / "Assets"), "bundle")
        self.assertEqual(hostsettings.version(bundle / "Assets", base / "host.py"), "0.2.0")
        default = base / "data"
        command, reason = hostsettings.launch_command(bundle / "Assets", default, default)
        self.assertIsNone(reason)
        self.assertEqual(command, '"' + str(bundle / "run-work-fleet.sh").replace("$", "\\$") + '" --launch-at-login')
        command, _ = hostsettings.launch_command(bundle / "Assets", base / "other 100%", default)
        self.assertTrue(command.endswith(' --data "' + str(base / "other 100%%") + '" --launch-at-login'))
        self.assertEqual(hostsettings.distribution(Path("/usr/lib/work-fleet/Assets")), "deb")
        self.assertEqual(hostsettings.launch_command(Path("/usr/lib/work-fleet/Assets"), default, default), ("work-fleet --launch-at-login", None))
        source = base / "checkout" / "build" / "app"
        source.mkdir(parents=True)
        (base / "native").mkdir()
        (base / "native" / "VERSION").write_text("0.1.0\n", "utf-8")
        self.assertEqual(hostsettings.distribution(source), "source")
        self.assertEqual(hostsettings.version(source, base / "native" / "host.py"), "0.1.0")
        command, reason = hostsettings.launch_command(source, default, default)
        self.assertIsNone(command)
        # The reason is a text.py key; the host shows it in the display language.
        self.assertEqual(reason, "startup.sourceRun")

    def test_autostart_entry_follows_xdg_config_home_and_only_removes_its_own(self):
        base = self.folder()
        self.assertEqual(hostsettings.autostart_path({"XDG_CONFIG_HOME": str(base / "config")}), base / "config/autostart/work-fleet.desktop")
        self.assertEqual(hostsettings.autostart_path({"XDG_CONFIG_HOME": "relative"}), Path.home() / ".config/autostart/work-fleet.desktop")
        path = base / "config/autostart/work-fleet.desktop"
        self.assertEqual(hostsettings.autostart_state(path), "disabled")
        hostsettings.write_autostart(path, "work-fleet --launch-at-login", "app.workfleet.preview",
                                     {"en": "Shows notes after sign-in", "zh-TW": "Traditional Chinese comment"})
        text = path.read_text("utf-8")
        self.assertIn("Exec=work-fleet --launch-at-login\n", text)
        # The session shows the comment in its own language: English by default, Comment[zh_TW] for Traditional Chinese.
        self.assertIn("\nComment=Shows notes after sign-in\nComment[zh_TW]=Traditional Chinese comment\n", text)
        self.assertIn("X-Work-Fleet-Managed=true\n", text)
        self.assertEqual(hostsettings.autostart_state(path), "enabled")
        path.write_text(text.replace("X-GNOME-Autostart-enabled=true", "X-GNOME-Autostart-enabled=false"), "utf-8")
        self.assertEqual(hostsettings.autostart_state(path), "disabled")
        path.write_text(text + "Hidden=true\n", "utf-8")
        self.assertEqual(hostsettings.autostart_state(path), "disabled")
        hostsettings.remove_autostart(path)
        self.assertFalse(path.exists())
        hostsettings.remove_autostart(path)
        path.write_text("[Desktop Entry]\nExec=someone-else\n", "utf-8")
        with self.assertRaises(PermissionError):
            hostsettings.remove_autostart(path)
        self.assertTrue(path.exists())

    def test_tray_wait_comes_from_the_public_config_or_is_none(self):
        self.assertEqual(hostsettings.tray_wait({"startup": {"trayWaitSeconds": 30}}), 30)
        self.assertEqual(hostsettings.tray_wait({"startup": {"trayWaitSeconds": 0}}), 0)
        # A bundle without a valid value shows a hidden start's window at once rather than guessing a wait.
        for config in ({}, {"startup": None}, {"startup": {}}, {"startup": {"trayWaitSeconds": -1}}, {"startup": {"trayWaitSeconds": 1.5}},
                       {"startup": {"trayWaitSeconds": True}}, {"startup": {"trayWaitSeconds": "30"}}, {"startup": {"trayWaitSeconds": 2**31}}, None):
            with self.subTest(config=config):
                self.assertEqual(hostsettings.tray_wait(config), 0)

    def test_host_log_lines_rotation_and_failures(self):
        from datetime import datetime, timedelta, timezone
        folder = self.folder() / "WorkFleet"
        moment = datetime(2026, 10, 17, 1, 2, 3, 250000, tzinfo=timezone(timedelta(hours=8)))
        hostsettings.append_log(folder, "start version=0.2.8\n", moment)
        hostsettings.append_log(folder, "tray available=True uptime=4.2s", moment)
        log = folder / "host.log"
        # The same line shape as the Windows host.log (ADR-045): local time with its offset, one entry per line.
        self.assertEqual(log.read_text("utf-8"), "2026-10-17 01:02:03.250+08:00 start version=0.2.8\n"
                                                 "2026-10-17 01:02:03.250+08:00 tray available=True uptime=4.2s\n")
        self.assertEqual(stat.S_IMODE(log.stat().st_mode), 0o600)
        log.write_bytes(b"x" * hostsettings.LOG_LIMIT)
        hostsettings.append_log(folder, "exit", moment)
        self.assertEqual(((folder / "host.log.1").stat().st_size, log.read_text("utf-8")),
                         (hostsettings.LOG_LIMIT, "2026-10-17 01:02:03.250+08:00 exit\n"))
        blocked = self.folder() / "file"
        blocked.write_text("not a folder", "utf-8")
        hostsettings.append_log(blocked, "never raises")
        self.assertEqual(blocked.read_text("utf-8"), "not a folder")

# Pure data, so it runs on every platform.
class LinuxNamedActionTests(unittest.TestCase):
    def test_named_actions_run_tray_targets_and_every_region(self):
        names = hostsettings.NAMED_ACTIONS
        self.assertTrue(all(re.fullmatch(r"[a-z0-9-]+", name) for name in names), "valid GAction names")
        self.assertEqual({target for target in names.values() if not target.startswith("@region")}, {"show", "@capture", "@toggle", "@all", "@stop"})
        # The page's regionTarget in src/core/shortcuts.js spells region targets the same way.
        self.assertEqual([names[f"region-{number}"] for number in range(1, 10)], [f"@region{number}" for number in range(1, 10)])
        self.assertIn("export const regionTarget = number => `@region${number}`;", (ROOT / "src/core/shortcuts.js").read_text("utf-8"))


if __name__ == "__main__":
    unittest.main()
