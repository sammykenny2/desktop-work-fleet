#!/bin/bash
# Check the GTK owner's main window bounds, startup settings and hidden sign-in start in private X11 and labwc sessions.
# Usage: ./scripts/linux/test-host-shell.sh OUTPUT [--help]
# Needs xvfb-run, openbox, labwc and the GTK/WebKit bindings (tests/native/linux/Dockerfile). No user data or desktop is used.
set -euo pipefail
usage() { echo 'Usage: ./scripts/linux/test-host-shell.sh OUTPUT'; }
if [[ "${1:-}" == '--help' ]]; then usage; exit 0; fi
[[ "$#" == 1 ]] || { usage >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$1"
OUTPUT="$(cd "$1" && pwd)"
rm -rf "$OUTPUT/data" "$OUTPUT/config" "$OUTPUT/bundle"
export GDK_BACKEND=x11
cd "$ROOT"
xvfb-run -a -s '-screen 0 1920x1080x24' bash -c '
    openbox > "$0/openbox.log" 2>&1 &
    sleep 1
    for mode in place restore hidden hidden-tray; do python3 -B tests/native/linux/host_probe.py "$0" "$mode" || exit 1; done
' "$OUTPUT"
# labwc places windows itself, as on the Raspberry Pi: only the size and maximized state are kept.
rm -rf "$OUTPUT/data" "$OUTPUT/config" "$OUTPUT/bundle"
export XDG_RUNTIME_DIR="$(mktemp -d)" WLR_BACKENDS=headless WLR_HEADLESS_OUTPUTS=1 WLR_RENDERER=pixman GDK_BACKEND=wayland
labwc --config-dir "$XDG_RUNTIME_DIR" > "$OUTPUT/labwc.log" 2>&1 &
COMPOSITOR=$!
trap 'kill "$COMPOSITOR" 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do
    [[ ! -S "$XDG_RUNTIME_DIR/wayland-0" ]] || break
    kill -0 "$COMPOSITOR" 2>/dev/null || { cat "$OUTPUT/labwc.log" >&2; exit 1; }
    sleep 0.1
done
export WAYLAND_DISPLAY=wayland-0
for mode in wayland wayland-restore; do python3 -B tests/native/linux/host_probe.py "$OUTPUT" "$mode"; done
