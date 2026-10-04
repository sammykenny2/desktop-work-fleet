#!/bin/bash
# Preserve an unsigned native Debug build as a macOS ZIP or device iOS IPA.
# Usage: package-preview-app.sh --platform macos|ios [--simulator]
set -euo pipefail
usage() { echo 'Usage: package-preview-app.sh --platform macos|ios [--simulator]'; }
PLATFORM=''; SIMULATOR=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help) usage; exit 0 ;;
        --platform) PLATFORM="${2:-}"; shift 2 ;;
        --simulator) SIMULATOR=1; shift ;;
        *) usage >&2; exit 2 ;;
    esac
done
[[ "$PLATFORM" == macos || "$PLATFORM" == ios ]] || { usage >&2; exit 2; }
[[ "$SIMULATOR" == 0 || "$PLATFORM" == ios ]] || { usage >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"; cd "$PROJECT_ROOT"
PRODUCTS="$PROJECT_ROOT/build/apple/DerivedData/Build/Products"
APP="$PRODUCTS/Debug/WorkFleetMac.app"
if [[ "$PLATFORM" == ios ]]; then
    SDK=iphoneos; [[ "$SIMULATOR" == 0 ]] || SDK=iphonesimulator
    APP="$PRODUCTS/Debug-$SDK/WorkFleetIOS.app"
fi
[[ -d "$APP" ]] || { echo 'Build the matching native Debug app first.' >&2; exit 1; }
OUTPUT="$(mktemp -d "$PROJECT_ROOT/build/apple/preview-$PLATFORM-XXXXXXXX")"
if [[ "$PLATFORM" == ios && "$SIMULATOR" == 0 ]]; then
    mkdir "$OUTPUT/Payload"; ditto "$APP" "$OUTPUT/Payload/WorkFleetIOS.app"
    (cd "$OUTPUT"; ditto -c -k --keepParent Payload WorkFleet-1.0.0-ios-unsigned.ipa)
elif [[ "$PLATFORM" == ios ]]; then
    ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUTPUT/WorkFleet-1.0.0-ios-simulator.zip"
else
    ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUTPUT/WorkFleet-1.0.0-macos-unsigned.zip"
fi
DEVELOPER_PATH="$(node scripts/toolchain-env.mjs | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; process.stdout.write(JSON.parse(s).DEVELOPER_DIR);')"
[[ -z "$DEVELOPER_PATH" ]] || export DEVELOPER_DIR="$DEVELOPER_PATH"
xcodebuild -version > "$OUTPUT/toolchain.txt"
printf 'Native Debug preview. Platform: %s. Simulator: %s. Requires suitable signing/provisioning for protected storage and device installation.\n' "$PLATFORM" "$SIMULATOR" > "$OUTPUT/README.txt"
echo "Preview package: $OUTPUT"
