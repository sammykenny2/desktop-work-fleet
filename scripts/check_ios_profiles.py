#!/usr/bin/env python3
"""Validate decoded iOS development profiles for the app and share extension.

Usage: check_ios_profiles.py --app-profile PLIST --share-profile PLIST
       --certificate DER --team TEAM --app-id ID --app-group GROUP
Prints signing identifiers and device count as JSON; never prints certificates.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import plistlib
import re


def validate_profile(profile, certificate, team, bundle_id, app_group, keychain=False, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    expires = profile.get("ExpirationDate")
    if not isinstance(expires, datetime.datetime) or expires.replace(tzinfo=datetime.timezone.utc) <= now:
        raise ValueError("iOS profile is expired or has no expiration date.")
    if profile.get("TeamIdentifier") != [team] or "iOS" not in profile.get("Platform", []):
        raise ValueError("iOS profile belongs to another team or platform.")
    entitlements = profile.get("Entitlements", {})
    if entitlements.get("application-identifier") != f"{team}.{bundle_id}":
        raise ValueError("iOS profile does not match the bundle identifier.")
    if entitlements.get("com.apple.developer.team-identifier") != team:
        raise ValueError("iOS profile has a different entitlement team.")
    if entitlements.get("get-task-allow") is not True or profile.get("ProvisionsAllDevices"):
        raise ValueError("An iOS development profile for registered devices is required.")
    devices = profile.get("ProvisionedDevices")
    if not isinstance(devices, list) or not devices or any(not isinstance(value, str) or not value for value in devices):
        raise ValueError("iOS profile has no valid registered devices.")
    if app_group not in entitlements.get("com.apple.security.application-groups", []):
        raise ValueError("iOS profile does not authorize the app group.")
    if keychain and not any(value in entitlements.get("keychain-access-groups", [])
                            for value in (f"{team}.{bundle_id}", f"{team}.*")):
        raise ValueError("iOS app profile does not authorize the Keychain group.")
    if certificate not in profile.get("DeveloperCertificates", []):
        raise ValueError("iOS profile does not include the imported certificate.")
    uuid = profile.get("UUID", "")
    if not re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", uuid):
        raise ValueError("iOS profile has an invalid UUID.")
    return uuid, set(devices)


def validate_profiles(app, share, certificate, team, app_id, app_group, now=None):
    app_uuid, devices = validate_profile(app, certificate, team, app_id, app_group, True, now)
    share_uuid, share_devices = validate_profile(share, certificate, team, app_id + ".share", app_group, False, now)
    if app_uuid == share_uuid or devices != share_devices:
        raise ValueError("App and share profiles must be distinct and authorize the same devices.")
    return {"app_profile": app_uuid, "share_profile": share_uuid,
            "identity": hashlib.sha1(certificate).hexdigest().upper(), "device_count": len(devices)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("app-profile", "share-profile", "certificate", "team", "app-id", "app-group"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    try:
        app = plistlib.loads(Path(args.app_profile).read_bytes())
        share = plistlib.loads(Path(args.share_profile).read_bytes())
        print(json.dumps(validate_profiles(app, share, Path(args.certificate).read_bytes(),
                                           args.team, args.app_id, args.app_group)))
    except (ValueError, TypeError, KeyError, plistlib.InvalidFileException) as error:
        parser.exit(1, f"Invalid iOS signing profiles: {error}\n")
