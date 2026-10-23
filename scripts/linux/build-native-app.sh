#!/bin/bash
# Package native Linux sources/assets, optionally create a Debian package.
# DEB output: build/work-fleet_VERSION_all.deb, with VERSION from src/native/linux/VERSION.
# --update-summary TEXT goes into the DEB's work-fleet-update-linux.json for the in-app updater (ADR-044).
# Usage: scripts/linux/build-native-app.sh [--release] [--deb] [--update-summary TEXT] [--help]
set -euo pipefail
usage() { echo 'Usage: scripts/linux/build-native-app.sh [--release] [--deb] [--update-summary TEXT] [--help]'; }
RELEASE=0; DEB=0; SUMMARY=''
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help) usage; exit 0 ;;
        --release) RELEASE=1; shift ;;
        --deb) DEB=1; shift ;;
        --update-summary) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; SUMMARY="$2"; shift 2 ;;
        *) usage >&2; exit 2 ;;
    esac
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
    EXTRA=(--update-summary "$SUMMARY"); [[ "$RELEASE" == 0 ]] || EXTRA+=(--release)
    [[ -z "$EMAIL" ]] || EXTRA+=(--maintainer-email "$EMAIL")
    bash "$SCRIPT_DIR/package-deb.sh" --source "$BUNDLE" --output "$PROJECT_ROOT/build" --app-id "$APP_ID" "${EXTRA[@]}"
fi
