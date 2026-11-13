"""Exercise Android packaging task/output selection without downloading native tools."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SIGNING = ("WORK_FLEET_ANDROID_KEYSTORE", "WORK_FLEET_ANDROID_KEY_ALIAS",
           "WORK_FLEET_ANDROID_STORE_PASSWORD", "WORK_FLEET_ANDROID_KEY_PASSWORD")


@unittest.skipUnless(os.name != "nt" and shutil.which("bash") and shutil.which("sha256sum"), "Bash and sha256sum are required")
class AndroidBuildTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="android build ")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for folder in ("scripts/linux", "src/native/android", "tools"):
            (self.root / folder).mkdir(parents=True)
        shutil.copyfile(ROOT / "scripts/linux/build-android-app.sh", self.root / "scripts/linux/build-android-app.sh")
        node = self.root / "tools/node"
        node.write_text('''#!/usr/bin/env bash
case "$1" in
  scripts/toolchain-env.mjs) printf '{"ANDROID_HOME":"","JAVA_HOME":""}' ;;
  -e) cat > /dev/null ;;
  scripts/platform-version.mjs) printf '9.8.7' ;;
  scripts/check-config.mjs) exit 0 ;;
  *) exit 1 ;;
esac
''')
        node.chmod(0o755)
        (self.root / "src/native/android/gradlew").write_text('''#!/usr/bin/env bash
set -eu
for task in "$@"; do
  case "$task" in
    assembleDebug) output=apk/debug/WorkFleet-9.8.7-android-debug.apk ;;
    assembleRelease) output=apk/release/WorkFleet-9.8.7-android-release.apk ;;
    bundleRelease) output=bundle/release/WorkFleet-9.8.7-android-release.aab ;;
    *) continue ;;
  esac
  printf '%s' "$task" > invoked-task.txt
  if [[ "$task" != assembleDebug && "${WORK_FLEET_REQUIRE_SIGNED_ANDROID:-}" != 1 ]]; then exit 3; fi
  mkdir -p "src/native/android/app/build/outputs/${output%/*}"
  printf 'synthetic %s' "$task" > "src/native/android/app/build/outputs/$output"
done
''')

    def build(self, arguments, signing=False):
        env = {**os.environ, "PATH": str(self.root / "tools") + os.pathsep + os.environ["PATH"], "ANDROID_HOME": str(self.root / "sdk")}
        for name in (*SIGNING, "WORK_FLEET_REQUIRE_SIGNED_ANDROID"):
            env.pop(name, None)
        if signing:
            env.update({name: "synthetic signing fixture" for name in SIGNING})
        return subprocess.run(["bash", "scripts/linux/build-android-app.sh", *arguments], cwd=self.root,
                              env=env, capture_output=True, text=True)

    def test_default_debug_and_signed_release_outputs_use_different_tasks(self):
        for arguments, signing, task, name in (([], False, "assembleDebug", "android-debug.apk"),
                                               (["--signed"], True, "bundleRelease", "android-release.aab"),
                                               (["--apk", "--release", "--signed"], True, "assembleRelease", "android-release.apk")):
            with self.subTest(arguments=arguments):
                result = self.build(arguments, signing)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((self.root / "invoked-task.txt").read_text(), task)
                package = self.root / "build" / ("WorkFleet-9.8.7-" + name)
                self.assertEqual(package.read_text(), "synthetic " + task)
                self.assertEqual(Path(str(package) + ".sha256").read_text(), hashlib.sha256(package.read_bytes()).hexdigest() + "  " + package.name + "\n")

    def test_unsigned_apk_and_incomplete_signing_stop_before_gradle(self):
        for arguments in (["--apk"], ["--release", "--apk"], ["--signed", "--apk"]):
            with self.subTest(arguments=arguments):
                result = self.build(arguments)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / "invoked-task.txt").exists())


if __name__ == "__main__":
    unittest.main()
