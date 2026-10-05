#!/usr/bin/env python3
"""Create the generated Linux source/runtime archive. Usage: python scripts/package-linux.py."""
import argparse
from pathlib import Path
import tarfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source = root / "build" / "linux" / "work-fleet-0.1.0"
    target = source.parent / (source.name + ".tar.gz")
    if not (source / "Native" / "host.py").is_file():
        raise SystemExit("Run npm run build and node scripts/generate-linux-package.mjs first.")

    def permissions(info):
        info.uid = info.gid = 0
        info.uname = info.gname = "root"
        info.mode = 0o755 if info.isdir() or info.name.endswith(".sh") else 0o644
        return info

    with tarfile.open(target, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        archive.add(source, arcname=source.name, filter=permissions)
    print(target.relative_to(root))


if __name__ == "__main__":
    main()
