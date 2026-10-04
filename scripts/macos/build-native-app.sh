#!/bin/bash
# Build or archive the native Apple app; signing credentials remain in Xcode/Keychain.
# Usage: scripts/macos/build-native-app.sh --platform macos|ios [--release] [--simulator] [--unsigned]
set -euo pipefail
usage() { echo 'Usage: scripts/macos/build-native-app.sh --platform macos|ios [--release] [--simulator] [--unsigned]'; }
PLATFORM=''; CONFIGURATION='Debug'; SIMULATOR=0; UNSIGNED=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help) usage; exit 0 ;;
    --platform) PLATFORM="${2:-}"; shift 2 ;;
    --release) CONFIGURATION='Release'; shift ;;
    --simulator) SIMULATOR=1; shift ;;
    --unsigned) UNSIGNED=1; shift ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ "$PLATFORM" == 'macos' || "$PLATFORM" == 'ios' ]] || { usage >&2; exit 2; }
[[ "$SIMULATOR" == 0 || ( "$PLATFORM" == 'ios' && "$CONFIGURATION" == 'Debug' ) ]] || { usage >&2; exit 2; }
[[ "$UNSIGNED" == 0 || "$CONFIGURATION" == 'Debug' ]] || { echo '--unsigned is available only for preview Debug builds.' >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"
DEVELOPER_PATH="$(node scripts/toolchain-env.mjs | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; process.stdout.write(JSON.parse(s).DEVELOPER_DIR);')"
[[ -z "$DEVELOPER_PATH" ]] || export DEVELOPER_DIR="$DEVELOPER_PATH"
if [[ "$CONFIGURATION" == 'Release' ]]; then node scripts/check-config.mjs --platform "$PLATFORM"; fi
npm run build
node scripts/generate-apple-project.mjs
SCHEME='WorkFleetMac'; DESTINATION='generic/platform=macOS'
if [[ "$PLATFORM" == 'ios' ]]; then SCHEME='WorkFleetIOS'; DESTINATION='generic/platform=iOS'; fi
EXTRA=()
if [[ "$SIMULATOR" == 1 ]]; then DESTINATION='generic/platform=iOS Simulator'; fi
if [[ "$SIMULATOR" == 1 || "$UNSIGNED" == 1 ]]; then EXTRA+=(CODE_SIGNING_ALLOWED=NO); fi
ACTION='build'
if [[ "$CONFIGURATION" == 'Release' ]]; then ACTION='archive'; EXTRA+=(-archivePath "$PROJECT_ROOT/build/apple/$SCHEME.xcarchive"); fi
xcodebuild -project "$PROJECT_ROOT/build/apple/WorkFleet.xcodeproj" -scheme "$SCHEME" -configuration "$CONFIGURATION" \
  -destination "$DESTINATION" -derivedDataPath "$PROJECT_ROOT/build/apple/DerivedData" \
  -clonedSourcePackagesDirPath "$PROJECT_ROOT/build/apple/SourcePackages" "${EXTRA[@]}" "$ACTION"
