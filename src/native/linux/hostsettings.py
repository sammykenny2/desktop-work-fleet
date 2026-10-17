"""ADR-043 host-level settings: startup behaviour, the display language, the main window's bounds, the XDG autostart entry
and host.log.

Kept beside profile.txt in the data directory, never in a profile, backup or Google. Pure functions, no GTK."""
from datetime import datetime
import json
import os
from pathlib import Path
import tempfile

PREFERENCES = "host-preferences.json"
PLACEMENT = "window-placement.json"
DEFAULTS = {"startAtLogin": True, "closeToTray": True, "openMainAtLogin": False}
# The display-language preference (docs/i18n.md); text.PREFERENCES lists the same values.
LANGUAGES = ("auto", "en", "zh-TW")
AUTOSTART = "work-fleet.desktop"
MARKER = "X-Work-Fleet-Managed=true"
LOGIN_ARGUMENT = "--launch-at-login"
DEB_ROOT = Path("/usr/lib/work-fleet")
LOG = "host.log"
LOG_LIMIT = 256 * 1024


def replace(directory, name, data):
    """Writes a small file atomically: temporary file, fsync, rename, then the directory entry."""
    folder = Path(directory)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(dir=folder, prefix=name + ".")
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, folder / name)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
    handle = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        os.fsync(handle)
    finally:
        os.close(handle)


def _object(path, limit=4096):
    try:
        data = Path(path).read_bytes()
        if len(data) > limit:
            return None

        def unique(pairs):
            keys = [key for key, _ in pairs]
            if len(keys) != len(set(keys)):
                raise ValueError("duplicate key")
            return dict(pairs)
        value = json.loads(data.decode("utf-8"), object_pairs_hook=unique)
    except (OSError, UnicodeDecodeError, ValueError):
        return None
    return value if isinstance(value, dict) and value.get("version") == 1 and type(value["version"]) is int else None


def read_preferences(directory):
    """The preferences and whether a file was there: a first launch applies the sign-in default once."""
    path = Path(directory) / PREFERENCES
    value = _object(path)
    result = dict(DEFAULTS)
    result["lastUpdateCheck"] = None
    result["language"] = "auto"
    if value is not None:
        for key in DEFAULTS:
            if isinstance(value.get(key), bool):
                result[key] = value[key]
        if isinstance(value.get("lastUpdateCheck"), str) and len(value["lastUpdateCheck"]) <= 64:
            result["lastUpdateCheck"] = value["lastUpdateCheck"]
        # An unknown or damaged language falls back to following the system, like the other settings.
        if isinstance(value.get("language"), str) and value["language"] in LANGUAGES:
            result["language"] = value["language"]
    return result, path.exists()


def write_preferences(directory, preferences):
    language = preferences.get("language")
    value = {"version": 1, **{key: bool(preferences[key]) for key in DEFAULTS}, "lastUpdateCheck": preferences.get("lastUpdateCheck"),
             "language": language if language in LANGUAGES else "auto"}
    replace(directory, PREFERENCES, (json.dumps(value) + "\n").encode("utf-8"))


def append_log(directory, text, now=None):
    """
    Appends one line as the Windows host.log does (ADR-045): local time with its offset, never note text. A full log
    becomes host.log.1, replacing the older one. Logging never raises.
    """
    folder = Path(directory)
    line = (now or datetime.now().astimezone()).isoformat(sep=" ", timespec="milliseconds") + " " + text.rstrip("\n") + "\n"
    try:
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            if (folder / LOG).stat().st_size >= LOG_LIMIT:
                os.replace(folder / LOG, folder / (LOG + ".1"))
        except FileNotFoundError:
            pass
        descriptor = os.open(folder / LOG, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_CLOEXEC, 0o600)
        try:
            os.write(descriptor, line.encode("utf-8"))
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError:
        pass


def tray_wait(config):
    """
    Seconds a hidden sign-in start waits for the tray (ADR-043). The value comes from config/startup.json through
    Config/public.json; a bundle without a valid one waits for nothing, so the hidden window is never stranded.
    """
    startup = config.get("startup") if isinstance(config, dict) else None
    seconds = startup.get("trayWaitSeconds") if isinstance(startup, dict) else None
    # The int32 range the Windows host reads, which also fits GLib's unsigned timeout.
    return seconds if type(seconds) is int and 0 <= seconds <= 2**31 - 1 else 0


def change(preferences, name, value):
    if name not in DEFAULTS or not isinstance(value, bool):
        raise ValueError(name)
    return {**preferences, name: value}


def _coordinate(value):
    return type(value) is int and abs(value) <= 1_000_000


def read_placement(directory):
    """Saved restore bounds, or None for a missing, damaged or unknown file. x/y are None on Wayland."""
    value = _object(Path(directory) / PLACEMENT)
    if value is None:
        return None
    x, y, width, height = value.get("x"), value.get("y"), value.get("width"), value.get("height")
    if not (_coordinate(width) and _coordinate(height) and 0 < width <= 32768 and 0 < height <= 32768):
        return None
    if (x is None) != (y is None) or x is not None and not (_coordinate(x) and _coordinate(y)):
        return None
    if not isinstance(value.get("maximized"), bool):
        return None
    return {"x": x, "y": y, "width": width, "height": height, "maximized": value["maximized"]}


