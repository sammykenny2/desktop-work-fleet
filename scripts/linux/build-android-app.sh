#!/usr/bin/env bash
# Build Android APK/AAB and copy it with a .sha256 into build/. Usage: build-android-app.sh [--release] [--signed] [--help]
set -euo pipefail
usage() { printf 'Usage: %s [--release] [--signed]\nRequires Node 22+, npm, JDK 17 and Android SDK 36; uses the checked-in Gradle Wrapper.\n' "$0"; }
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
sdk_settings=$(node scripts/toolchain-env.mjs)
android_sdk=$(printf '%s' "$sdk_settings" | node -e 'let v="";process.stdin.on("data",s=>v+=s).on("end",()=>process.stdout.write(JSON.parse(v).ANDROID_HOME))')
java_sdk=$(printf '%s' "$sdk_settings" | node -e 'let v="";process.stdin.on("data",s=>v+=s).on("end",()=>process.stdout.write(JSON.parse(v).JAVA_HOME))')
if [[ -n "$android_sdk" ]]; then export ANDROID_HOME="$android_sdk"; fi
if [[ -n "$java_sdk" ]]; then export JAVA_HOME="$java_sdk"; export PATH="$java_sdk/bin:$PATH"; fi
if [[ -z "${ANDROID_HOME:-}" && ! -f src/native/android/local.properties ]]; then
    printf 'Set ANDROID_HOME or open src/native/android in Android Studio to configure the SDK.\n' >&2
    exit 1
fi
if [[ "$task" == bundleRelease ]]; then node scripts/check-config.mjs --platform android; fi
version=$(node scripts/platform-version.mjs --platform android)
output="src/native/android/app/build/outputs/apk/debug/WorkFleet-$version-android-debug.apk"
if [[ "$task" == bundleRelease ]]; then output="src/native/android/app/build/outputs/bundle/release/WorkFleet-$version-android-release.aab"; fi
bash src/native/android/gradlew -p src/native/android --no-daemon --console plain "$task"
[[ -f "$output" ]] || { printf 'Expected Gradle output %s was not produced.\n' "$output" >&2; exit 1; }
package="${output##*/}"
mkdir -p build
cp -f "$output" "build/$package"
(cd build && sha256sum "$package" > "$package.sha256")
printf 'Android package: build/%s\n' "$package"
