#!/bin/bash
# Run real GTK/WebKit scenes in a private headless labwc session, without user data.
# Usage: ./scripts/linux/test-desktop-layers.sh OUTPUT SCENARIOS [--help]
set -euo pipefail
usage() { echo 'Usage: ./scripts/linux/test-desktop-layers.sh OUTPUT SCENARIOS'; }
if [[ "${1:-}" == '--help' ]]; then usage; exit 0; fi
[[ "$#" == 2 ]] || { usage >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$1"
OUTPUT="$(cd "$1" && pwd)"
SCENARIOS="$(realpath "$2")"
export XDG_RUNTIME_DIR="$(mktemp -d)"
export WLR_BACKENDS=headless WLR_HEADLESS_OUTPUTS=1 WLR_RENDERER=pixman
# The Raspberry Pi renderer default: WebKit without its DMA-BUF renderer blanks a scene once the pointer moves over it.
export GDK_BACKEND=wayland LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DMABUF_RENDERER_FORCE_SHM=1
# This flag is scoped to the isolated root Docker test, never the product launcher.
if [[ "$(id -u)" == 0 ]]; then export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1; fi
labwc --config-dir "$XDG_RUNTIME_DIR" > "$OUTPUT/compositor.log" 2>&1 &
COMPOSITOR=$!
trap 'kill "$COMPOSITOR" 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do
    [[ ! -S "$XDG_RUNTIME_DIR/wayland-0" ]] || break
    kill -0 "$COMPOSITOR" 2>/dev/null || { cat "$OUTPUT/compositor.log" >&2; exit 1; }
    sleep 0.1
done
export WAYLAND_DISPLAY=wayland-0
cd "$ROOT"
WAYLAND_DEBUG=client python3 -B tests/native/linux/scenes_probe.py "$OUTPUT" "$SCENARIOS" \
    > "$OUTPUT/probe.log" 2> "$OUTPUT/wayland.log" || { cat "$OUTPUT/probe.log" "$OUTPUT/wayland.log" >&2; exit 1; }
cat "$OUTPUT/probe.log"
python3 -B tests/native/linux/check_trace.py "$OUTPUT/wayland.log" "$OUTPUT/input-regions.json"