def write_placement(directory, placement):
    value = {"version": 1, "x": placement["x"], "y": placement["y"], "width": placement["width"], "height": placement["height"], "maximized": placement["maximized"]}
    replace(directory, PLACEMENT, (json.dumps(value) + "\n").encode("utf-8"))


def remove_placement(directory):
    (Path(directory) / PLACEMENT).unlink(missing_ok=True)


def resolve(saved, areas, default_width, default_height):
    """
    Keeps saved bounds on the work area they overlap most, shrunk and moved fully inside it. Bounds overlapping no
    work area, or none saved, give the default size centred on the primary (first) work area.
    """
    primary = areas[0]

    def default():
        width, height = min(default_width, primary["width"]), min(default_height, primary["height"])
        return {"x": primary["x"] + (primary["width"] - width) // 2, "y": primary["y"] + (primary["height"] - height) // 2,
                "width": width, "height": height, "maximized": False}
    if saved is None or saved["width"] <= 0 or saved["height"] <= 0:
        return default()
    if saved["x"] is None or saved["y"] is None:
        return {"x": None, "y": None, "width": min(saved["width"], primary["width"]), "height": min(saved["height"], primary["height"]), "maximized": saved["maximized"]}
    best, most = None, 0
    for area in areas:
        width = min(saved["x"] + saved["width"], area["x"] + area["width"]) - max(saved["x"], area["x"])
        height = min(saved["y"] + saved["height"], area["y"] + area["height"]) - max(saved["y"], area["y"])
        if width > 0 and height > 0 and width * height > most:
            best, most = area, width * height
    if best is None:
        return default()
    width, height = min(saved["width"], best["width"]), min(saved["height"], best["height"])
    return {"x": min(max(saved["x"], best["x"]), best["x"] + best["width"] - width),
            "y": min(max(saved["y"], best["y"]), best["y"] + best["height"] - height),
            "width": width, "height": height, "maximized": saved["maximized"]}


def version(assets, host_file):
    """The bundle's package.json version, else src/native/linux/VERSION beside a source checkout's host.py."""
    try:
        value = json.loads((Path(assets).parent / "package.json").read_text("utf-8")).get("version")
        if isinstance(value, str) and 0 < len(value) <= 32:
            return value
    except (OSError, ValueError, AttributeError):
        pass
    try:
        value = (Path(host_file).parent / "VERSION").read_text("utf-8").strip()
        return value if 0 < len(value) <= 32 else "0.0.0"
    except OSError:
        return "0.0.0"


def distribution(assets):
    root = Path(assets).parent
    if root == DEB_ROOT:
        return "deb"
    return "bundle" if (root / "run-work-fleet.sh").is_file() else "source"


def autostart_path(environ):
    base = environ.get("XDG_CONFIG_HOME", "")
    return (Path(base) if base and Path(base).is_absolute() else Path.home() / ".config") / "autostart" / AUTOSTART


def _quote(argument):
    # Desktop Entry Exec quoting: reserved characters need double quotes, with ", `, $ and \ escaped; % doubles.
    text = argument.replace("%", "%%")
    if all(character.isalnum() or character in "-_./=+,:@" for character in text):
        return text
    return '"' + "".join("\\" + character if character in '"`$\\' else character for character in text) + '"'


def launch_command(assets, data, default_data):
    """The sign-in command, or None with the reason's text.py key when this run cannot be started again by itself."""
    kind = distribution(assets)
    if kind == "source":
        return None, "startup.sourceRun"
    arguments = ["work-fleet"] if kind == "deb" else [str(Path(assets).parent / "run-work-fleet.sh")]
    if Path(data).absolute() != Path(default_data).absolute():
        arguments += ["--data", str(Path(data).absolute())]
    return " ".join(_quote(argument) for argument in arguments + [LOGIN_ARGUMENT]), None


def autostart_state(path):
    """'enabled' or 'disabled', from the entry the session will read."""
    try:
        text = Path(path).read_text("utf-8")
    except (OSError, UnicodeDecodeError):
        return "disabled"
    lines = [line.strip() for line in text.splitlines()]
    if "Hidden=true" in lines or "X-GNOME-Autostart-enabled=false" in lines:
        return "disabled"
    return "enabled"


def write_autostart(path, command, icon, comments=None):
    """`comments` maps a locale ("en", "zh-TW") to the entry's description: English is Comment, others Comment[ll_CC]."""
    path = Path(path)
    comments = comments or {}
    described = ([f"Comment={comments['en']}"] if comments.get("en") else []) + \
        [f"Comment[{locale.replace('-', '_')}]={value}" for locale, value in sorted(comments.items()) if locale != "en" and value]
    body = "\n".join(["[Desktop Entry]", "Type=Application", "Name=Work Fleet", *described,
                      f"Exec={command}", f"Icon={icon}", "Terminal=false", "X-GNOME-Autostart-enabled=true", MARKER, ""])
    replace(path.parent, path.name, body.encode("utf-8"))


def remove_autostart(path):
    """Removes only an entry Work Fleet wrote; any other file at that name stays and is reported."""
    path = Path(path)
    try:
        text = path.read_text("utf-8")
    except FileNotFoundError:
        return
    if MARKER not in [line.strip() for line in text.splitlines()]:
        raise PermissionError("autostart entry not written by Work Fleet")
    path.unlink()
