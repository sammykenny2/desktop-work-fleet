#!/bin/bash
# Build, run a loopback server and pair the sandboxed Mac app with a short-lived invite.
# Usage: scripts/macos/start-validation.sh [--port NUMBER] [--help]
# WORK_FLEET_DATA may select a private data directory outside the checkout.
set -euo pipefail
usage() { echo 'Usage: scripts/macos/start-validation.sh [--port NUMBER] [--help]'; }
PORT=9847
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help) usage; exit 0 ;;
        --port) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; PORT="$2"; shift 2 ;;
        *) usage >&2; exit 2 ;;
    esac
done
[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT > 0 && PORT < 65536)) || { usage >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="${WORK_FLEET_DATA:-$HOME/.work-fleet}"
DB="$DATA_DIR/fleet.sqlite3"
python3 - "$PROJECT_ROOT" "$DATA_DIR" <<'PY'
from pathlib import Path
import sys
root, data = map(lambda p: Path(p).expanduser().resolve(), sys.argv[1:])
if data.is_relative_to(root):
    raise SystemExit('Application data must be outside the checkout.')
data.mkdir(parents=True, exist_ok=True, mode=0o700)
PY
bash "$SCRIPT_DIR/build-app.sh"
python3 "$PROJECT_ROOT/src/server/work_fleet.py" --db "$DB" serve --port "$PORT" &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT TERM
sleep 1
kill -0 "$SERVER_PID" 2>/dev/null || { echo 'Server failed; check whether the port is in use.' >&2; exit 1; }
INVITE="$(python3 "$PROJECT_ROOT/src/server/work_fleet.py" --db "$DB" invite --role admin | python3 -c 'import json,sys; print(json.load(sys.stdin)["code"])')"
open -a "$PROJECT_ROOT/build/Work Fleet.app" --args --server "http://127.0.0.1:$PORT" --invite "$INVITE"
echo "Use menu bar WF to unlock/edit. Web editor: http://127.0.0.1:$PORT"
echo 'If Work Fleet was already running, create a fresh invite and pair from its connection window.'
echo 'Ctrl-C stops this server; saved notes and drafts remain.'
wait "$SERVER_PID"
