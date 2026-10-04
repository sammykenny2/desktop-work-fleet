#!/bin/bash
# Package native Linux sources/assets, optionally create a Debian package.
# Usage: scripts/linux/build-native-app.sh [--release] [--deb] [--help]
set -euo pipefail
usage() { echo 'Usage: scripts/linux/build-native-app.sh [--release] [--deb] [--help]'; }
RELEASE=0; DEB=0
for argument in "$@"; do
    case "$argument" in --help) usage; exit 0 ;; --release) RELEASE=1 ;; --deb) DEB=1 ;; *) usage >&2; exit 2 ;; esac
done
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"
if [[ "$RELEASE" == 1 ]]; then node scripts/check-config.mjs --platform linux; fi
npm run build
node scripts/generate-linux-package.mjs
python3 scripts/package-linux.py
if [[ "$DEB" == 1 ]]; then
    BUNDLE="$PROJECT_ROOT/build/linux/work-fleet-1.0.0"
    STAGE="$PROJECT_ROOT/build/linux/deb-1.0.0"
    mkdir -p "$STAGE/DEBIAN" "$STAGE/usr/lib/work-fleet" "$STAGE/usr/bin" "$STAGE/usr/share/applications" "$STAGE/usr/share/icons/hicolor/256x256/apps"
    cp -R "$BUNDLE/." "$STAGE/usr/lib/work-fleet/"
    cp "$BUNDLE"/Desktop/*.desktop "$STAGE/usr/share/applications/"
    cp "$BUNDLE"/Icons/*.png "$STAGE/usr/share/icons/hicolor/256x256/apps/"
    chmod 755 "$STAGE/usr/lib/work-fleet/run-work-fleet.sh"
    cat > "$STAGE/usr/bin/work-fleet" <<'LAUNCHER'
#!/bin/bash
exec /usr/lib/work-fleet/run-work-fleet.sh "$@"
LAUNCHER
    chmod 755 "$STAGE/usr/bin/work-fleet"
    cat > "$STAGE/DEBIAN/control" <<'CONTROL'
Package: work-fleet
Version: 1.0.0
Architecture: all
Maintainer: Work Fleet maintainers
Section: utils
Priority: optional
Depends: python3 (>= 3.12), python3-gi, python3-gi-cairo, python3-cairo, python3-cryptography, gir1.2-gtk-3.0, gir1.2-webkit2-4.1, gir1.2-secret-1
Recommends: gir1.2-gtklayershell-0.1, gir1.2-keybinder-3.0, gir1.2-ayatanaappindicator3-0.1, xdg-desktop-portal
Description: Work notes with local encrypted storage and optional Google sync
 Native GTK host with bundled editor assets and user-selected backups.
CONTROL
    dpkg-deb --build --root-owner-group "$STAGE" "$PROJECT_ROOT/build/linux/work-fleet_1.0.0_all.deb"
fi
