#!/bin/bash
# Export an existing native archive; optionally package/notarize the macOS app.
# Names come from the archive's version; macOS requires a universal binary. Release files and their
# .sha256 go directly in build/; build/apple/export-PLATFORM is replaced on every run.
# A notarized Developer ID macOS export also writes the Sparkle update archive (the stapled app as a ZIP), its appcast.xml and
# work-fleet-update.json for the macos-vVERSION release (ADR-044). sign_update reads the EdDSA private key from the login
# keychain, or from the file in SPARKLE_PRIVATE_KEY_FILE.
# Usage: scripts/macos/package-native-app.sh --platform ios|macos --method METHOD [--archive PATH] [--application-identity NAME] [--provisioning-profile UUID] [--installer-identity NAME] [--notary-profile NAME] [--dmg] [--no-pkg] [--update-summary TEXT]
set -euo pipefail
usage() { echo 'Usage: scripts/macos/package-native-app.sh --platform ios|macos --method app-store-connect|developer-id|debugging|release-testing [--archive PATH] [--application-identity NAME] [--provisioning-profile UUID] [--installer-identity NAME] [--notary-profile NAME] [--dmg] [--no-pkg] [--update-summary TEXT]'; }
PLATFORM=''; METHOD=''; ARCHIVE=''; APPLICATION=''; PROFILE=''; INSTALLER=''; NOTARY=''; DMG=0; PKG=1; SUMMARY=''
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help) usage; exit 0 ;;
        --platform) PLATFORM="${2:-}"; shift 2 ;;
        --method) METHOD="${2:-}"; shift 2 ;;
        --archive) ARCHIVE="${2:-}"; shift 2 ;;
        --application-identity) APPLICATION="${2:-}"; shift 2 ;;
        --provisioning-profile) PROFILE="${2:-}"; shift 2 ;;
        --installer-identity) INSTALLER="${2:-}"; shift 2 ;;
        --notary-profile) NOTARY="${2:-}"; shift 2 ;;
        --dmg) DMG=1; shift ;;
        --no-pkg) PKG=0; shift ;;
        --update-summary) SUMMARY="${2:-}"; shift 2 ;;
        *) usage >&2; exit 2 ;;
    esac
done
[[ "$PLATFORM" == ios || "$PLATFORM" == macos ]] || { usage >&2; exit 2; }
case "$METHOD" in app-store-connect|developer-id|debugging|release-testing) ;; *) usage >&2; exit 2 ;; esac
[[ "$PLATFORM" == macos || ( -z "$APPLICATION" && -z "$INSTALLER" && -z "$NOTARY" && "$DMG" == 0 && "$METHOD" != developer-id ) ]] || { usage >&2; exit 2; }
[[ -z "$PROFILE" || ( "$PLATFORM" == macos && "$METHOD" == developer-id && -n "$APPLICATION" ) ]] || {
    echo 'Manual export requires macOS Developer ID, --application-identity and --provisioning-profile.' >&2; exit 2; }
[[ "$PKG" == 1 || ( "$PLATFORM" == macos && "$METHOD" != app-store-connect && -z "$INSTALLER" && ( "$DMG" == 1 || -n "$NOTARY" ) ) ]] || {
    echo '--no-pkg requires macOS direct distribution with --dmg or --notary-profile, without --installer-identity.' >&2; exit 2; }
