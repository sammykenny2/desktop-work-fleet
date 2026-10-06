#!/bin/bash
# Preserve a native Debug build as a macOS ZIP/DMG, an iOS simulator ZIP or a device iOS IPA.
# Names come from the bundle's own version, architectures and signature, never from this Mac's identities.
# The package and its .sha256 go directly in build/; build/apple/preview-PLATFORM is replaced on every run.
# Usage: package-preview-app.sh --platform macos|ios [--simulator] [--dmg]
set -euo pipefail
usage() { echo 'Usage: package-preview-app.sh --platform macos|ios [--simulator] [--dmg]'; }
PLATFORM=''; SIMULATOR=0; DMG=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help) usage; exit 0 ;;
        --platform) PLATFORM="${2:-}"; shift 2 ;;
        --simulator) SIMULATOR=1; shift ;;
        --dmg) DMG=1; shift ;;
        *) usage >&2; exit 2 ;;
    esac
done
[[ "$PLATFORM" == macos || "$PLATFORM" == ios ]] || { usage >&2; exit 2; }
[[ "$SIMULATOR" == 0 || "$PLATFORM" == ios ]] || { usage >&2; exit 2; }
[[ "$DMG" == 0 || "$PLATFORM" == macos ]] || { usage >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"; cd "$PROJECT_ROOT"
PRODUCTS="$PROJECT_ROOT/build/apple/DerivedData/Build/Products"
APP="$PRODUCTS/Debug/WorkFleetMac.app"; PLIST="$APP/Contents/Info.plist"
if [[ "$PLATFORM" == ios ]]; then
    SDK=iphoneos; [[ "$SIMULATOR" == 0 ]] || SDK=iphonesimulator
    APP="$PRODUCTS/Debug-$SDK/WorkFleetIOS.app"; PLIST="$APP/Info.plist"
fi
[[ -d "$APP" ]] || { echo 'Build the matching native Debug app first.' >&2; exit 1; }
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Unexpected bundle version: $VERSION" >&2; exit 1; }
signing() {
    local details
    details="$(codesign -dvv "$APP" 2>&1 || true)"
    if [[ "$details" == *'Authority=Apple Development:'* ]]; then echo development
    elif [[ "$details" == *'not signed at all'* || "$details" == *'Signature=adhoc'* ]]; then echo unsigned
    else echo 'Preview packages accept only unsigned or Apple Development builds.' >&2; return 1; fi
}
if [[ "$PLATFORM" == macos ]]; then
    EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$PLIST")"
    ARCHITECTURES=" $(lipo -archs "$APP/Contents/MacOS/$EXECUTABLE") "
    [[ "$ARCHITECTURES" == *' arm64 '* && "$ARCHITECTURES" == *' x86_64 '* ]] || {
        echo "macOS previews must be universal; found:$ARCHITECTURES. Rebuild with scripts/macos/build-native-app.sh." >&2; exit 1; }
    NAME="WorkFleet-$VERSION-macos-universal-$(signing)"
elif [[ "$SIMULATOR" == 0 ]]; then
    NAME="WorkFleet-$VERSION-ios-$(signing)"
else
    NAME="WorkFleet-$VERSION-ios-simulator"
fi
OUTPUT="$PROJECT_ROOT/build/apple/preview-$PLATFORM"
rm -rf -- "$OUTPUT"; mkdir -p "$OUTPUT"
DEVELOPER_PATH="$(node scripts/toolchain-env.mjs | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; process.stdout.write(JSON.parse(s).DEVELOPER_DIR);')"
[[ -z "$DEVELOPER_PATH" ]] || export DEVELOPER_DIR="$DEVELOPER_PATH"
xcodebuild -version > "$OUTPUT/toolchain.txt"
printf 'Native Debug preview %s. Requires suitable signing/provisioning for protected storage and device installation.\n' "$NAME" > "$OUTPUT/README.txt"
if [[ "$PLATFORM" == ios && "$SIMULATOR" == 0 ]]; then
    PACKAGE="$NAME.ipa"
    mkdir "$OUTPUT/Payload"; ditto "$APP" "$OUTPUT/Payload/WorkFleetIOS.app"
    (cd "$OUTPUT"; ditto -c -k --keepParent Payload "$PACKAGE")
elif [[ "$DMG" == 1 ]]; then
    PACKAGE="$NAME.dmg"
    mkdir "$OUTPUT/disk-image"; ditto "$APP" "$OUTPUT/disk-image/Work Fleet.app"; ln -s /Applications "$OUTPUT/disk-image/Applications"
    cp "$OUTPUT/README.txt" "$OUTPUT/disk-image/"
    hdiutil create -volname 'Work Fleet' -srcfolder "$OUTPUT/disk-image" -format UDZO "$OUTPUT/$PACKAGE"
    rm -rf -- "$OUTPUT/disk-image"
else
    PACKAGE="$NAME.zip"
    ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUTPUT/$PACKAGE"
fi
(cd "$OUTPUT"; shasum -a 256 "$PACKAGE" > "$PACKAGE.sha256")
mv -f "$OUTPUT/$PACKAGE" "$OUTPUT/$PACKAGE.sha256" "$PROJECT_ROOT/build/"
echo "Preview package: build/$PACKAGE"
echo "Build notes: $OUTPUT"
