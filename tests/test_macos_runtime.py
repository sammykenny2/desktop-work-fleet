"""Compile real Mach-O fixtures; check dynamic loading without product UI/data access."""

import importlib.util
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "macos_runtime", Path(__file__).resolve().parents[1] / "scripts/testing/check_macos_runtime.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("clang"), "Needs macOS Mach-O compiler and tools")
class MacOSRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="work-fleet-runtime-")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name).resolve()
        cls.library = cls.root / "Sparkle"
        source = cls.root / "sparkle.c"
        source.write_text("int sparkle_fixture(void) { return 0; }\n")
        subprocess.run(["clang", "-arch", "arm64", "-arch", "x86_64", "-dynamiclib", str(source),
                        "-Wl,-install_name,@rpath/Sparkle.framework/Versions/B/Sparkle", "-o", str(cls.library)],
                       text=True, check=True, capture_output=True)

    def app(self, name, rpaths=True, missing_arch=None, debug=False):
        app = self.root / (name + ".app")
        framework = app / "Contents/Frameworks/Sparkle.framework/Versions/B/Sparkle"
        framework.parent.mkdir(parents=True)
        shutil.copyfile(self.library, framework)
        binary = app / "Contents/MacOS/Fixture"
        binary.parent.mkdir()
        (app / "Contents/Info.plist").write_bytes(plistlib.dumps({"CFBundleExecutable": "Fixture"}))
        linked = self.library
        if debug:
            linked = binary.parent / "Fixture.debug.dylib"
            source = self.root / "debug.c"
            source.write_text("extern int sparkle_fixture(void); int fixture(void) { return sparkle_fixture(); }\n")
            subprocess.run(["clang", "-arch", "arm64", "-arch", "x86_64", "-dynamiclib", str(source),
                            str(self.library), "-Wl,-install_name,@rpath/Fixture.debug.dylib", "-o", str(linked)],
                           text=True, check=True, capture_output=True)
        slices = []
        for arch in ("arm64", "x86_64"):
            output = binary.with_suffix("." + arch)
            flags = ["-Wl,-rpath,/usr/lib/swift", "-Wl,-rpath,@executable_path/../Frameworks", "-Wl,-rpath,@executable_path"] if rpaths and arch != missing_arch else []
            function = "fixture" if debug else "sparkle_fixture"
            subprocess.run(["clang", "-arch", arch, "-x", "c", "-", "-x", "none", str(linked), *flags,
                            "-Wl,-headerpad_max_install_names", "-o", str(output)],
                           input=f"extern int {function}(void); int main(void) {{ return {function}(); }}\n",
                           text=True, check=True, capture_output=True)
            slices.append(str(output))
        subprocess.run(["lipo", "-create", *slices, "-output", str(binary)], check=True, capture_output=True)
        for slice_path in slices:
            Path(slice_path).unlink()
        return app

    def test_relocated_universal_bundle_resolves_framework_and_runs(self):
        app = self.app("original")
        moved = app.rename(self.root / "moved app with spaces.app")
        self.assertEqual(runtime.check_app(moved), 4)
        # Exercise real dyld with a console fixture, without opening Work Fleet or its storage.
        subprocess.run([str(moved / "Contents/MacOS/Fixture")], check=True, capture_output=True)

    def test_released_app_without_rpath_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "arm64: cannot resolve @rpath/Sparkle"):
            runtime.check_app(self.app("no runpath", rpaths=False))

    def test_x86_64_slice_is_checked_independently(self):
        with self.assertRaisesRegex(ValueError, "x86_64: cannot resolve @rpath/Sparkle"):
            runtime.check_app(self.app("broken intel slice", missing_arch="x86_64"))

    def test_absent_framework_is_rejected_even_with_rpath(self):
        app = self.app("no framework")
        shutil.rmtree(app / "Contents/Frameworks")
        with self.assertRaisesRegex(ValueError, "cannot resolve @rpath/Sparkle"):
            runtime.check_app(app)

    def test_debug_dylib_inherits_executable_framework_search_path(self):
        app = self.app("debug executable", debug=True)
        self.assertEqual(runtime.check_app(app), 6)
        subprocess.run([str(app / "Contents/MacOS/Fixture")], check=True, capture_output=True)

    def test_framework_missing_intel_slice_is_rejected(self):
        app = self.app("thin framework")
        framework = app / "Contents/Frameworks/Sparkle.framework/Versions/B/Sparkle"
        thin = framework.with_suffix(".thin")
        subprocess.run(["lipo", str(framework), "-thin", "arm64", "-output", str(thin)], check=True, capture_output=True)
        thin.replace(framework)
        with self.assertRaisesRegex(ValueError, "Missing x86_64 architecture"):
            runtime.check_app(app)

    def test_framework_available_only_on_build_machine_is_rejected(self):
        app = self.app("external framework")
        external = self.root / "external libraries"
        shutil.move(str(app / "Contents/Frameworks"), external)
        subprocess.run(["install_name_tool", "-rpath", "@executable_path/../Frameworks", str(external),
                        str(app / "Contents/MacOS/Fixture")], check=True, capture_output=True)
        with self.assertRaisesRegex(ValueError, "Dependency escapes app bundle"):
            runtime.check_app(app)


if __name__ == "__main__":
    unittest.main()
