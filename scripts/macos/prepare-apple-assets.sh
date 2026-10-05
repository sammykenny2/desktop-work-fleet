#!/usr/bin/env bash
# Prepare resources and Info.plist for the checked-in Xcode targets.
# Usage: prepare-apple-assets.sh ios|macos|share OUTPUT
set -euo pipefail
usage() { printf 'Usage: %s ios|macos|share OUTPUT\nRequires Node 22+ and npm.\n' "$0"; }
if [[ "${1:-}" == '--help' ]]; then usage; exit 0; fi
if [[ $# -ne 2 ]]; then usage >&2; exit 2; fi
case "$1" in ios|macos|share) ;; *) usage >&2; exit 2 ;; esac
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node_command="${WORK_FLEET_NODE:-node}"
command -v "$node_command" >/dev/null || { printf 'Node 22+ is required; install Node or configure WORK_FLEET_NODE in config/Local.xcconfig.\n' >&2; exit 1; }
"$node_command" "$project_root/scripts/prepare-apple-build.mjs" --platform "$1" --output "$2"
