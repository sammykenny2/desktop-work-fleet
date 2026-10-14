"""Test explicit libsecret prompts with a synthetic provider in an isolated D-Bus session.

Usage: XDG_DATA_HOME=OUTPUT/data XDG_RUNTIME_DIR=OUTPUT/runtime \
  dbus-run-session -- python3 tests/native/linux/unlock_probe.py OUTPUT
No desktop provider, display, real credentials or keyring is used.
"""
import os
from pathlib import Path
import sys
import threading
import time

OUTPUT = Path(sys.argv[1]).resolve()
for variable in ("XDG_DATA_HOME", "XDG_RUNTIME_DIR"):
    Path(os.environ[variable]).resolve().relative_to(OUTPUT)
parent = os.getppid()
if Path(f"/proc/{parent}/exe").resolve().name != "dbus-run-session":
    raise RuntimeError("requires its own dbus-run-session wrapper")

import gi
gi.require_version("Secret", "1")
from gi.repository import Gio, GLib

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
pid = bus.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetConnectionUnixProcessID",
                    GLib.Variant("(s)", ("org.freedesktop.DBus",)), GLib.VariantType.new("(u)"),
                    Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
if f"PPid:\t{parent}\n" not in Path(f"/proc/{pid}/status").read_text():
    raise RuntimeError("D-Bus daemon does not belong to this private session")

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src/native/linux"))
import database
import protocol as p

COLLECTION = "/org/freedesktop/secrets/collection/probe"
PROMPT = "/org/freedesktop/secrets/prompt/probe"
definition = Gio.DBusNodeInfo.new_for_xml("""
<node>
  <interface name="org.freedesktop.Secret.Service">
    <property name="Collections" type="ao" access="read"/>
    <method name="ReadAlias"><arg type="s" direction="in"/><arg type="o" direction="out"/></method>
    <method name="Unlock"><arg type="ao" direction="in"/><arg type="ao" direction="out"/><arg type="o" direction="out"/></method>
  </interface>
  <interface name="org.freedesktop.Secret.Collection">
    <property name="Locked" type="b" access="read"/>
    <property name="Items" type="ao" access="read"/>
    <property name="Label" type="s" access="read"/>
    <property name="Created" type="t" access="read"/>
    <property name="Modified" type="t" access="read"/>
  </interface>
  <interface name="org.freedesktop.Secret.Prompt">
    <method name="Prompt"><arg type="s" direction="in"/></method>
    <method name="Dismiss"/>
    <signal name="Completed"><arg type="b"/><arg type="v"/></signal>
  </interface>
</node>
""")
server = Gio.DBusConnection.new_for_address_sync(os.environ["DBUS_SESSION_BUS_ADDRESS"],
    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)
server.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName",
                 GLib.Variant("(su)", ("org.freedesktop.secrets", 4)), GLib.VariantType.new("(u)"),
                 Gio.DBusCallFlags.NONE, 5000, None)
state = {"locked": True, "mode": "cancel", "unlock": 0, "prompt": 0, "dismiss": 0}
vault = database.Vault("app.workfleet.unlockprobe")
db = database.Database(OUTPUT / "workspace", "local", vault)
errors = []
loop = GLib.MainLoop()

def property_value(_connection, _sender, _path, interface, name):
    if interface.endswith("Service"):
        return GLib.Variant("ao", [COLLECTION])
    values = {"Locked": ("b", state["locked"]), "Items": ("ao", []), "Label": ("s", "Synthetic persistent vault"),
              "Created": ("t", 1), "Modified": ("t", 1)}
    return GLib.Variant(*values[name])

def completed(sender, dismissed):
    server.emit_signal(sender, PROMPT, "org.freedesktop.Secret.Prompt", "Completed",
                       GLib.Variant("(bv)", (dismissed, GLib.Variant("ao", [] if dismissed else [COLLECTION]))))
    return False

