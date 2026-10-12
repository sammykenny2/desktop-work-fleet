"""Linux modules that pin GTK 3 also pin Gdk 3, so an installed GTK 4 typelib cannot load first."""
import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "src/native/linux"


def pins_and_imports(source):
    """Return top-level gi.require_version pins and gi.repository import names in source order."""
    events = []
    for node in ast.parse(source).body:
        call = node.value if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) else None
        if call and ast.unparse(call.func) == "gi.require_version" and all(isinstance(a, ast.Constant) for a in call.args):
            events.append(("pin", tuple(a.value for a in call.args)))
        elif isinstance(node, ast.ImportFrom) and node.module == "gi.repository":
            events.append(("import", tuple(alias.name for alias in node.names)))
    return events


def gdk_violation(source):
    """Describe a Gdk import that precedes its 3.0 pin in a module that pins Gtk, or return None."""
    events = pins_and_imports(source)
    if not any(kind == "pin" and value[0] == "Gtk" for kind, value in events):
        return None
    pinned = False
    for kind, value in events:
        if kind == "pin" and value[0] == "Gdk":
            if value != ("Gdk", "3.0"):
                return f"Gdk pinned to {value[1]}"
            pinned = True
        elif kind == "import" and "Gdk" in value and not pinned:
            return "Gdk imported before gi.require_version('Gdk', '3.0')"
    return None


class LinuxGiVersionTests(unittest.TestCase):
    def test_gtk3_modules_pin_gdk3_before_importing_it(self):
        checked = []
        for path in sorted(NATIVE.glob("*.py")):
            source = path.read_text("utf-8")
            if any(value[0] == "Gtk" for kind, value in pins_and_imports(source) if kind == "pin"):
                checked.append(path.name)
            with self.subTest(file=path.name):
                self.assertIsNone(gdk_violation(source))
        self.assertIn("host.py", checked)

    def test_check_rejects_an_unpinned_gdk_import(self):
        unpinned = 'import gi\ngi.require_version("Gtk", "3.0")\nfrom gi.repository import Gdk, Gtk\n'
        late = 'import gi\ngi.require_version("Gtk", "3.0")\nfrom gi.repository import Gdk\ngi.require_version("Gdk", "3.0")\n'
        wrong = 'import gi\ngi.require_version("Gdk", "4.0")\ngi.require_version("Gtk", "3.0")\nfrom gi.repository import Gdk\n'
        for source in (unpinned, late, wrong):
            with self.subTest(source=source):
                self.assertIsNotNone(gdk_violation(source))
        pinned = 'import gi\ngi.require_version("Gdk", "3.0")\ngi.require_version("Gtk", "3.0")\nfrom gi.repository import Gdk, Gtk\n'
        unrelated = 'from gi.repository import Gdk, Gio, GLib\n'
        for source in (pinned, unrelated):
            with self.subTest(source=source):
                self.assertIsNone(gdk_violation(source))


if __name__ == "__main__":
    unittest.main()
