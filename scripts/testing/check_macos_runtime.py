#!/usr/bin/env python3
"""Check a macOS app's bundled dynamic dependencies in both universal slices.

Usage: python3 scripts/testing/check_macos_runtime.py PATH.app [--launch]
Reads Mach-O load commands with lipo/otool; never modifies the app.
Optional --launch uses Work Fleet's exit before UI/storage to exercise dyld.
This checks library resolution, not signing, Google login or UI startup.
"""

import argparse
import os
from pathlib import Path
import plistlib
import re
import subprocess


def tool(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)


def load_commands(image, arch):
    text = tool("otool", "-arch", arch, "-l", str(image))
    rpaths, libraries = [], []
    for command in re.split(r"Load command \d+\n", text)[1:]:
        kind = re.search(r"\bcmd (LC_\w+)", command)
        if not kind:
            continue
        if kind[1] == "LC_RPATH":
            match = re.search(r"\bpath (.+) \(offset \d+\)", command)
            if match:
                rpaths.append(match[1])
        elif kind[1] in {"LC_LOAD_DYLIB", "LC_LOAD_WEAK_DYLIB", "LC_REEXPORT_DYLIB", "LC_LOAD_UPWARD_DYLIB"}:
            match = re.search(r"\bname (.+) \(offset \d+\)", command)
            if match:
                libraries.append(match[1])
    return rpaths, libraries


def system_path(path):
    # System libraries can live only in the dyld shared cache, with no on-disk file.
    return str(path).startswith(("/usr/lib/", "/System/Library/"))


def normalized(path):
    path = Path(os.path.normpath(path))
    # Preserve Apple's logical system paths, including framework symlinks into Cryptex/shared caches.
    return path if system_path(path) else path.resolve()


def check_app(app):
    app = Path(app).resolve(strict=True)
    with (app / "Contents/Info.plist").open("rb") as stream:
        executable = app / "Contents/MacOS" / plistlib.load(stream)["CFBundleExecutable"]
    executable = executable.resolve(strict=True)
    checked = set()

    def expand(value, image):
        for token, directory in (("@executable_path", executable.parent), ("@loader_path", image.parent)):
            if value == token:
                return directory
            if value.startswith(token + "/"):
                return normalized(directory / value[len(token) + 1:])
        if value.startswith("/"):
            return normalized(value)
        raise ValueError(f"Unsupported runtime path {value!r} in {image}")

    def inspect(image, arch, inherited=()):
        if (image, arch) in checked:
            return
        if not image.is_relative_to(app):
            raise ValueError(f"Dependency escapes app bundle: {image}")
        if arch not in tool("lipo", "-archs", str(image)).split():
            raise ValueError(f"Missing {arch} architecture in {image}")
        checked.add((image, arch))
        rpaths, libraries = load_commands(image, arch)
        search = tuple(expand(value, image) for value in rpaths) + inherited
        for library in libraries:
            if library.startswith("@rpath/"):
                candidates = [normalized(directory / library[len("@rpath/"):]) for directory in search]
                cached_system = bool(re.fullmatch(r"@rpath/libswift[^/]+\.dylib", library))
            else:
                candidates = [expand(library, image)]
                cached_system = True
            dependency = next((candidate for candidate in candidates if candidate.is_file()
                               or (cached_system and system_path(candidate))), None)
            if dependency is None:
                raise ValueError(f"{arch}: cannot resolve {library} from {image}; runtime search paths: {search}")
            if not system_path(dependency):
                inspect(dependency, arch, search)

    for arch in ("arm64", "x86_64"):
        inspect(executable, arch)
    return len(checked)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("--launch", action="store_true", help="Run Work Fleet's --check-runtime exit before opening UI or storage")
    args = parser.parse_args()
    try:
        count = check_app(args.app)
        if args.launch:
            with (args.app / "Contents/Info.plist").open("rb") as stream:
                binary = args.app / "Contents/MacOS" / plistlib.load(stream)["CFBundleExecutable"]
            result = subprocess.run([str(binary.resolve()), "--check-runtime"], text=True,
                                    capture_output=True, timeout=15, check=True)
            if result.stdout.strip() != "PASS Work Fleet runtime load":
                raise ValueError("Runtime launch did not return the expected confirmation")
    except (OSError, KeyError, ValueError, subprocess.SubprocessError) as error:
        if isinstance(error, subprocess.CalledProcessError):
            error = f"{error}\n{error.output or ''}{error.stderr or ''}"
        parser.exit(1, f"FAIL macOS runtime dependencies: {error}\n")
    print(f"PASS macOS runtime dependencies: {count} Mach-O slices; arm64 and x86_64")
    if args.launch:
        print("PASS native runtime launch; UI and workspace unopened")


if __name__ == "__main__":
    main()
