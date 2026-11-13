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
    src/native/apple/Shared/PinItAnywhereProtocol.swift \
    src/native/apple/Shared/PinItAnywhereText.swift \
    src/native/apple/macos/PinItAnywhereSceneProtocol.swift \
    src/native/apple/macos/PinItAnywhereSceneSurface.swift \
    src/native/apple/macos/PinItAnywhereShortcuts.swift \
    src/native/apple/macos/PinItAnywhereDesktop.swift \
    tests/native/apple/SceneLayersProbe.swift \
    -o "$OUTPUT/scene-layers-probe"
"$OUTPUT/scene-layers-probe" | tee "$OUTPUT/result.txt"
