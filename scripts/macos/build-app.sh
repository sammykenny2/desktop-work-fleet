#!/bin/bash
# Build and ad-hoc sign the sandboxed validation app with Command Line Tools.
# Usage: scripts/macos/build-app.sh [--help]
set -euo pipefail
usage() { echo 'Usage: scripts/macos/build-app.sh [--help]'; }
if [[ "${1:-}" == '--help' ]]; then usage; exit 0; fi
if [[ $# -ne 0 ]]; then usage >&2; exit 2; fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP="$PROJECT_ROOT/build/Work Fleet.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$PROJECT_ROOT/build/module-cache"
xcrun swiftc -swift-version 5 -O -module-cache-path "$PROJECT_ROOT/build/module-cache" \
    -target "$(uname -m)-apple-macosx13.0" \
    "$PROJECT_ROOT/src/macos/main.swift" -o "$APP/Contents/MacOS/WorkFleet"
cp "$PROJECT_ROOT/src/macos/Info.plist" "$APP/Contents/Info.plist"
cp "$PROJECT_ROOT/tests/web-probe.js" "$APP/Contents/Resources/web-probe.js"
cp "$PROJECT_ROOT/LICENSE" "$PROJECT_ROOT/THIRD-PARTY-NOTICES.md" "$APP/Contents/Resources/"
codesign --force --sign - --entitlements "$PROJECT_ROOT/src/macos/WorkFleet.entitlements" "$APP"
codesign --verify --strict "$APP"
echo "$APP"
