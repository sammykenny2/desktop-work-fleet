import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGER = ROOT / "scripts" / "linux" / "package-deb.sh"


@unittest.skipUnless(
    shutil.which("bash") and shutil.which("dpkg-deb"),
    "Linux packaging tests require bash and dpkg-deb",
)
class LinuxPackageTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="work-fleet-package-test-")
        self.addCleanup(temporary.cleanup)
        self.bundle = Path(temporary.name) / "source bundle"
        self.output = Path(temporary.name) / "output packages"
        self.app_id = "app.workfleet.test"
        fixtures = {
            "Native/host.py": "print('Packaging fixture')\n",
            "run-work-fleet.sh": "#!/bin/bash\nexit 0\n",
            f"Desktop/{self.app_id}.desktop": (
                "[Desktop Entry]\nType=Application\nName=Work Fleet\nExec=work-fleet\n"
            ),
            f"Icons/{self.app_id}.png": "Packaging fixture\n",
            "Licenses/LICENSE": "Test fixture license\n",
            "Licenses/THIRD-PARTY-NOTICES.md": "Test fixture notices\n",
        }
        for relative, content in fixtures.items():
            path = self.bundle / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")

    def package(self, *extra):
        return subprocess.run(
            [
                "bash", str(PACKAGER),
                "--source", str(self.bundle),
                "--output", str(self.output),
                "--app-id", self.app_id,
                *extra,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )

    def field(self, package, name):
        return subprocess.check_output(
            ["dpkg-deb", "--field", str(package), name], text=True, timeout=10
        ).strip()

    def test_product_version_for_default_and_release_packages(self):
        existing_stage = self.output / "deb-stage-existing"
        existing_stage.mkdir(parents=True)
        marker = existing_stage / "keep.txt"
        marker.write_text("existing output\n", encoding="utf-8")
        for options, email in (
            ((), "preview@example.invalid"),
            (("--release", "--maintainer-email", "maintainer@example.test"),
             "maintainer@example.test"),
        ):
            with self.subTest(options=options):
                result = self.package(*options)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                packages = list(self.output.glob("*.deb"))
                self.assertEqual([p.name for p in packages], ["work-fleet_0.1.0_all.deb"])
                self.assertEqual(self.field(packages[0], "Version"), "0.1.0")
                self.assertEqual(self.field(packages[0], "Package"), "work-fleet")
                self.assertEqual(self.field(packages[0], "Architecture"), "all")
                self.assertEqual(
                    self.field(packages[0], "Maintainer"),
                    f"Work Fleet maintainers <{email}>",
                )
                self.assertEqual(list(self.output.glob("deb-stage-*")), [existing_stage])
                self.assertEqual(marker.read_text(encoding="utf-8"), "existing output\n")

    def test_release_still_requires_maintainer_email(self):
        result = self.package("--release")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Release requires the public maintainer email.", result.stderr)
        self.assertFalse(self.output.exists())

    def test_failed_packaging_removes_its_staging_directory(self):
        (self.bundle / "Licenses" / "LICENSE").unlink()
        result = self.package()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(self.output.iterdir()), [])

    @unittest.skipUnless(
        shutil.which("node") and shutil.which("npm")
        and all((ROOT / "node_modules" / name).is_dir()
                for name in ("marked", "dompurify", "fflate")),
        "Build integration test requires Node 22+, npm and lockfile dependencies",
    )
    def test_build_entry_point_writes_deb_directly_to_build_root(self):
        checkout = self.bundle.parent / "checkout with spaces"
        for relative in (
            "package.json", "LICENSE", "THIRD-PARTY-NOTICES.md",
            "scripts/build-web.mjs", "scripts/config.mjs", "scripts/apple-icons.mjs",
            "scripts/generate-linux-package.mjs", "scripts/package-linux.py",
            "scripts/linux/build-native-app.sh", "scripts/linux/package-deb.sh",
            "src/native/bridge.js", "src/native/files.js", "src/native/capture.js",
            "src/native/shortcuts.js", "src/native/google.js",
        ):
            destination = checkout / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)
        for relative in (
            "src/app", "src/core", "src/layout", "src/interaction", "src/storage",
            "src/sources", "src/backup", "src/desktop", "src/native/linux",
        ):
            shutil.copytree(
                ROOT / relative, checkout / relative,
                ignore=shutil.ignore_patterns("__pycache__"),
            )
        (checkout / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
        build = checkout / "build"
        build.mkdir()
        marker = build / "keep.txt"
        marker.write_text("existing output\n", encoding="utf-8")
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith("WORK_FLEET_")}
        environment["npm_config_cache"] = str(checkout / "npm-cache")
        result = subprocess.run(
            ["bash", str(checkout / "scripts/linux/build-native-app.sh"), "--deb"],
            cwd=checkout.parent,
            env=environment,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        package = build / "work-fleet_0.1.0_all.deb"
        self.assertTrue(package.is_file())
        self.assertEqual(self.field(package, "Version"), "0.1.0")
        self.assertEqual(list((build / "linux").glob("*.deb")), [])
        self.assertEqual(list(build.glob("deb-stage-*")), [])
        self.assertTrue((build / "linux/work-fleet-0.1.0.tar.gz").is_file())
        self.assertEqual(marker.read_text(encoding="utf-8"), "existing output\n")


if __name__ == "__main__":
    unittest.main()
