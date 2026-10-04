#!/usr/bin/env bash
# Build Android APK/AAB. Usage: build-android-app.sh [--release] [--help]
set -euo pipefail
usage() { printf 'Usage: %s [--release]\nRequires Gradle 8.13, JDK 17 and Android SDK 36.\n' "$0"; }
task=assembleDebug
case "${1:-}" in --release) task=bundleRelease;; --help) usage; exit 0;; '') ;; *) usage; exit 2;; esac
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$project_root"
command -v gradle >/dev/null || { printf 'Gradle 8.13 is required.\n' >&2; exit 1; }
sdk_settings=$(node scripts/toolchain-env.mjs)
android_sdk=$(printf '%s' "$sdk_settings" | node -e 'let v="";process.stdin.on("data",s=>v+=s).on("end",()=>process.stdout.write(JSON.parse(v).ANDROID_HOME))')
java_sdk=$(printf '%s' "$sdk_settings" | node -e 'let v="";process.stdin.on("data",s=>v+=s).on("end",()=>process.stdout.write(JSON.parse(v).JAVA_HOME))')
if [[ -n "$android_sdk" ]]; then export ANDROID_HOME="$android_sdk"; fi
if [[ -n "$java_sdk" ]]; then export JAVA_HOME="$java_sdk"; export PATH="$java_sdk/bin:$PATH"; fi
: "${ANDROID_HOME:?Set ANDROID_HOME in .env or the build environment}"
npm run build
gradle -p src/native/android --no-daemon "$task"
