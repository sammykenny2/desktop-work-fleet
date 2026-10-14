#!/bin/bash
# Package the generated Linux app with the distribution's dpkg-deb.
# The version comes from the bundle's package.json, generated from src/native/linux/VERSION.
# The temporary staging directory is removed on exit.
# Also writes work-fleet-update.json, the in-app update manifest (ADR-044) a linux-vVERSION release carries beside the DEB.
# Usage: package-deb.sh --source PATH --output PATH --app-id ID [--maintainer-email EMAIL] [--update-summary TEXT] [--release]
set -euo pipefail
usage() { echo 'Usage: package-deb.sh --source PATH --output PATH --app-id ID [--maintainer-email EMAIL] [--update-summary TEXT] [--release]'; }
BUNDLE=''; OUTPUT=''; APP_ID=''; EMAIL=''; SUMMARY=''; RELEASE=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help) usage; exit 0 ;;
        --source) BUNDLE="${2:-}"; shift 2 ;;
        --output) OUTPUT="${2:-}"; shift 2 ;;
        --app-id) APP_ID="${2:-}"; shift 2 ;;
        --maintainer-email) EMAIL="${2:-}"; shift 2 ;;
        --update-summary) SUMMARY="${2:-}"; shift 2 ;;
        --release) RELEASE=1; shift ;;
        *) usage >&2; exit 2 ;;
    esac
done
[[ -n "$BUNDLE" && -n "$OUTPUT" && "$APP_ID" =~ ^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$ ]] || { usage >&2; exit 2; }
[[ -f "$BUNDLE/Native/host.py" && -f "$BUNDLE/package.json" && -f "$BUNDLE/Desktop/$APP_ID.desktop" && -f "$BUNDLE/Icons/$APP_ID.png" ]] || { echo 'Run the Linux package generator first.' >&2; exit 1; }
VERSION_PATTERN='"version": "([0-9]+\.[0-9]+\.[0-9]+)"'
[[ "$(<"$BUNDLE/package.json")" =~ $VERSION_PATTERN ]] || { echo 'Bundle package.json has no x.y.z version.' >&2; exit 1; }
VERSION="${BASH_REMATCH[1]}"
if [[ "$RELEASE" == 1 && -z "$EMAIL" ]]; then echo 'Release requires the public maintainer email.' >&2; exit 2; fi
EMAIL="${EMAIL:-preview@example.invalid}"
[[ "$EMAIL" =~ ^[^[:space:]\<\>@]+@[^[:space:]\<\>@]+\.[^[:space:]\<\>@]+$ ]] || { echo 'Invalid maintainer email.' >&2; exit 2; }
command -v dpkg-deb >/dev/null || { echo 'dpkg-deb is required.' >&2; exit 1; }
mkdir -p "$OUTPUT"
OUTPUT="$(cd "$OUTPUT" && pwd)"; BUNDLE="$(cd "$BUNDLE" && pwd)"
STAGE="$(mktemp -d "$OUTPUT/deb-stage-XXXXXXXX")"
trap 'rm -rf -- "$STAGE"' EXIT
mkdir -p "$STAGE/DEBIAN" "$STAGE/usr/lib/work-fleet" "$STAGE/usr/bin" "$STAGE/usr/share/applications" "$STAGE/usr/share/icons/hicolor/256x256/apps" "$STAGE/usr/share/doc/work-fleet"
cp -R "$BUNDLE/." "$STAGE/usr/lib/work-fleet/"
cp "$BUNDLE/Desktop/$APP_ID.desktop" "$STAGE/usr/share/applications/"
cp "$BUNDLE/Icons/$APP_ID.png" "$STAGE/usr/share/icons/hicolor/256x256/apps/"
cp "$BUNDLE/Licenses/LICENSE" "$STAGE/usr/share/doc/work-fleet/copyright"
cp "$BUNDLE/Licenses/THIRD-PARTY-NOTICES.md" "$STAGE/usr/share/doc/work-fleet/"
cat > "$STAGE/usr/bin/work-fleet" <<'LAUNCHER'
#!/bin/bash
exec /usr/lib/work-fleet/run-work-fleet.sh "$@"
LAUNCHER
find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +
chmod 755 "$STAGE/usr/bin/work-fleet" "$STAGE/usr/lib/work-fleet/run-work-fleet.sh"
cat > "$STAGE/DEBIAN/control" <<CONTROL
Package: work-fleet
Version: $VERSION
Architecture: all
Maintainer: Work Fleet maintainers <$EMAIL>
Section: utils
Priority: optional
Depends: bash, python3 (>= 3.10), python3-gi, python3-gi-cairo, python3-cairo, python3-cryptography, gir1.2-gtk-3.0, gir1.2-webkit2-4.1
Recommends: gir1.2-secret-1, gir1.2-gtklayershell-0.1, gir1.2-keybinder-3.0, gir1.2-ayatanaappindicator3-0.1, xdg-desktop-portal, libglib2.0-bin
Description: Work notes with local encrypted storage and optional Google sync
 Native GTK host with bundled editor assets and user-selected backups.
CONTROL
PACKAGE="$OUTPUT/work-fleet_${VERSION}_all.deb"
dpkg-deb --build --root-owner-group "$STAGE" "$PACKAGE"
(cd "$OUTPUT" && sha256sum "${PACKAGE##*/}" > "$PACKAGE.sha256")
python3 - "$PACKAGE" "$VERSION" "$SUMMARY" "$OUTPUT/work-fleet-update.json" <<'MANIFEST'
import hashlib, json, os, sys
package, version, summary, target = sys.argv[1:]
if len(summary) > 500:
    sys.exit('The update summary must be at most 500 characters.')
digest = hashlib.sha256(open(package, 'rb').read()).hexdigest()
value = {'schemaVersion': 1, 'platform': 'linux', 'version': version, 'tag': 'linux-v' + version, 'summary': summary,
         'assets': [{'arch': 'all', 'name': os.path.basename(package), 'size': os.path.getsize(package), 'sha256': digest}]}
open(target, 'w', encoding='utf-8').write(json.dumps(value, ensure_ascii=False, indent=2) + chr(10))
MANIFEST
echo "Debian package: $PACKAGE"
echo "Update manifest: $OUTPUT/work-fleet-update.json"
