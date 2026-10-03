"""Run the signed app against disposable data; never use personal notes or tokens."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "server"))
from work_fleet import Store, make_server

with tempfile.TemporaryDirectory(prefix="work-fleet-probe-") as directory:
    store = Store(Path(directory) / "test.sqlite3")
    token = store.bootstrap().read_text()
    server = make_server(store, port=0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    epoch = store.dispatch("GET", "/api/snapshot", token, {}, server.origin)["epoch"]
    note_id = str(uuid.uuid4())
    def create_note():
        time.sleep(2)
        store.dispatch("POST", "/api/operations", token, {
            "epoch": epoch, "operation": str(uuid.uuid4()), "id": note_id,
            "action": "create", "text": "Validation fixture received from the real SQLite service", "board": "Validation"}, server.origin)
    threading.Thread(target=create_note, daemon=True).start()
    code = store.create_invite("admin")["code"]
    binary = ROOT / "build" / "Work Fleet.app" / "Contents" / "MacOS" / "WorkFleet"
    extra = []
    if "--mode" in sys.argv:
        extra += ["--mode", sys.argv[sys.argv.index("--mode") + 1]]
    if "--web" in sys.argv:
        extra += ["--web-probe", "--peer-invite", store.create_invite()["code"]]
    result = subprocess.run([str(binary), "--probe", "--server", server.origin, "--invite", code] + extra,
                            capture_output=True, text=True, timeout=65)
    server.shutdown()
    server.server_close()
    # Only diagnostics, no permanent tokens or note text.
    print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    print(json.dumps({"app_exit": result.returncode}))
    events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith("{")]
    def event(name):
        return next(item for item in events if item.get("event") == name)
    assert result.returncode == 0
    assert event("launch")["container"]
    assert event("qr")["roundTrip"] and not event("qr")["containsPermanentToken"]
    assert event("sandbox_write")["denied"] and event("sandbox_write")["errorCode"] == 513
    snapshots = [item for item in events if item.get("event") == "snapshot" and item["locked"]]
    assert any(item["count"] == 1 and item["revisionSum"] == 1 for item in snapshots)
    assert all(item["ignoresMouse"] and not item["canBecomeKey"] and not item["isKey"] for item in snapshots)
    assert event("background_focus")["unchanged"]
    assert not event("unlocked")["ignoresMouse"] and event("unlocked")["canBecomeKey"]
    assert event("relocked")["ignoresMouse"] and not event("relocked")["canBecomeKey"] and not event("relocked")["isKey"]
    if "--web" in sys.argv:
        web_checks = [item for item in events if item.get("event") == "web_checks"]
        assert len(web_checks) == 2 and len(web_checks[0]["checks"]) >= 9 and len(web_checks[1]["checks"]) == 2
    print("PASS: sandbox, live data, locked policy, background focus, unlock/relock")
