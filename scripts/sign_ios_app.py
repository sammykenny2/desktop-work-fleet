#!/usr/bin/env python3
"""Sign a compiled device Debug app and its share extension for registered devices.

Usage: sign_ios_app.py --app APP --app-profile MOBILEPROVISION
       --share-profile MOBILEPROVISION --certificate DER --team TEAM
       --app-id ID --app-group GROUP [--keychain PATH]
Requires the matching Apple Development identity in the local keychain.
"""
import argparse
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

from check_ios_profiles import validate_profiles


def signing_entitlements(team, bundle_id, app_group, keychain=False):
    values = {"application-identifier": f"{team}.{bundle_id}", "com.apple.developer.team-identifier": team,
              "get-task-allow": True, "com.apple.security.application-groups": [app_group]}
    if keychain:
        values["keychain-access-groups"] = [f"{team}.{bundle_id}"]
    return values


def validate_bundle(app, app_id):
    if app.is_symlink() or not app.is_dir():
        raise ValueError("A compiled iOS app directory is required.")
    share = app / "PlugIns/WorkFleetShare.appex"
    extensions = list(app.rglob("*.appex"))
    if extensions != [share] or share.is_symlink() or list(app.rglob("*.app")):
        raise ValueError("The app must contain only the expected share extension.")
    version = None
    for bundle, identifier in [(app, app_id), (share, app_id + ".share")]:
        info = plistlib.loads((bundle / "Info.plist").read_bytes())
        if info.get("CFBundleIdentifier") != identifier:
            raise ValueError("Compiled bundle identifier does not match the signing profiles.")
        executable = info.get("CFBundleExecutable", "")
        if not executable or Path(executable).name != executable or not (bundle / executable).is_file():
            raise ValueError("Compiled app or extension executable is missing.")
        recorded = (info.get("CFBundleShortVersionString"), info.get("CFBundleVersion"))
        if not all(isinstance(value, str) and value for value in recorded) or (version and version != recorded):
            raise ValueError("Compiled app and extension versions must match.")
        version = recorded
    return share


def sign_app(app, app_profile, share_profile, certificate, team, app_id, app_group, keychain=None):
    def decode(path):
        return plistlib.loads(subprocess.check_output(["security", "cms", "-D", "-i", str(path)]))

    settings = validate_profiles(decode(app_profile), decode(share_profile), certificate, team, app_id, app_group)
    share = validate_bundle(app, app_id)
    arguments = ["codesign", "--force", "--sign", settings["identity"], "--timestamp=none", "--generate-entitlement-der"]
    if keychain:
        arguments += ["--keychain", str(keychain)]
    # Sign nested code before its enclosing bundle. --deep is used for verification only.
    for library in sorted(app.rglob("*.dylib"), key=lambda path: len(path.parts), reverse=True):
        if library.is_file() and not library.is_symlink():
            subprocess.run([*arguments, str(library)], check=True)
    for framework in sorted(app.rglob("*.framework"), key=lambda path: len(path.parts), reverse=True):
        if framework.is_dir() and not framework.is_symlink():
            subprocess.run([*arguments, str(framework)], check=True)
    with tempfile.TemporaryDirectory(prefix="work-fleet-ios-entitlements-") as directory:
        for name, bundle, profile, identifier in [("share", share, share_profile, app_id + ".share"),
                                                  ("app", app, app_profile, app_id)]:
            entitlements = Path(directory) / (name + ".plist")
            entitlements.write_bytes(plistlib.dumps(signing_entitlements(team, identifier, app_group, name == "app")))
            shutil.copyfile(profile, bundle / "embedded.mobileprovision")
            subprocess.run([*arguments, "--entitlements", str(entitlements), str(bundle)], check=True)
    subprocess.run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)], check=True)
    return settings


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("app", "app-profile", "share-profile", "certificate", "team", "app-id", "app-group"):
        parser.add_argument(f"--{name}", required=True)
    parser.add_argument("--keychain")
    args = parser.parse_args()
    try:
        print(json.dumps(sign_app(Path(args.app), Path(args.app_profile), Path(args.share_profile),
                                  Path(args.certificate).read_bytes(), args.team, args.app_id, args.app_group, args.keychain)))
    except (ValueError, TypeError, KeyError, OSError, plistlib.InvalidFileException, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Cannot sign device IPA: {error}\n")
