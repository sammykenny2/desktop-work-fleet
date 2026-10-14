"""Exercise real libsecret migration in a private D-Bus session and disposable keyring.

Usage: dbus-run-session -- python3 tests/native/linux/storage_probe.py OUTPUT
Requires XDG_DATA_HOME and XDG_RUNTIME_DIR under OUTPUT, set before starting D-Bus.
Never run against the desktop's D-Bus session or its real keyring.
"""
import base64
import os
from pathlib import Path
import subprocess
import sys
import time

OUTPUT = Path(sys.argv[1]).resolve()
for variable in ("XDG_DATA_HOME", "XDG_RUNTIME_DIR"):
    Path(os.environ[variable]).resolve().relative_to(OUTPUT)
    Path(os.environ[variable]).mkdir(parents=True, exist_ok=True, mode=0o700)
parent = os.getppid()
if Path(f"/proc/{parent}/exe").resolve().name != "dbus-run-session":
    raise RuntimeError("requires its own dbus-run-session wrapper")
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src/native/linux"))
import database
import protocol as p
import gi
gi.require_version("Secret", "1")
from gi.repository import Secret
from gi.repository import Gio, GLib

# The bus daemon and this script must both be children of the dbus-run-session wrapper.
# XDG paths alone cannot prevent accidentally connecting to a desktop's existing keyring.
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
bus_pid = bus.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus",
                        "GetConnectionUnixProcessID", GLib.Variant("(s)", ("org.freedesktop.DBus",)),
                        GLib.VariantType.new("(u)"), Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
status = Path(f"/proc/{bus_pid}/status").read_text()
if f"PPid:\t{parent}\n" not in status:
    raise RuntimeError("D-Bus daemon does not belong to this private session")

app = "app.workfleet.storageprobe"
legacy = database.Vault(app)
environment = dict(os.environ)
environment.pop("DISPLAY", None)
environment.pop("WAYLAND_DISPLAY", None)
with (OUTPUT / "daemon.log").open("wb") as log:
    daemon = subprocess.Popen(["gnome-keyring-daemon", "--foreground", "--unlock", "--components=secrets",
                               "--control-directory", os.environ["XDG_RUNTIME_DIR"]],
                              stdin=subprocess.PIPE, stdout=log, stderr=log, env=environment)
    try:
        daemon.stdin.write(b"synthetic-probe-password")
        daemon.stdin.close()
        deadline = time.monotonic() + 10
        while True:
            try:
                service = Secret.Service.get_sync(Secret.ServiceFlags.LOAD_COLLECTIONS, None)
                if service.get_collections():
                    break
            except Exception:
                pass
            if time.monotonic() >= deadline:
                raise AssertionError("private keyring did not start")
            time.sleep(0.1)
        folder = OUTPUT / "workspace"
        db = database.Database(folder, "local", legacy)
        db.secret("fixture", "private", b"private notes")
        db.close()
        raw = (folder / "storage-key").read_bytes()
        (folder / "storage-key").unlink()
        legacy.connect()
        assert Secret.password_store_sync(legacy.schema, legacy.attributes("storage-key", "v1"),
                                          Secret.COLLECTION_DEFAULT, "Work Fleet storage probe",
                                          base64.b64encode(raw).decode("ascii"), None)
        assert Secret.password_store_sync(legacy.schema, legacy.attributes("google-account", "fixture"),
                                          Secret.COLLECTION_DEFAULT, "Work Fleet credential probe", "synthetic-token", None)
        db = database.Database(folder, "local", legacy)
        assert db.secret("fixture", "private") == b"private notes"
        assert database.Credentials(db, legacy).read("google-account", "fixture") == "synthetic-token"
        db.close()
        print("PASS real libsecret migrates the original key and Google credential")
        collections = service.get_collections()
        assert service.lock_sync(collections, None)[0] > 0
        assert legacy.read("storage-key", "v1") is None  # Must raise vault-locked instead of trying to prompt.
        raise AssertionError("locked legacy key unexpectedly returned")
    except p.Failure as error:
        assert error.code == "vault-locked"
        db = database.Database(folder, "local", legacy)
        assert db.secret("fixture", "private") == b"private notes"
        assert database.Credentials(db, legacy).read("google-account", "fixture") == "synthetic-token"
        db.close()
        print("PASS locked real keyring returns without a prompt; migrated data and Google remain accessible")
        # A separate old workspace must fail promptly and preserve every encrypted byte.
        (folder / "storage-key").unlink()
        before = (folder / "fleet.sqlite3").read_bytes()
        try:
            database.Database(folder, "local", legacy)
            raise AssertionError("locked unmigrated data opened")
        except p.Failure as failure:
            assert failure.code == "vault-locked"
        assert (folder / "fleet.sqlite3").read_bytes() == before
        assert not (folder / "storage-key").exists()
        print("PASS locked unmigrated data stays unchanged without a prompt")
    finally:
        legacy.close()
        daemon.terminate()
        daemon.wait(timeout=10)
