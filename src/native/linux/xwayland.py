"""Display backend chosen before GTK starts: on GNOME Wayland, desktop papers need XWayland, which the user opts into."""
import fcntl
import os
from pathlib import Path
import tempfile

PREFERENCE = "display-backend.txt"
CHOICES = ("x11", "wayland")
# Marks a GDK_BACKEND that Work Fleet set itself, so a restart can drop it again; any other GDK_BACKEND is the user's.
OWN = "WORK_FLEET_GDK_BACKEND"


def data_directory(argv, environ):
    """The --data directory, or GLib's user data directory plus WorkFleet, resolved without GLib."""
    for index, value in enumerate(argv):
        if value == "--data" and index + 1 < len(argv):
            return Path(argv[index + 1]).expanduser().absolute()
        if value.startswith("--data="):
            return Path(value[len("--data="):]).expanduser().absolute()
    base = environ.get("XDG_DATA_HOME", "")
    return (Path(base) if base and Path(base).is_absolute() else Path.home() / ".local/share") / "WorkFleet"


def gnome_wayland(environ):
    desktops = environ.get("XDG_CURRENT_DESKTOP", "").upper().split(":")
    return (environ.get("XDG_SESSION_TYPE") == "wayland" and bool(environ.get("WAYLAND_DISPLAY"))
            and bool(environ.get("DISPLAY")) and "GNOME" in desktops)


def user_backend(environ):
    """True when GDK_BACKEND comes from the user rather than from Work Fleet; the user's setting always wins."""
    return "GDK_BACKEND" in environ and environ.get(OWN) != environ["GDK_BACKEND"]


def read_preference(directory):
    try:
        value = (Path(directory) / PREFERENCE).read_text("utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return None
    return value if value in CHOICES else None


def write_preference(directory, value):
    if value not in CHOICES:
        raise ValueError(value)
    folder = Path(directory)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, name = tempfile.mkstemp(dir=folder, prefix="display-")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(value + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, folder / PREFERENCE)
    except BaseException:
        Path(name).unlink(missing_ok=True)
        raise


def configure(environ, directory):
    """Applies the saved choice to environ before GTK starts. A restart first drops the GDK_BACKEND Work Fleet set."""
    if OWN in environ:
        if environ.get("GDK_BACKEND") == environ[OWN]:
            environ.pop("GDK_BACKEND", None)
        environ.pop(OWN, None)
    if "GDK_BACKEND" in environ or not gnome_wayland(environ):
        return
    if read_preference(directory) == "x11":
        environ["GDK_BACKEND"] = environ[OWN] = "x11"


def data_unlocked(directory):
    """A restart only starts once no process, this one included, still holds the data owner lock."""
    try:
        descriptor = os.open(Path(directory) / "owner.lock", os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    except FileNotFoundError:
        return True
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        return True
    except BlockingIOError:
        return False
    finally:
        os.close(descriptor)


class DisplayChoice:
    """What the main window may show and change; on GNOME Wayland a GDK_BACKEND from the user fixes the choice."""
    def __init__(self, directory, environ, current):
        self.directory, self.current = Path(directory), current
        self.gnome = gnome_wayland(environ)
        self.switchable = self.gnome and not user_backend(environ)

    def info(self):
        if not self.gnome:
            return None
        value = {"current": self.current, "preference": read_preference(self.directory)}
        if not self.switchable:
            value["fixed"] = True
        return value

    def ask(self):
        """First launch on native GNOME Wayland: nothing chosen yet, so the user is asked once."""
        return self.switchable and self.current == "wayland" and read_preference(self.directory) is None

    def choose(self, xwayland):
        if not self.switchable:
            raise ValueError("display backend is fixed")
        write_preference(self.directory, "x11" if xwayland else "wayland")
        return self.info()
