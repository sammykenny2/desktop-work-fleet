#!/bin/bash
# Package native Linux sources/assets, optionally create a Debian package.
# DEB output: build/work-fleet_VERSION_all.deb, with VERSION from src/native/linux/VERSION.
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
    BUNDLE="$PROJECT_ROOT/build/linux/work-fleet-$(node scripts/platform-version.mjs --platform linux)"
    APP_ID="$(node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).appId);' "$BUNDLE/package.json")"
    EMAIL="$(node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).release.supportEmail || "");' "$BUNDLE/Config/public.json")"
    EXTRA=(); [[ "$RELEASE" == 0 ]] || EXTRA+=(--release)
    [[ -z "$EMAIL" ]] || EXTRA+=(--maintainer-email "$EMAIL")
    bash "$SCRIPT_DIR/package-deb.sh" --source "$BUNDLE" --output "$PROJECT_ROOT/build" --app-id "$APP_ID" "${EXTRA[@]}"
fi
