#!/usr/bin/env python3
"""Build and run the signed macOS startup probe with an isolated app identity.

Usage: DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer python3
scripts/testing/apple_startup_probe.py --team TEAM_ID [--identity NAME]

Requires the native app's downloaded dependencies, a development certificate,
and an existing provisioning profile that permits the probe's app identifier
and this Mac. Never registers devices or creates signing identities.
"""

import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tempfile
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--team", required=True)
    parser.add_argument("--identity", default="Apple Development")
    args = parser.parse_args()
    if platform.system() != "Darwin" or not re.fullmatch(r"[A-Z0-9]{10}", args.team):
        parser.error("Use macOS and a valid ten-character Apple team ID.")
    root = Path(__file__).resolve().parents[2]
    packages = root / "build/apple/SourcePackages"
    if not packages.is_dir() or not (root / "node_modules").is_dir():
        parser.error("Build the native app once to download its dependencies.")
    output = Path(tempfile.mkdtemp(prefix="native-startup-", dir=root / "build/apple"))
    fixture = output / "source"
    fixture.mkdir()
    for directory in ["app", "core", "layout", "interaction", "storage", "sources", "backup", "desktop"]:
        shutil.copytree(root / "src" / directory, fixture / "src" / directory)
    shutil.copytree(root / "src/native/apple", fixture / "src/native/apple",
                    ignore=shutil.ignore_patterns(".generated", "xcuserdata", "Local.xcconfig"))
    files = ["LICENSE", "THIRD-PARTY-NOTICES.md", "package.json", "package-lock.json",
             "scripts/build-web.mjs", "scripts/config.mjs", "scripts/prepare-apple-build.mjs",
             "scripts/macos/prepare-apple-assets.sh", "scripts/macos/copy-native-notices.sh"]
    files += ["src/native/" + name + ".js" for name in ["bridge", "files", "capture", "shortcuts", "google"]]
    for relative in files:
        target = fixture / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / relative, target)
    (fixture / "node_modules").symlink_to(root / "node_modules", target_is_directory=True)
    shutil.copy2(root / "tests/native/apple/StartupProbe.swift", fixture / "src/native/apple/macos/Main.swift")
    identity = "app.workfleet.startupprobe.p" + uuid.uuid4().hex
    environment = os.environ.copy()
    environment["WORK_FLEET_APP_ID"] = identity
    derived = output / "DerivedData"
    command = ["xcodebuild", "-project", str(fixture / "src/native/apple/WorkFleet.xcodeproj"),
               "-scheme", "WorkFleetMac", "-configuration", "Debug", "-destination", "generic/platform=macOS",
               "-derivedDataPath", str(derived), "-clonedSourcePackagesDirPath", str(packages),
               "WORK_FLEET_PACKAGES_DIR=" + str(packages), "WORK_FLEET_APP_ID=" + identity,
               "DEVELOPMENT_TEAM=" + args.team, "CODE_SIGN_IDENTITY=" + args.identity,
               "CODE_SIGN_STYLE=Automatic", "ARCHS=" + platform.machine(), "ONLY_ACTIVE_ARCH=NO", "build"]
    print("Startup evidence:", output, flush=True)
    with (output / "build.log").open("w") as log:
        subprocess.run(command, cwd=fixture, env=environment, stdout=log, stderr=subprocess.STDOUT, check=True)
    app = derived / "Build/Products/Debug/WorkFleetMac.app"
    executable = app / "Contents/MacOS/WorkFleetMac"
    with (output / "signature.log").open("w") as log:
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)],
                       stdout=log, stderr=subprocess.STDOUT, check=True)
    result = None
    with (output / "result.txt").open("w") as log:
        try:
            result = subprocess.run([str(executable)], cwd=output, stdout=log,
                                    stderr=subprocess.STDOUT, timeout=75)
        finally:
            cleanup = subprocess.run([str(executable), "--cleanup"], cwd=output,
                                     stdout=log, stderr=subprocess.STDOUT, timeout=15)
        text = (output / "result.txt").read_text()
    print(text, end="")
    if result.returncode != 0 or cleanup.returncode != 0:
        raise SystemExit("FAIL signed startup or probe-owned Keychain cleanup; see the evidence directory.")
    (output / "verification.json").write_text(json.dumps({
        "bundleId": identity, "team": args.team,
        "keychainAndSqlite": "passed", "nativeRendererStartup": "passed", "keychainCleanup": "passed",
        "architecture": platform.machine(), "userWorkspaceAccessed": False,
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
