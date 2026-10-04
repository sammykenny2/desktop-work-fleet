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
    APP_ID="$(node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync("build/linux/work-fleet-1.0.0/package.json", "utf8")).appId);')"
    EMAIL="$(node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync("build/linux/work-fleet-1.0.0/Config/public.json", "utf8")).release.supportEmail || "");')"
    EXTRA=(); [[ "$RELEASE" == 0 ]] || EXTRA+=(--release)
    [[ -z "$EMAIL" ]] || EXTRA+=(--maintainer-email "$EMAIL")
    bash "$SCRIPT_DIR/package-deb.sh" --source "$BUNDLE" --output "$PROJECT_ROOT/build/linux" --app-id "$APP_ID" "${EXTRA[@]}"
fi
