#!/bin/bash
# Copy package root licenses into the app before Xcode signs the bundle.
# Usage: scripts/macos/copy-native-notices.sh CHECKOUTS DESTINATION
set -euo pipefail
usage() { echo 'Usage: scripts/macos/copy-native-notices.sh CHECKOUTS DESTINATION'; }
if [[ "${1:-}" == '--help' ]]; then usage; exit 0; fi
if [[ $# -ne 2 ]]; then usage >&2; exit 2; fi
CHECKOUTS="$1"; DESTINATION="$2"
mkdir -p "$DESTINATION"
shopt -s nullglob
for package in "$CHECKOUTS"/*; do
  [[ -d "$package" ]] || continue
  name="$(basename "$package")"
  mkdir -p "$DESTINATION/$name"
  for notice in "$package"/LICENSE* "$package"/NOTICE* "$package"/COPYING*; do
    [[ -f "$notice" ]] && cp -f "$notice" "$DESTINATION/$name/"
  done
done
