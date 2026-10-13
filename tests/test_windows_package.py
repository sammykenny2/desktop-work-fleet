import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
STARTUP = ('\n    <Extensions><uap5:Extension Category="windows.startupTask" Executable="WorkFleet.exe" EntryPoint="Windows.FullTrustApplication">'
           '<uap5:StartupTask TaskId="WorkFleetStartup" Enabled="false" DisplayName="Work Fleet" /></uap5:Extension></Extensions>')


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
                version=None, unsigned=True, extra=None, missing_runtime=None, missing_notice=None, startup=STARTUP):
        manifest = f"""<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap uap5 rescap">
  <Identity Name="app.workfleet.preview" Publisher="CN=Work Fleet Preview" Version="{version or self.version}" ProcessorArchitecture="x64" />
  <Properties><DisplayName>Fixture</DisplayName><PublisherDisplayName>Fixture</PublisherDisplayName><Logo>logo.png</Logo></Properties>
  <Resources><Resource Language="en-US" /></Resources>
  <Dependencies><TargetDeviceFamily Name="{family}" MinVersion="{minimum}" MaxVersionTested="{tested}" /></Dependencies>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
  <Applications><Application Id="Fixture" Executable="Fixture.exe" EntryPoint="Windows.FullTrustApplication">
    <uap:VisualElements DisplayName="Fixture" Description="Fixture" Square150x150Logo="logo.png" Square44x44Logo="logo.png" BackgroundColor="transparent" />{startup}
  </Application></Applications>
</Package>
"""
        with tempfile.TemporaryDirectory(prefix="work-fleet-package-") as directory:
            package = Path(directory) / "fixture.msix"
            source = Path(directory) / "source"
            source.mkdir()
            (source / "AppxManifest.xml").write_text(manifest, encoding="utf-8")
            (source / "Fixture.exe").write_bytes(b"synthetic fixture, never executed")
            runtime_files = ["hostfxr.dll", "hostpolicy.dll", "coreclr.dll", "System.Private.CoreLib.dll",
                             "PresentationFramework.dll", "PresentationCore.dll", "WindowsBase.dll",
                             "wpfgfx_cor3.dll", "PresentationNative_cor3.dll"]
            for name in runtime_files:
                if name != missing_runtime:
                    (source / name).write_bytes(b"synthetic runtime fixture, never executed")
            (source / "WorkFleet.runtimeconfig.json").write_text(json.dumps({"runtimeOptions": {
                "tfm": "net8.0", "includedFrameworks": [
                    {"name": "Microsoft.NETCore.App", "version": "8.0.0"},
                    {"name": "Microsoft.WindowsDesktop.App", "version": "8.0.0"},
                ],
            }}), encoding="utf-8")
            (source / "WorkFleet.deps.json").write_text(json.dumps({
                "runtimeTarget": {"name": ".NETCoreApp,Version=v8.0/win-x64"},
            }), encoding="utf-8")
            for name in ["Licenses/dotnet/LICENSE.TXT", "Licenses/dotnet/THIRD-PARTY-NOTICES.TXT",
                         "Licenses/dotnet/core-runtime.nuspec", "Licenses/dotnet/desktop-runtime.nuspec",
                         "Licenses/dotnet-desktop-LICENSE.txt", "Licenses/dotnet-wpf-NOTICES.txt",
                         "Licenses/dotnet-winforms-NOTICES.txt"]:
                if name != missing_notice:
                    target = source / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("synthetic notice fixture", encoding="utf-8")
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
        self.assertIn("bundled .NET 8/WPF", result.stdout)
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

    def test_sign_in_task_is_declared_once_and_disabled(self):
        # ADR-043: the app enables the task from its own preference; the manifest never turns it on by itself.
        for startup in ["", STARTUP.replace('Enabled="false"', 'Enabled="true"'), STARTUP.replace("WorkFleetStartup", "Other"),
                        STARTUP.replace('Executable="WorkFleet.exe"', 'Executable="Other.exe"')]:
            with self.subTest(startup=startup):
                result = self.inspect(startup=startup)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("WorkFleetStartup sign-in task", result.stderr)

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

    def test_missing_bundled_runtime_files_are_rejected(self):
        for name in ["hostfxr.dll", "coreclr.dll", "PresentationFramework.dll", "wpfgfx_cor3.dll"]:
            with self.subTest(name=name):
                result = self.inspect(missing_runtime=name)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"Missing bundled .NET/WPF file: {name}", result.stderr)

    def test_shared_runtime_requirements_and_missing_desktop_framework_are_rejected(self):
        for options in [
            {"tfm": "net8.0", "framework": {"name": "Microsoft.WindowsDesktop.App", "version": "8.0.0"}},
            {"tfm": "net8.0", "frameworks": [{"name": "Microsoft.WindowsDesktop.App", "version": "8.0.0"}]},
            {"tfm": "net8.0", "includedFrameworks": [{"name": "Microsoft.NETCore.App", "version": "8.0.0"}]},
        ]:
            with self.subTest(options=options):
                result = self.inspect(extra={"WorkFleet.runtimeconfig.json": json.dumps({"runtimeOptions": options})})
                self.assertNotEqual(result.returncode, 0)
                self.assertRegex(result.stderr, "Expected self-contained|Expected bundled .NET 8")

    def test_non_x64_dependency_target_is_rejected(self):
        result = self.inspect(extra={"WorkFleet.deps.json": json.dumps({
            "runtimeTarget": {"name": ".NETCoreApp,Version=v8.0/win-arm64"},
        })})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Expected self-contained win-x64 dependency target", result.stderr)

    def test_missing_runtime_notices_are_rejected(self):
        result = self.inspect(missing_notice="Licenses/dotnet/THIRD-PARTY-NOTICES.TXT")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing bundled runtime notice", result.stderr)


if __name__ == "__main__":
    unittest.main()
