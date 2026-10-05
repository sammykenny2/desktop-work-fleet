#!/bin/bash
# Export an existing native archive; optionally package/notarize the macOS app.
# Usage: scripts/macos/package-native-app.sh --platform ios|macos --method METHOD [--archive PATH] [--application-identity NAME] [--installer-identity NAME] [--notary-profile NAME] [--dmg]
set -euo pipefail
usage() { echo 'Usage: scripts/macos/package-native-app.sh --platform ios|macos --method app-store-connect|developer-id|debugging|release-testing [--archive PATH] [--application-identity NAME] [--installer-identity NAME] [--notary-profile NAME] [--dmg]'; }
PLATFORM=''; METHOD=''; ARCHIVE=''; APPLICATION=''; INSTALLER=''; NOTARY=''; DMG=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help) usage; exit 0 ;;
        --platform) PLATFORM="${2:-}"; shift 2 ;;
        --method) METHOD="${2:-}"; shift 2 ;;
        --archive) ARCHIVE="${2:-}"; shift 2 ;;
        --application-identity) APPLICATION="${2:-}"; shift 2 ;;
        --installer-identity) INSTALLER="${2:-}"; shift 2 ;;
        --notary-profile) NOTARY="${2:-}"; shift 2 ;;
        --dmg) DMG=1; shift ;;
        *) usage >&2; exit 2 ;;
    esac
done
[[ "$PLATFORM" == ios || "$PLATFORM" == macos ]] || { usage >&2; exit 2; }
case "$METHOD" in app-store-connect|developer-id|debugging|release-testing) ;; *) usage >&2; exit 2 ;; esac
[[ "$PLATFORM" == macos || ( -z "$APPLICATION" && -z "$INSTALLER" && -z "$NOTARY" && "$DMG" == 0 && "$METHOD" != developer-id ) ]] || { usage >&2; exit 2; }
[[ -z "$NOTARY" || "$METHOD" == developer-id ]] || { echo 'Notarization requires Developer ID export.' >&2; exit 2; }
[[ -z "$NOTARY" || -n "$INSTALLER" ]] || { echo 'Notarized installer requires --installer-identity.' >&2; exit 2; }
[[ -z "$INSTALLER" || "$METHOD" == developer-id ]] || { echo 'Installer signing requires Developer ID export.' >&2; exit 2; }
[[ -z "$APPLICATION" || "$METHOD" == developer-id ]] || { echo 'DMG signing requires Developer ID export.' >&2; exit 2; }
[[ -z "$NOTARY" || "$DMG" == 0 || -n "$APPLICATION" ]] || { echo 'Notarized DMG requires --application-identity.' >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"; cd "$PROJECT_ROOT"
DEVELOPER_PATH="$(node scripts/toolchain-env.mjs | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; process.stdout.write(JSON.parse(s).DEVELOPER_DIR);')"
[[ -z "$DEVELOPER_PATH" ]] || export DEVELOPER_DIR="$DEVELOPER_PATH"
SCHEME='WorkFleetMac'; [[ "$PLATFORM" == macos ]] || SCHEME='WorkFleetIOS'
[[ -n "$ARCHIVE" ]] || ARCHIVE="$PROJECT_ROOT/build/apple/$SCHEME.xcarchive"
[[ -d "$ARCHIVE" ]] || { echo 'Build the native Release archive first.' >&2; exit 1; }
OUTPUT="$(mktemp -d "$PROJECT_ROOT/build/apple/export-$PLATFORM-XXXXXXXX")"
OPTIONS="$OUTPUT/ExportOptions.plist"
node scripts/generate-apple-export-options.mjs --platform "$PLATFORM" --method "$METHOD" --output "$OPTIONS"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$OUTPUT/products" -exportOptionsPlist "$OPTIONS"
if [[ "$PLATFORM" == macos && "$METHOD" != app-store-connect ]]; then
    APP="$OUTPUT/products/WorkFleetMac.app"
    [[ -d "$APP" ]] || { echo 'Exported macOS app was not found.' >&2; exit 1; }
    if [[ -n "$NOTARY" ]]; then
        ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUTPUT/app-for-notary.zip"
        xcrun notarytool submit "$OUTPUT/app-for-notary.zip" --keychain-profile "$NOTARY" --wait
        xcrun stapler staple "$APP"
    fi
    PACKAGE="$OUTPUT/WorkFleet-0.1.0.pkg"; SIGN=()
    [[ -z "$INSTALLER" ]] || SIGN=(--sign "$INSTALLER")
    productbuild --component "$APP" /Applications "${SIGN[@]}" "$PACKAGE"
    if [[ -n "$NOTARY" ]]; then
        [[ -n "$INSTALLER" ]] || { echo 'Notarized installer requires --installer-identity.' >&2; exit 1; }
        xcrun notarytool submit "$PACKAGE" --keychain-profile "$NOTARY" --wait
        xcrun stapler staple "$PACKAGE"
    fi
    if [[ "$DMG" == 1 ]]; then
        mkdir "$OUTPUT/disk-image"; ditto "$APP" "$OUTPUT/disk-image/Work Fleet.app"; ln -s /Applications "$OUTPUT/disk-image/Applications"
        IMAGE="$OUTPUT/WorkFleet-0.1.0.dmg"
        hdiutil create -volname 'Work Fleet' -srcfolder "$OUTPUT/disk-image" -format UDZO "$IMAGE"
        if [[ -n "$APPLICATION" ]]; then codesign --sign "$APPLICATION" --timestamp "$IMAGE"; fi
        if [[ -n "$NOTARY" ]]; then xcrun notarytool submit "$IMAGE" --keychain-profile "$NOTARY" --wait; xcrun stapler staple "$IMAGE"; fi
    fi
fi
echo "Exported products: $OUTPUT/products"
echo "Packaging output: $OUTPUT"
