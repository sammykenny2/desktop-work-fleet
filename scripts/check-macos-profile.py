#!/usr/bin/env python3
"""Validate a decoded Developer ID profile before installing it on a runner.

Usage: check-macos-profile.py --profile PLIST --certificate DER --team TEAM --app-id ID
Prints only the validated UUID. Decode the signed profile with security cms first.
"""
import argparse
import datetime
import hashlib
from pathlib import Path
import plistlib
import re


def validate_profile(profile, certificate, team, app_id, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    expires = profile.get("ExpirationDate")
    if not isinstance(expires, datetime.datetime) or expires.replace(tzinfo=datetime.timezone.utc) <= now:
        raise ValueError("Developer ID profile is expired or has no expiration date.")
    if team not in profile.get("TeamIdentifier", []):
        raise ValueError("Developer ID profile belongs to another Apple team.")
    if "OSX" not in profile.get("Platform", []) or profile.get("ProvisionsAllDevices") is not True:
        raise ValueError("A macOS Developer ID distribution profile is required.")
    entitlements = profile.get("Entitlements", {})
    identifier = entitlements.get("com.apple.application-identifier", entitlements.get("application-identifier"))
    if identifier != f"{team}.{app_id}":
        raise ValueError("Developer ID profile does not match the app identifier.")
    groups = entitlements.get("keychain-access-groups", [])
    if not any(group in groups for group in (f"{team}.{app_id}", f"{team}.*")):
        raise ValueError("Developer ID profile does not authorize the app's Keychain group.")
    if entitlements.get("get-task-allow") or entitlements.get("com.apple.security.get-task-allow"):
        raise ValueError("A development profile cannot be used for this release.")
    fingerprint = hashlib.sha256(certificate).digest()
    if not any(hashlib.sha256(value).digest() == fingerprint for value in profile.get("DeveloperCertificates", [])):
        raise ValueError("Developer ID profile does not include the imported signing certificate.")
    uuid = profile.get("UUID", "")
    if not re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", uuid):
        raise ValueError("Developer ID profile has an invalid UUID.")
    return uuid


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("profile", "certificate", "team", "app-id"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    try:
        profile = plistlib.loads(Path(args.profile).read_bytes())
        print(validate_profile(profile, Path(args.certificate).read_bytes(), args.team, args.app_id))
    except (ValueError, TypeError, KeyError, plistlib.InvalidFileException) as error:
        parser.exit(1, f"Invalid macOS signing profile: {error}\n")
