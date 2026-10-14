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
environment["GNOME_KEYRING_CONTROL"] = os.environ["XDG_RUNTIME_DIR"]
environment.pop("GNOME_KEYRING_PID", None)
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
                has_owner = bus.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "NameHasOwner",
                                         GLib.Variant("(s)", ("org.freedesktop.secrets",)), GLib.VariantType.new("(b)"),
                                         Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
                if has_owner:
                    service = Secret.Service.get_sync(Secret.ServiceFlags.LOAD_COLLECTIONS, None)
                    if service.get_collections():
                        break
            except Exception:
                pass
            if time.monotonic() >= deadline:
                raise AssertionError("private keyring did not start")
            time.sleep(0.1)
        prompt_log = (OUTPUT / "prompts.log").open("wb")
        monitor = subprocess.Popen(["dbus-monitor", "--session", "type='method_call',interface='org.freedesktop.Secret.Prompt',member='Prompt'"],
                                   stdout=prompt_log, stderr=log, env=environment)
        time.sleep(0.1)
        legacy.connect()
        retired_services = []
        def settle():
            context = GLib.MainContext.default()
            for _ in range(10):
                while context.pending():
                    context.iteration(False)
                time.sleep(0.01)
        def restart_unlocked():
            global daemon, service, collections
            retired_services.append(service)
            daemon.terminate()
            daemon.wait(timeout=10)
            daemon = subprocess.Popen(["gnome-keyring-daemon", "--foreground", "--unlock", "--components=secrets", "--control-directory", os.environ["XDG_RUNTIME_DIR"]],
                                      stdin=subprocess.PIPE, stdout=log, stderr=log, env=environment)
            daemon.stdin.write(b"synthetic-probe-password")
            daemon.stdin.close()
            time.sleep(0.2)
            owner = bus.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetNameOwner",
                                  GLib.Variant("(s)", ("org.freedesktop.secrets",)), GLib.VariantType.new("(s)"),
                                  Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
            service = Secret.Service.open_sync(Secret.Service.__gtype__, owner, Secret.ServiceFlags.LOAD_COLLECTIONS, None)
            collections = service.get_collections()
            settle()

        def no_prompts():
            prompt_log.flush()
            assert "member=Prompt" not in (OUTPUT / "prompts.log").read_text()
        folder = OUTPUT / "workspace"
        db = database.Database(folder, "local", legacy)
        db.secret("fixture", "private", b"private notes")
        credentials = database.Credentials(db, legacy)
        credentials.save("google-account", "fixture", "synthetic-token")
        protected = credentials.secrets
        protected.save("local", "backup-key", "fixture", "synthetic-backup-password")
        assert db.connection.execute("SELECT COUNT(*) FROM credentials").fetchone()[0] == 0
        print("PASS new credentials and backup passwords remain only in the system vault")
        assert credentials.read("google-account", "fixture") == "synthetic-token"
        assert Secret.password_store_sync(legacy.schema, legacy.attributes("google-account", "fixture"),
                                          Secret.COLLECTION_DEFAULT, "Work Fleet external refresh probe",
                                          "provider-updated-token", None)
        assert credentials.read("google-account", "fixture") == "provider-updated-token"
        print("PASS reads observe fresh provider values without using libsecret's secret cache")
        db.close()
        raw = (folder / "storage-key").read_bytes()
        (folder / "storage-key").unlink()
        assert Secret.password_store_sync(legacy.schema, legacy.attributes("storage-key", "v1"),
                                          Secret.COLLECTION_DEFAULT, "Work Fleet storage probe",
                                          base64.b64encode(raw).decode("ascii"), None)
        db = database.Database(folder, "local", legacy)
        assert db.secret("fixture", "private") == b"private notes"
        credentials = database.Credentials(db, legacy)
        assert credentials.read("google-account", "fixture") == "provider-updated-token"
        print("PASS legacy workspace key migration preserves notes")
        collections = service.get_collections()
        assert service.lock_sync(collections, None)[0] > 0
        for action in (lambda: credentials.read("google-account", "fixture"),
                       lambda: credentials.secrets.read("local", "backup-key", "fixture"),
                       lambda: credentials.save("google-account", "new-account", "new-token")):
            try:
                action()
                raise AssertionError("locked vault allowed a secret operation")
            except p.Failure as error:
                assert error.code == "vault-locked"
        assert db.secret("fixture", "private") == b"private notes"
        db.secret("fixture", "editable", b"editable while locked")
        print("PASS locked real keyring pauses tokens and passwords while local notes stay editable")
        # Restart the private provider unlocked, then lock after precheck and before CreateItem.
        restart_unlocked()
        settle()
        original = legacy.writable
        def race():
            result = original()
            assert service.lock_sync(collections, None)[0] > 0
            return result
        legacy.writable = race
        try:
            legacy.save("google-account", "race", "race-token")
            raise AssertionError("raced lock unexpectedly saved a token")
        except p.Failure as error:
            assert error.code in ("vault-locked", "vault-unavailable")
        finally:
            legacy.writable = original
        no_prompts()
        print("PASS collection lock after precheck causes safe failure without Secret.Prompt.Prompt")
        restart_unlocked()
        settle()
        assert credentials.read("google-account", "fixture") == "provider-updated-token"
        assert credentials.secrets.read("local", "backup-key", "fixture") == "synthetic-backup-password"
        print("PASS secrets resume after provider restart without resetting the production vault")
        # Simulate b1c074a's local copies and prove the original ciphertext disappears from active DB/WAL.
        nonce = os.urandom(12)
        old = nonce + db.cipher.encrypt(nonce, b"pending-token", database.Credentials.aad("google-account", "fixture"))
        db.connection.execute("INSERT INTO credentials VALUES(?,?,?)", ("google-account", "fixture", old))
        db.secret("backup-key", "old-password", b"pending-password")
        assert credentials.secrets.migrate_pending() == 0
        for name in ("fleet.sqlite3", "fleet.sqlite3-wal"):
            file = folder / name
            if file.exists():
                assert old not in file.read_bytes()
        assert credentials.read("google-account", "fixture") == "pending-token"
        print("PASS pending local copies move to the real vault and old ciphertext is absent from DB/WAL")
        no_prompts()
        db.close()
    finally:
        if "monitor" in globals():
            monitor.terminate()
            monitor.wait(timeout=10)
            prompt_log.close()
        legacy.close()
        daemon.terminate()
        daemon.wait(timeout=10)
