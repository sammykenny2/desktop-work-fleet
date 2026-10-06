#!/usr/bin/env python3
"""Create the generated Linux source/runtime archive. Usage: python scripts/package-linux.py."""
import argparse
import hashlib
from pathlib import Path
import re
import tarfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    version = (root / "src" / "native" / "linux" / "VERSION").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit("src/native/linux/VERSION must record a numeric x.y.z version.")
    source = root / "build" / "linux" / f"work-fleet-{version}"
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
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_name(target.name + ".sha256").write_text(f"{digest}  {target.name}\n", encoding="utf-8")
    print(target.relative_to(root))


if __name__ == "__main__":
    main()
