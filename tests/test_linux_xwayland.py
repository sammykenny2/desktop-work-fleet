"""GNOME Wayland users opt into XWayland for desktop papers; the choice is applied before GTK starts. No GI or display."""
import importlib.util
from pathlib import Path
import shutil
import stat
import tempfile
import unittest

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"
spec = importlib.util.spec_from_file_location("xwayland", NATIVE / "xwayland.py")
xwayland = importlib.util.module_from_spec(spec)
spec.loader.exec_module(xwayland)

GNOME = {"XDG_SESSION_TYPE": "wayland", "WAYLAND_DISPLAY": "wayland-0", "DISPLAY": ":0", "XDG_CURRENT_DESKTOP": "ubuntu:GNOME"}


class LinuxXwaylandTests(unittest.TestCase):
    def folder(self):
        base = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, base)
        return base / "WorkFleet"

    def test_data_directory_matches_the_host_default_and_data_argument(self):
        self.assertEqual(xwayland.data_directory(["--data", "/srv/fleet"], {}), Path("/srv/fleet"))
        self.assertEqual(xwayland.data_directory(["--assets", "a", "--data=/srv/other"], {}), Path("/srv/other"))
        self.assertEqual(xwayland.data_directory([], {"XDG_DATA_HOME": "/home/u/data"}), Path("/home/u/data/WorkFleet"))
        self.assertEqual(xwayland.data_directory([], {"XDG_DATA_HOME": "relative"}), Path.home() / ".local/share/WorkFleet")
        self.assertEqual(xwayland.data_directory([], {}), Path.home() / ".local/share/WorkFleet")

    def test_only_a_gnome_wayland_session_with_xwayland_counts(self):
        self.assertTrue(xwayland.gnome_wayland(GNOME))
        for key, value in (("XDG_SESSION_TYPE", "x11"), ("DISPLAY", ""), ("WAYLAND_DISPLAY", ""), ("XDG_CURRENT_DESKTOP", "KDE")):
            with self.subTest(key=key):
                self.assertFalse(xwayland.gnome_wayland({**GNOME, key: value}))

    def test_saved_choice_sets_gdk_backend_before_gtk_and_the_user_setting_wins(self):
        folder = self.folder()
        environ = dict(GNOME)
        xwayland.configure(environ, folder)
        self.assertNotIn("GDK_BACKEND", environ, "nothing chosen yet keeps native Wayland")
        xwayland.write_preference(folder, "x11")
        xwayland.configure(environ, folder)
        self.assertEqual((environ["GDK_BACKEND"], environ[xwayland.OWN]), ("x11", "x11"))
        user = {**GNOME, "GDK_BACKEND": "wayland"}
        xwayland.configure(user, folder)
        self.assertEqual(user["GDK_BACKEND"], "wayland")
        self.assertNotIn(xwayland.OWN, user)
        elsewhere = {"XDG_SESSION_TYPE": "x11", "DISPLAY": ":0"}
        xwayland.configure(elsewhere, folder)
        self.assertNotIn("GDK_BACKEND", elsewhere)

    def test_a_restart_drops_the_backend_it_set_when_the_choice_changes(self):
        folder = self.folder()
        xwayland.write_preference(folder, "wayland")
        environ = {**GNOME, "GDK_BACKEND": "x11", xwayland.OWN: "x11"}
        xwayland.configure(environ, folder)
        self.assertNotIn("GDK_BACKEND", environ)
        self.assertNotIn(xwayland.OWN, environ)
        changed = {**GNOME, "GDK_BACKEND": "wayland", xwayland.OWN: "x11"}
        xwayland.configure(changed, folder)
        self.assertEqual(changed["GDK_BACKEND"], "wayland", "a backend the user set after Work Fleet's stays")

    def test_preference_file_is_private_atomic_and_validated(self):
        folder = self.folder()
        self.assertIsNone(xwayland.read_preference(folder))
        xwayland.write_preference(folder, "x11")
        self.assertEqual(xwayland.read_preference(folder), "x11")
        self.assertEqual(stat.S_IMODE(folder.stat().st_mode) & 0o077, 0)
        self.assertEqual(sorted(path.name for path in folder.iterdir()), [xwayland.PREFERENCE])
        (folder / xwayland.PREFERENCE).write_text("sky\n", encoding="utf-8")
        self.assertIsNone(xwayland.read_preference(folder))
        with self.assertRaises(ValueError):
            xwayland.write_preference(folder, "sky")

    def test_choice_is_asked_once_on_native_gnome_wayland_and_fixed_elsewhere(self):
        folder = self.folder()
        native = xwayland.DisplayChoice(folder, GNOME, "wayland")
        self.assertTrue(native.ask())
        self.assertEqual(native.info(), {"current": "wayland", "preference": None})
        self.assertEqual(native.choose(False), {"current": "wayland", "preference": "wayland"})
        self.assertFalse(native.ask(), "an answer is not asked again")
        relaunched = xwayland.DisplayChoice(folder, {**GNOME, "GDK_BACKEND": "x11", xwayland.OWN: "x11"}, "x11")
        self.assertTrue(relaunched.switchable)
        self.assertFalse(relaunched.ask())
        fixed = xwayland.DisplayChoice(folder, {**GNOME, "GDK_BACKEND": "x11"}, "x11")
        self.assertEqual(fixed.info(), {"current": "x11", "preference": "wayland", "fixed": True},
                         "a GDK_BACKEND from the user is shown as fixed rather than hidden")
        self.assertFalse(fixed.ask())
        with self.assertRaises(ValueError):
            fixed.choose(True)
        self.assertIsNone(xwayland.DisplayChoice(folder, {"XDG_SESSION_TYPE": "x11"}, "x11").info())

    def test_restart_waits_until_no_one_holds_the_data_lock(self):
        import fcntl, os
        folder = self.folder()
        self.assertTrue(xwayland.data_unlocked(folder), "no lock file yet")
        folder.mkdir(parents=True)
        holder = os.open(folder / "owner.lock", os.O_RDWR | os.O_CREAT, 0o600)
        self.addCleanup(os.close, holder)
        self.assertTrue(xwayland.data_unlocked(folder))
        fcntl.flock(holder, fcntl.LOCK_EX)
        self.assertFalse(xwayland.data_unlocked(folder), "a still-open database blocks the restart")
        fcntl.flock(holder, fcntl.LOCK_UN)
        self.assertTrue(xwayland.data_unlocked(folder))

    def test_host_applies_the_choice_before_importing_gtk(self):
        source = (NATIVE / "host.py").read_text("utf-8")
        self.assertLess(source.index("xwayland.configure(os.environ"), source.index("import gi"))


if __name__ == "__main__":
    unittest.main()
