#!/bin/bash
# Build or archive the native Apple app; signing credentials remain in Xcode/Keychain.
# macOS always builds arm64 + x86_64, so every Mac produces the same universal package.
# Usage: scripts/macos/build-native-app.sh --platform macos|ios [--release] [--simulator] [--unsigned] [--application-identity NAME --provisioning-profile UUID]
set -euo pipefail
usage() { echo 'Usage: scripts/macos/build-native-app.sh --platform macos|ios [--release] [--simulator] [--unsigned] [--application-identity NAME --provisioning-profile UUID]'; }
PLATFORM=''; CONFIGURATION='Debug'; SIMULATOR=0; UNSIGNED=0; APPLICATION=''; PROFILE=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help) usage; exit 0 ;;
    --platform) PLATFORM="${2:-}"; shift 2 ;;
    --release) CONFIGURATION='Release'; shift ;;
    --simulator) SIMULATOR=1; shift ;;
    --unsigned) UNSIGNED=1; shift ;;
    --application-identity) APPLICATION="${2:-}"; shift 2 ;;
    --provisioning-profile) PROFILE="${2:-}"; shift 2 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ "$PLATFORM" == 'macos' || "$PLATFORM" == 'ios' ]] || { usage >&2; exit 2; }
[[ "$SIMULATOR" == 0 || ( "$PLATFORM" == 'ios' && "$CONFIGURATION" == 'Debug' ) ]] || { usage >&2; exit 2; }
[[ "$UNSIGNED" == 0 || "$CONFIGURATION" == 'Debug' ]] || { echo '--unsigned is available only for preview Debug builds.' >&2; exit 2; }
if [[ -n "$APPLICATION" || -n "$PROFILE" ]]; then
    [[ "$PLATFORM" == macos && "$CONFIGURATION" == Release && -n "$APPLICATION" && -n "$PROFILE" ]] || {
        echo 'Manual Developer ID signing requires a macOS Release archive, --application-identity and --provisioning-profile.' >&2; exit 2; }
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"
DEVELOPER_PATH="$(node scripts/toolchain-env.mjs | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; process.stdout.write(JSON.parse(s).DEVELOPER_DIR);')"
[[ -z "$DEVELOPER_PATH" ]] || export DEVELOPER_DIR="$DEVELOPER_PATH"
PUBLIC_CONFIG="$(node scripts/prepare-apple-build.mjs --print-config)"
APP_ID="$(printf '%s' "$PUBLIC_CONFIG" | node -e 'let s="";process.stdin.on("data",v=>s+=v).on("end",()=>process.stdout.write(JSON.parse(s).appId));')"
APP_GROUP="$(printf '%s' "$PUBLIC_CONFIG" | node -e 'let s="";process.stdin.on("data",v=>s+=v).on("end",()=>process.stdout.write(JSON.parse(s).appleAppGroupId));')"
APPLE_TEAM="$(printf '%s' "$PUBLIC_CONFIG" | node -e 'let s="";process.stdin.on("data",v=>s+=v).on("end",()=>process.stdout.write(JSON.parse(s).appleTeamId));')"
SCHEME='WorkFleetMac'; DESTINATION='generic/platform=macOS'
if [[ "$PLATFORM" == 'ios' ]]; then SCHEME='WorkFleetIOS'; DESTINATION='generic/platform=iOS'; fi
EXTRA=()
[[ -z "$APP_ID" ]] || EXTRA+=("WORK_FLEET_APP_ID=$APP_ID")
[[ -z "$APP_ID" ]] || EXTRA+=("WORK_FLEET_APP_GROUP_ID=$APP_GROUP")
[[ -z "$APPLE_TEAM" ]] || EXTRA+=("DEVELOPMENT_TEAM=$APPLE_TEAM")
EXTRA+=("WORK_FLEET_PACKAGES_DIR=$PROJECT_ROOT/build/apple/SourcePackages")
if [[ "$PLATFORM" == 'macos' ]]; then EXTRA+=('ARCHS=arm64 x86_64' ONLY_ACTIVE_ARCH=NO); fi
# Only WorkFleetMac's Release target maps these settings to signing. Global CODE_SIGN_*/
# PROVISIONING_PROFILE_SPECIFIER overrides would incorrectly apply the profile to SPM resource bundles.
if [[ -n "$PROFILE" ]]; then
    EXTRA+=(WORK_FLEET_MACOS_SIGNING_STYLE=Manual "WORK_FLEET_MACOS_SIGNING_IDENTITY=$APPLICATION" "WORK_FLEET_MACOS_PROFILE=$PROFILE")
fi
if [[ "$SIMULATOR" == 1 ]]; then DESTINATION='generic/platform=iOS Simulator'; fi
if [[ "$SIMULATOR" == 1 || "$UNSIGNED" == 1 ]]; then EXTRA+=(CODE_SIGNING_ALLOWED=NO); fi
ACTION='build'
if [[ "$CONFIGURATION" == 'Release' ]]; then ACTION='archive'; EXTRA+=(-archivePath "$PROJECT_ROOT/build/apple/$SCHEME.xcarchive"); fi
mkdir -p "$PROJECT_ROOT/build/apple"
xcodebuild -project "$PROJECT_ROOT/src/native/apple/WorkFleet.xcodeproj" -scheme "$SCHEME" -configuration "$CONFIGURATION" \
  -destination "$DESTINATION" -derivedDataPath "$PROJECT_ROOT/build/apple/DerivedData" \
  -clonedSourcePackagesDirPath "$PROJECT_ROOT/build/apple/SourcePackages" "${EXTRA[@]}" "$ACTION"
if [[ "$PLATFORM" == macos ]]; then
    APP="$PROJECT_ROOT/build/apple/DerivedData/Build/Products/Debug/WorkFleetMac.app"
    [[ "$CONFIGURATION" != Release ]] || APP="$PROJECT_ROOT/build/apple/$SCHEME.xcarchive/Products/Applications/WorkFleetMac.app"
    python3 scripts/testing/check_macos_runtime.py "$APP"
fi
