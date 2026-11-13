#!/usr/bin/env python3
"""Inspect a delivery APK using Android SDK tools. Run with --help for usage."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile


ANDROID = "{http://schemas.android.com/apk/res/android}"


def inspect_apk(apk, app_id, version, sha1, apksigner, apkanalyzer):
    """Reject unsigned, debug, test-only, wrong-identity and wrong-signer packages."""
    expected = sha1.replace(":", "").lower()
    if not re.fullmatch(r"[0-9a-f]{40}", expected):
        raise ValueError("Expected signer must be a SHA-1 certificate fingerprint.")
    apk = str(Path(apk).resolve(strict=True))

    def run(arguments):
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise ValueError(f"{Path(arguments[0]).name} failed to inspect the APK.")
        return result.stdout

    signature = run([str(apksigner), "verify", "--verbose", "--print-certs", apk])
    signers = re.findall(r"^Signer #\d+ certificate SHA-1 digest: ([0-9a-fA-F]{40})\s*$", signature, re.M)
    if len(signers) != 1 or signers[0].lower() != expected:
        raise ValueError("APK signer differs from the registered release fingerprint.")
    if re.search(r"^Signer #\d+ certificate DN: .*\bCN\s*=\s*Android Debug\b", signature, re.M | re.I):
        raise ValueError("Android Debug certificates cannot sign delivery APKs.")

    manifest = ET.fromstring(run([str(apkanalyzer), "manifest", "print", apk]))
    if manifest.tag != "manifest" or manifest.get("package") != app_id or manifest.get(ANDROID + "versionName") != version:
        raise ValueError("APK application ID or version differs from the release settings.")
    version_code = manifest.get(ANDROID + "versionCode", "")
    if not version_code.isdecimal() or int(version_code) <= 0:
        raise ValueError("APK versionCode must be positive.")
    applications = manifest.findall("application")
    if len(applications) != 1:
        raise ValueError("APK must contain one application manifest.")
    for flag in ("debuggable", "testOnly"):
        if applications[0].get(ANDROID + flag, "false") != "false":
            raise ValueError(f"Delivery APK must not enable {flag}.")
    with zipfile.ZipFile(apk) as archive:
        name = "assets/licenses/native/inventory.json"
        entries = [entry for entry in archive.infolist() if entry.filename == name]
        if len(entries) != 1 or entries[0].file_size > 4 * 1024 * 1024:
            raise ValueError("APK release runtime inventory is missing or invalid.")
        inventory = json.loads(archive.read(entries[0]))
    if not isinstance(inventory, dict) or inventory.get("schemaVersion") != 1 or inventory.get("platform") != "android" \
            or inventory.get("variant") != "release" or not isinstance(inventory.get("libraries"), list) or not inventory["libraries"]:
        raise ValueError("APK must contain the Release runtime inventory.")
    return {"appId": app_id, "version": version, "versionCode": int(version_code), "signerSha1": expected,
            "debuggable": False, "testOnly": False, "runtimeVariant": "release"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ("apk", "app-id", "version", "sha1", "apksigner", "apkanalyzer"):
        parser.add_argument("--" + argument, required=True)
    args = parser.parse_args()
    print(json.dumps(inspect_apk(args.apk, args.app_id, args.version, args.sha1, args.apksigner, args.apkanalyzer)))


if __name__ == "__main__":
    main()
