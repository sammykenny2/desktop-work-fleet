#!/bin/bash
# Export an existing native archive; optionally package/notarize the macOS app.
# Names come from the archive's version; macOS requires a universal binary. Release files and their
# .sha256 go directly in build/; build/apple/export-PLATFORM is replaced on every run.
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
OUTPUT="$PROJECT_ROOT/build/apple/export-$PLATFORM"
rm -rf -- "$OUTPUT"; mkdir -p "$OUTPUT"
OPTIONS="$OUTPUT/ExportOptions.plist"
node scripts/generate-apple-export-options.mjs --platform "$PLATFORM" --method "$METHOD" --output "$OPTIONS"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$OUTPUT/products" -exportOptionsPlist "$OPTIONS"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleShortVersionString' "$ARCHIVE/Info.plist")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Unexpected archive version: $VERSION" >&2; exit 1; }
NAME="WorkFleet-$VERSION-ios"
if [[ "$PLATFORM" == macos ]]; then
    ARCHIVED="$ARCHIVE/Products/Applications/WorkFleetMac.app"
    EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$ARCHIVED/Contents/Info.plist")"
    ARCHITECTURES=" $(lipo -archs "$ARCHIVED/Contents/MacOS/$EXECUTABLE") "
    [[ "$ARCHITECTURES" == *' arm64 '* && "$ARCHITECTURES" == *' x86_64 '* ]] || {
        echo "macOS packages must be universal; found:$ARCHITECTURES. Archive with scripts/macos/build-native-app.sh." >&2; exit 1; }
    NAME="WorkFleet-$VERSION-macos-universal"
fi
DELIVERED=()
deliver() { (cd "$OUTPUT"; shasum -a 256 "$1" > "$1.sha256"); DELIVERED+=("$1"); }
exported() {
    local found=("$OUTPUT/products"/*."$1")
    [[ ${#found[@]} == 1 && -f "${found[0]}" ]] || { echo "Expected exactly one exported .$1 file." >&2; return 1; }
    printf '%s' "${found[0]}"
}
if [[ "$PLATFORM" == ios ]]; then
    IPA="$(exported ipa)"; mv "$IPA" "$OUTPUT/$NAME-$METHOD.ipa"; deliver "$NAME-$METHOD.ipa"
elif [[ "$METHOD" == app-store-connect ]]; then
    STORE_PACKAGE="$(exported pkg)"; mv "$STORE_PACKAGE" "$OUTPUT/$NAME-$METHOD.pkg"; deliver "$NAME-$METHOD.pkg"
else
    APP="$OUTPUT/products/WorkFleetMac.app"
    [[ -d "$APP" ]] || { echo 'Exported macOS app was not found.' >&2; exit 1; }
    if [[ -n "$NOTARY" ]]; then
        ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUTPUT/app-for-notary.zip"
        xcrun notarytool submit "$OUTPUT/app-for-notary.zip" --keychain-profile "$NOTARY" --wait
        xcrun stapler staple "$APP"
    fi
    PACKAGE="$OUTPUT/$NAME.pkg"; SIGN=()
    [[ -z "$INSTALLER" ]] || SIGN=(--sign "$INSTALLER")
    productbuild --component "$APP" /Applications "${SIGN[@]}" "$PACKAGE"
    if [[ -n "$NOTARY" ]]; then
        [[ -n "$INSTALLER" ]] || { echo 'Notarized installer requires --installer-identity.' >&2; exit 1; }
        xcrun notarytool submit "$PACKAGE" --keychain-profile "$NOTARY" --wait
        xcrun stapler staple "$PACKAGE"
    fi
    deliver "$NAME.pkg"
    if [[ "$DMG" == 1 ]]; then
        mkdir "$OUTPUT/disk-image"; ditto "$APP" "$OUTPUT/disk-image/Work Fleet.app"; ln -s /Applications "$OUTPUT/disk-image/Applications"
        IMAGE="$OUTPUT/$NAME.dmg"
        hdiutil create -volname 'Work Fleet' -srcfolder "$OUTPUT/disk-image" -format UDZO "$IMAGE"
        if [[ -n "$APPLICATION" ]]; then codesign --sign "$APPLICATION" --timestamp "$IMAGE"; fi
        if [[ -n "$NOTARY" ]]; then xcrun notarytool submit "$IMAGE" --keychain-profile "$NOTARY" --wait; xcrun stapler staple "$IMAGE"; fi
        deliver "$NAME.dmg"
    fi
fi
# Only a completely exported, signed and notarized set replaces the release files in build/.
for FILE in "${DELIVERED[@]}"; do
    mv -f "$OUTPUT/$FILE" "$OUTPUT/$FILE.sha256" "$PROJECT_ROOT/build/"
    echo "Release package: build/$FILE"
done
echo "Export work directory: $OUTPUT"