def method(_connection, sender, _path, _interface, member, parameters, invocation):
    if member == "ReadAlias":
        alias = parameters.unpack()[0]
        if state["mode"] == "owner-close-preflight":
            state["owner_closed"].set()
        reply = GLib.Variant("(o)", (COLLECTION if alias == "default" else "/",))
        if state["mode"] == "slow-preflight":
            GLib.timeout_add(500, lambda: (invocation.return_value(reply), False)[1])
        else:
            invocation.return_value(reply)
    elif member == "Unlock":
        assert parameters.unpack()[0] == [COLLECTION], "unlock must target the persistent default only"
        state["unlock"] += 1
        invocation.return_value(GLib.Variant("(aoo)", ([], PROMPT)))
    elif member == "Prompt":
        state["prompt"] += 1
        invocation.return_value(None)
        db.secret("offline", "fixture", b"editable while system prompt waits")
        if state["mode"] == "accept":
            state["locked"] = False
            GLib.idle_add(completed, sender, False)
        elif state["mode"] == "cancel":
            GLib.idle_add(completed, sender, True)
        elif state["mode"] == "close":
            GLib.timeout_add(30, lambda: (vault.close(), False)[1])
    elif member == "Dismiss":
        state["dismiss"] += 1
        invocation.return_value(None)
        # A broken provider may acknowledge Dismiss without ever emitting Completed.
        # The application must still return within its own deadline.
    else:
        invocation.return_dbus_error("org.freedesktop.DBus.Error.UnknownMethod", "unexpected operation")

for path, name in (("/org/freedesktop/secrets", "Service"), (COLLECTION, "Collection"), (PROMPT, "Prompt")):
    server.register_object(path, definition.lookup_interface("org.freedesktop.Secret." + name), method, property_value, None)

def failure(action, code):
    try:
        action()
        raise AssertionError("expected " + code)
    except p.Failure as error:
        assert error.code == code, (code, error.code, str(error))

def run():
    try:
        failure(lambda: vault.read("google-account", "fixture"), "vault-locked")
        failure(lambda: vault.values("storage-key", "v1"), "vault-locked")
        assert state["unlock"] == state["prompt"] == 0
        print("PASS startup/background reads perform no Unlock or Prompt")
        failure(vault.unlock, "vault-unlock-cancelled")
        assert state["locked"] and state["prompt"] == 1
        assert db.secret("offline", "fixture") == b"editable while system prompt waits"
        print("PASS manual cancellation stays locked and notes remain editable")
        state["mode"] = "accept"
        vault.unlock()
        assert not state["locked"] and state["prompt"] == 2
        vault.unlock()
        assert state["prompt"] == 2
        print("PASS manual retry performs the system Prompt and unlocked retry adds no prompt")
        state.update(locked=True, mode="hold")
        vault.UNLOCK_TIMEOUT = 0.15
        started = time.monotonic()
        failure(vault.unlock, "vault-unlock-timeout")
        assert time.monotonic() - started < 1
        for _ in range(100):
            if state["dismiss"]:
                break
            threading.Event().wait(0.01)
        assert state["dismiss"] == 1
        assert state["locked"] and state["prompt"] == 3
        assert vault.prompt_cancellable is None
        print("PASS prompt timeout returns even when Dismiss produces no Completed")
        state["mode"] = "slow-preflight"
        started = time.monotonic()
        failure(vault.unlock, "vault-unlock-timeout")
        assert time.monotonic() - started < 1
        assert state["unlock"] == state["prompt"] == 3
        print("PASS slow preflight shares the deadline and cannot open a late Prompt")
        def expired_request():
            with vault.interaction(deadline=time.monotonic() - 1):
                vault.unlock()
        failure(expired_request, "vault-unlock-timeout")
        assert state["unlock"] == state["prompt"] == 3
        print("PASS a request whose queue deadline expired never opens a Prompt")
        def slow_readback():
            with vault.interaction(deadline=time.monotonic() + 0.3):
                state["mode"] = "accept"
                vault.unlock()
                state["mode"] = "slow-preflight"
                vault.read("google-account", "fixture")
        failure(slow_readback, "vault-unlock-timeout")
        assert state["prompt"] == 4
        print("PASS credential readback shares the same operation deadline")
        owner_closed = threading.Event()
        state.update(locked=True, mode="owner-close-preflight", owner_closed=owner_closed)
        vault.UNLOCK_TIMEOUT = 90
        failure(lambda: vault.unlock(owner_closed), "stale-session")
        assert state["unlock"] == state["prompt"] == 4
        assert not vault.closed.is_set()
        state["mode"] = "accept"
        vault.unlock(threading.Event())
        assert state["prompt"] == 5
        print("PASS profile close during preflight prevents its Prompt and a new owner can still unlock")
        state["locked"] = True
        state["mode"] = "close"
        vault.UNLOCK_TIMEOUT = 90
        failure(vault.unlock, "stale-session")
        assert state["prompt"] == 6
        print("PASS session close cancels the pending system prompt")
    except BaseException as error:
        errors.append(error)
    finally:
        GLib.idle_add(loop.quit)

worker = threading.Thread(target=run)
worker.start()
try:
    loop.run()
    worker.join(5)
    if errors:
        raise errors[0]
finally:
    vault.close()
    db.close()
    server.close_sync(None)
