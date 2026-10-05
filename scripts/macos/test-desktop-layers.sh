#!/bin/bash
# Compile the actual AppKit layer/coordinator sources and run a synthetic native probe.
# Usage: ./scripts/macos/test-desktop-layers.sh [--help]
set -euo pipefail
usage() { echo 'Usage: ./scripts/macos/test-desktop-layers.sh [--help]'; }
if [[ "${1:-}" == '--help' ]]; then usage; exit 0; fi
[[ "$#" == 0 ]] || { usage >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
mkdir -p "$ROOT/build"
OUTPUT="$(mktemp -d "$ROOT/build/macos-layer-checks-XXXXXXXX")"
xcrun swiftc -parse-as-library -swift-version 5 \
    src/native/apple/Shared/FleetProtocol.swift \
    src/native/apple/macos/FleetSceneProtocol.swift \
    src/native/apple/macos/FleetSceneSurface.swift \
    src/native/apple/macos/FleetShortcuts.swift \
    src/native/apple/macos/FleetDesktop.swift \
    tests/native/apple/SceneLayersProbe.swift \
    -o "$OUTPUT/scene-layers-probe"
"$OUTPUT/scene-layers-probe" | tee "$OUTPUT/result.txt"
