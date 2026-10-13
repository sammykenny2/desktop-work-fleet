"""labwc global shortcuts: keybinds in the user's rc.xml run gapplication, which hands the key to the running app.

labwc offers clients no way to register global shortcuts and the wlroots portal has no GlobalShortcuts, so the compositor
itself has to run something on the key. Only the marked block is ever rewritten; the rest of rc.xml stays as it was."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ElementTree

BEGIN = "<!-- Work Fleet shortcuts: begin. Work Fleet rewrites this block from its shortcut settings. -->"
END = "<!-- Work Fleet shortcuts: end -->"
MINIMAL = '<?xml version="1.0"?>\n<labwc_config>\n  <keyboard>\n  </keyboard>\n</labwc_config>\n'
MODIFIERS = {"Ctrl": "C", "Alt": "A", "Shift": "S", "Meta": "W"}
APP_ID = re.compile(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+")
KEY = re.compile(r"(?:(?:Ctrl|Alt|Shift|Meta)\+){1,4}(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))")
COMMAND = re.compile(r'command="gapplication action ([A-Za-z0-9_.-]+) shortcut &quot;\'([A-Za-z0-9+]+)\'&quot;"')


class ConfigError(Exception):
    pass


def keybind(key):
    """Work Fleet's Ctrl+Shift+D is labwc's C-S-d: labwc matches a letter by its unshifted keysym."""
    *mods, name = key.split("+")
    return "-".join([MODIFIERS[value] for value in mods] + [name.lower() if len(name) == 1 else name])


def block(app_id, keys, indent="    "):
    lines = [indent + BEGIN]
    for key in keys:
        command = f"gapplication action {app_id} shortcut &quot;'{key}'&quot;"
        lines.append(f'{indent}<keybind key="{keybind(key)}"><action name="Execute" command="{command}"/></keybind>')
    lines.append(indent + END)
    return "\n".join(lines)


def written(text, app_id):
    """Keys in this app's block, or None when the file has no block."""
    start = text.find(BEGIN)
    end = text.find(END, start)
    if start < 0 or end < 0:
        return None
    return [key for app, key in COMMAND.findall(text[start:end]) if app == app_id]


def outside_comments(text, pattern):
    comments = [match.span() for match in re.finditer(r"<!--.*?-->", text, re.S)]
    return next((match for match in re.finditer(pattern, text) if not any(start <= match.start() < end for start, end in comments)), None)


def well_formed(text):
    try:
        ElementTree.fromstring(text)
    except ElementTree.ParseError as error:
        raise ConfigError(str(error)) from None


def insert(text, app_id, keys):
    """Replaces the block, or adds it at the top of <keyboard>; a file that is not well-formed is left alone."""
    well_formed(text)
    start = text.find(BEGIN)
    end = text.find(END, start)
    if start >= 0 and end >= 0:
        line = text.rfind("\n", 0, start) + 1
        text = text[:line] + block(app_id, keys, text[line:start]) + text[end + len(END):]
    else:
        keyboard = outside_comments(text, r"<keyboard\s*/>|<keyboard(?:\s[^>]*)?>")
        root = outside_comments(text, r"</(?:labwc_config|openbox_config)>")
        if keyboard is not None and keyboard.group(0).endswith("/>"):
            text = text[:keyboard.start()] + "<keyboard>\n" + block(app_id, keys) + "\n  </keyboard>" + text[keyboard.end():]
        elif keyboard is not None:
            text = text[:keyboard.end()] + "\n" + block(app_id, keys) + text[keyboard.end():]
        elif root is not None:
            text = text[:root.start()] + "  <keyboard>\n" + block(app_id, keys) + "\n  </keyboard>\n" + text[root.start():]
        else:
            raise ConfigError("rc.xml has no labwc_config element")
    well_formed(text)
    return text


class Config:
    def __init__(self, app_id, path, merged, system):
        self.app_id, self.path, self.merged, self.system = app_id, Path(path), merged, system

    @classmethod
    def detect(cls, mode, app_id, environ=os.environ, proc="/proc"):
        """The running labwc from LABWC_PID, its config directory and whether it merges the system rc.xml (-m)."""
        pid = environ.get("LABWC_PID", "")
        if mode != "wayland-layer-shell" or not app_id or not APP_ID.fullmatch(app_id) or not pid.isdigit():
            return None
        try:
            argv = (Path(proc) / pid / "cmdline").read_bytes().split(b"\0")
        except OSError:
            return None
        if os.path.basename(argv[0]) != b"labwc":
            return None
        args = [value.decode("utf-8", "replace") for value in argv[1:] if value]
        directory, merged = None, False
        for index, value in enumerate(args):
            if value in ("-m", "--merge-config"):
                merged = True
            elif value in ("-C", "--config-dir") and index + 1 < len(args):
                directory = args[index + 1]
            elif value.startswith("--config-dir="):
                directory = value.split("=", 1)[1]
        if directory is None:
            directory = os.path.join(environ.get("XDG_CONFIG_HOME") or os.path.join(environ.get("HOME", "/"), ".config"), "labwc")
        system = next((Path(base) / "labwc/rc.xml" for base in (environ.get("XDG_CONFIG_DIRS") or "/etc/xdg").split(":")
                       if base and (Path(base) / "labwc/rc.xml").is_file()), None)
        return cls(app_id, Path(directory) / "rc.xml", merged, system)

    def keys(self):
        try:
            return written(self.path.read_text("utf-8"), self.app_id) or []
        except (OSError, UnicodeDecodeError):
            return []

    def status(self, keys):
        try:
            current = written(self.path.read_text("utf-8"), self.app_id)
        except (OSError, UnicodeDecodeError):
            current = None
        state = "absent" if current is None else "current" if sorted(current) == sorted(keys) else "outdated"
        return {"state": state, "path": str(self.path)}

    def write(self, keys):
        """Writes the keys and reloads labwc. A new file in merge mode holds only the block; otherwise it starts as a
        copy of the system rc.xml, which labwc would stop reading once a user rc.xml exists."""
        keys = [key for key in keys if KEY.fullmatch(key)]
        try:
            if self.path.exists():
                original = self.path.read_text("utf-8")
            elif self.merged or self.system is None:
                original = MINIMAL
            else:
                original = self.system.read_text("utf-8")
        except UnicodeDecodeError:
            raise ConfigError("rc.xml is not UTF-8") from None
        text = insert(original, self.app_id, keys)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        backup = self.path.with_name("rc.xml.work-fleet-backup")
        if self.path.exists() and not backup.exists():
            shutil.copy2(self.path, backup)
        mode = self.path.stat().st_mode & 0o777 if self.path.exists() else 0o644
        descriptor, temporary = tempfile.mkstemp(prefix=".rc.xml.", dir=self.path.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(text)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, mode)
            os.replace(temporary, self.path)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise
        try:
            subprocess.run(["labwc", "--reconfigure"], timeout=5, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except (OSError, subprocess.TimeoutExpired):
            pass