[[ -z "$NOTARY" || "$METHOD" == developer-id ]] || { echo 'Notarization requires Developer ID export.' >&2; exit 2; }
[[ -z "$NOTARY" || "$PKG" == 0 || -n "$INSTALLER" ]] || { echo 'Notarized installer requires --installer-identity, or use --no-pkg.' >&2; exit 2; }
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
EXPORT_SIGNING=()
[[ -z "$PROFILE" ]] || EXPORT_SIGNING=(--application-identity "$APPLICATION" --provisioning-profile "$PROFILE")
node scripts/generate-apple-export-options.mjs --platform "$PLATFORM" --method "$METHOD" --output "$OPTIONS" "${EXPORT_SIGNING[@]}"
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
DELIVERED=(); FEED=()
NOTARY_ARGS=(--keychain-profile "$NOTARY")
[[ -z "${WORK_FLEET_SIGNING_KEYCHAIN:-}" ]] || NOTARY_ARGS+=(--keychain "$WORK_FLEET_SIGNING_KEYCHAIN")
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
        xcrun notarytool submit "$OUTPUT/app-for-notary.zip" "${NOTARY_ARGS[@]}" --wait
        xcrun stapler staple "$APP"
        xcrun stapler validate "$APP"
        codesign --verify --deep --strict "$APP"
        spctl --assess --type execute "$APP"
        # The stapled app doubles as the Sparkle update archive; Sparkle checks its EdDSA signature and Apple code signature.
        ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUTPUT/$NAME.zip"
        SIGN_UPDATE="$PROJECT_ROOT/build/apple/SourcePackages/artifacts/sparkle/Sparkle/bin/sign_update"
        [[ -x "$SIGN_UPDATE" ]] || SIGN_UPDATE="$PROJECT_ROOT/build/apple/DerivedData/SourcePackages/artifacts/sparkle/Sparkle/bin/sign_update"
        [[ -x "$SIGN_UPDATE" ]] || { echo 'Sparkle sign_update was not found; archive with scripts/macos/build-native-app.sh first.' >&2; exit 1; }
        if [[ -n "${SPARKLE_PRIVATE_KEY_FILE:-}" ]]; then SIGNATURE="$("$SIGN_UPDATE" --ed-key-file "$SPARKLE_PRIVATE_KEY_FILE" "$OUTPUT/$NAME.zip")"
        else SIGNATURE="$("$SIGN_UPDATE" "$OUTPUT/$NAME.zip")"; fi
        BUILD="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleVersion' "$ARCHIVE/Info.plist")"
        REPOSITORY="$(node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).update.repository);' "$APP/Contents/Resources/Config/public.json")"
        node scripts/macos/write-update-feed.mjs --archive "$OUTPUT/$NAME.zip" --signature "$SIGNATURE" --version "$VERSION" --build "$BUILD" \
            --repository "$REPOSITORY" --output "$OUTPUT" --summary "$SUMMARY"
        deliver "$NAME.zip"; FEED=(appcast.xml work-fleet-update.json)
    fi
    if [[ "$PKG" == 1 ]]; then
        PACKAGE="$OUTPUT/$NAME.pkg"; SIGN=()
        [[ -z "$INSTALLER" ]] || SIGN=(--sign "$INSTALLER")
        productbuild --component "$APP" /Applications "${SIGN[@]}" "$PACKAGE"
        if [[ -n "$NOTARY" ]]; then
            xcrun notarytool submit "$PACKAGE" "${NOTARY_ARGS[@]}" --wait
            xcrun stapler staple "$PACKAGE"
            xcrun stapler validate "$PACKAGE"
        fi
        deliver "$NAME.pkg"
    fi
    if [[ "$DMG" == 1 ]]; then
        mkdir "$OUTPUT/disk-image"; ditto "$APP" "$OUTPUT/disk-image/Work Fleet.app"; ln -s /Applications "$OUTPUT/disk-image/Applications"
        IMAGE="$OUTPUT/$NAME.dmg"
        hdiutil create -volname 'Work Fleet' -srcfolder "$OUTPUT/disk-image" -format UDZO "$IMAGE"
        if [[ -n "$APPLICATION" ]]; then codesign --sign "$APPLICATION" --timestamp "$IMAGE"; fi
        if [[ -n "$NOTARY" ]]; then
            xcrun notarytool submit "$IMAGE" "${NOTARY_ARGS[@]}" --wait
            xcrun stapler staple "$IMAGE"
            xcrun stapler validate "$IMAGE"
            codesign --verify --strict "$IMAGE"
            spctl --assess --type open --context context:primary-signature "$IMAGE"
        fi
        deliver "$NAME.dmg"
    fi
fi
# Only a completely exported, signed and notarized set replaces the release files in build/.
for FILE in "${DELIVERED[@]}"; do
    mv -f "$OUTPUT/$FILE" "$OUTPUT/$FILE.sha256" "$PROJECT_ROOT/build/"
    echo "Release package: build/$FILE"
done
for FILE in "${FEED[@]}"; do mv -f "$OUTPUT/$FILE" "$PROJECT_ROOT/build/"; echo "Update feed: build/$FILE"; done
echo "Export work directory: $OUTPUT"
