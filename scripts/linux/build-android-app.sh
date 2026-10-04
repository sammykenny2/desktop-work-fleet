#!/usr/bin/env bash
# Build Android APK/AAB. Usage: build-android-app.sh [--release] [--signed] [--help]
set -euo pipefail
usage() { printf 'Usage: %s [--release] [--signed]\nRequires Gradle 8.13, JDK 17 and Android SDK 36.\n' "$0"; }
task=assembleDebug
signed=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --release) task=bundleRelease; shift ;;
        --signed) task=bundleRelease; signed=1; shift ;;
        --help) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
done
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$project_root"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$project_root/build/gradle-home}"
if [[ "$signed" == 1 ]]; then
    for name in WORK_FLEET_ANDROID_KEYSTORE WORK_FLEET_ANDROID_KEY_ALIAS WORK_FLEET_ANDROID_STORE_PASSWORD WORK_FLEET_ANDROID_KEY_PASSWORD; do
        [[ -n "${!name:-}" ]] || { printf 'Signed release requires %s in the process/CI environment.\n' "$name" >&2; exit 1; }
    done
    export WORK_FLEET_REQUIRE_SIGNED_ANDROID=1
fi
command -v gradle >/dev/null || { printf 'Gradle 8.13 is required.\n' >&2; exit 1; }
sdk_settings=$(node scripts/toolchain-env.mjs)
android_sdk=$(printf '%s' "$sdk_settings" | node -e 'let v="";process.stdin.on("data",s=>v+=s).on("end",()=>process.stdout.write(JSON.parse(v).ANDROID_HOME))')
java_sdk=$(printf '%s' "$sdk_settings" | node -e 'let v="";process.stdin.on("data",s=>v+=s).on("end",()=>process.stdout.write(JSON.parse(v).JAVA_HOME))')
if [[ -n "$android_sdk" ]]; then export ANDROID_HOME="$android_sdk"; fi
if [[ -n "$java_sdk" ]]; then export JAVA_HOME="$java_sdk"; export PATH="$java_sdk/bin:$PATH"; fi
: "${ANDROID_HOME:?Set ANDROID_HOME in .env or the build environment}"
if [[ "$task" == bundleRelease ]]; then node scripts/check-config.mjs --platform android; fi
npm run build
gradle -p src/native/android --no-daemon "$task"
