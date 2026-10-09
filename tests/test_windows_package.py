import base64
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == "nt", "Windows MSIX inspection needs PowerShell and Windows trust APIs")
class WindowsPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shell = shutil.which("pwsh") or shutil.which("powershell.exe")
        if not cls.shell:
            raise unittest.SkipTest("PowerShell is required for MSIX inspection")
        sdk = Path(os.environ.get("ProgramFiles(x86)", "")) / "Windows Kits/10/bin"
        tools = sorted(sdk.glob("*/x64/makeappx.exe"))
        if not tools:
            raise unittest.SkipTest("Windows SDK required by existing signing-option guards")
        cls.makeappx = tools[-1]
        cls.version = ET.parse(ROOT / "src/native/windows/Directory.Build.props").findtext(".//Version") + ".0"

    def inspect(self, *, minimum="10.0.22000.0", tested="10.0.26200.0", family="Windows.Desktop",
                version=None, unsigned=True, extra=None):
        manifest = f"""<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap rescap">
  <Identity Name="app.workfleet.preview" Publisher="CN=Work Fleet Preview" Version="{version or self.version}" ProcessorArchitecture="x64" />
  <Properties><DisplayName>Fixture</DisplayName><PublisherDisplayName>Fixture</PublisherDisplayName><Logo>logo.png</Logo></Properties>
  <Resources><Resource Language="en-US" /></Resources>
  <Dependencies><TargetDeviceFamily Name="{family}" MinVersion="{minimum}" MaxVersionTested="{tested}" /></Dependencies>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
  <Applications><Application Id="Fixture" Executable="Fixture.exe" EntryPoint="Windows.FullTrustApplication">
    <uap:VisualElements DisplayName="Fixture" Description="Fixture" Square150x150Logo="logo.png" Square44x44Logo="logo.png" BackgroundColor="transparent" />
  </Application></Applications>
</Package>
"""
        with tempfile.TemporaryDirectory(prefix="work-fleet-package-") as directory:
            package = Path(directory) / "fixture.msix"
            source = Path(directory) / "source"
            source.mkdir()
            (source / "AppxManifest.xml").write_text(manifest, encoding="utf-8")
            (source / "Fixture.exe").write_bytes(b"synthetic fixture, never executed")
            (source / "logo.png").write_bytes(base64.b64decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO8sAAAAASUVORK5CYII="))
            for name, content in (extra or {}).items():
                target = source / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
            # Real container/block map, with deliberately variable manifest semantics for rejection tests.
            packed = subprocess.run([str(self.makeappx), "pack", "/d", str(source), "/p", str(package), "/nv"],
                                    capture_output=True, encoding="utf-8", errors="replace", timeout=60)
            self.assertEqual(packed.returncode, 0, packed.stdout + packed.stderr)
            command = [self.shell, "-NoProfile", "-NonInteractive", "-File",
                       str(ROOT / "scripts/windows/Test-WindowsPackage.ps1"), "-PackagePath", str(package)]
            if unsigned:
                command.append("-Unsigned")
            return subprocess.run(command, cwd=ROOT, capture_output=True, encoding="utf-8", errors="replace", timeout=60)

    def test_unsigned_preview_requires_explicit_inspection(self):
        result = self.inspect()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("contents only", result.stdout)
        result = self.inspect(unsigned=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("signature is not trusted and valid", result.stderr)

    def test_install_floor_rejects_excluding_23h2_and_allowing_windows_10(self):
        for minimum in ["10.0.26100.0", "10.0.19041.0"]:
            with self.subTest(minimum=minimum):
                result = self.inspect(minimum=minimum)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("MinVersion=10.0.22000.0", result.stderr)

    def test_device_family_and_tested_version_are_checked_in_archive(self):
        for settings in [{"family": "Windows.Universal"}, {"tested": "10.0.22000.0"}]:
            with self.subTest(settings=settings):
                result = self.inspect(**settings)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Expected Windows.Desktop", result.stderr)

    def test_package_version_must_match_windows_record(self):
        result = self.inspect(version="9.9.9.0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Package version differs", result.stderr)

    def test_unsigned_mode_still_rejects_environment_and_private_key_files(self):
        for name in ["Config/.env", "private.pfx"]:
            with self.subTest(name=name):
                result = self.inspect(extra={name: "synthetic fixture"})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Environment or private-key file", result.stderr)


if __name__ == "__main__":
    unittest.main()
