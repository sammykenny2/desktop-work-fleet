"""Real WKWebView/native menu/desktop/SQLite path with a fake Google SDK, synthetic key and isolated app bundle."""
from pathlib import Path
import json
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "Needs macOS Swift/AppKit/WebKit SDK")
class MacOSTrayBridgeTests(unittest.TestCase):
    def test_three_desktop_menu_actions_reach_a_hidden_owner(self):
        root = Path(__file__).resolve().parents[1]
        if not shutil.which("node") or not (root / "node_modules/esbuild").is_dir():
            self.skipTest("Install the renderer dependencies first with npm ci")
        with tempfile.TemporaryDirectory(prefix="pin-it-anywhere-tray-bridge-") as temporary:
            folder = Path(temporary).resolve()
            app = folder / "TrayBridge.app/Contents"
            binary = app / "MacOS/TrayBridge"
            resources = app / "Resources"
            sdk = folder / "sdk"
            for directory in (binary.parent, resources / "Config", app / "Frameworks", sdk):
                directory.mkdir(parents=True, exist_ok=True)
            (app / "Info.plist").write_bytes(plistlib.dumps({"CFBundleExecutable": "TrayBridge", "CFBundleIdentifier":
                "dev.sammykenny2.pinitanywhere.trayprobe." + uuid.uuid4().hex, "CFBundlePackageType": "APPL", "LSUIElement": True}))
            (resources / "Config/public.json").write_text(json.dumps({"googleMacosClientId": ""}))
            # Native WKWebView uses a bundle, not the browser preview's file-based ES module graph.
            build = subprocess.run(["node", "--input-type=module", "-e",
                "import { buildWebAssets } from './scripts/build-web.mjs'; await buildWebAssets({destination:process.argv[1], configDestination:process.argv[2], bundleScripts:true});",
                str(resources / "Assets"), str(folder / "public.json")], cwd=root, text=True, capture_output=True, timeout=60)
            self.assertEqual(build.returncode, 0, build.stdout + build.stderr)
            common = ["swiftc", "-swift-version", "5", "-module-cache-path", str(folder / "module-cache")]
            sdk_result = subprocess.run(common + ["-emit-library", "-emit-module", "-module-name", "GoogleSignIn",
                "-emit-module-path", str(sdk / "GoogleSignIn.swiftmodule"), str(root / "tests/native/apple/GoogleSignInStub.swift"),
                "-Xlinker", "-install_name", "-Xlinker", "@rpath/libGoogleSignIn.dylib", "-o", str(app / "Frameworks/libGoogleSignIn.dylib")],
                text=True, capture_output=True, timeout=120)
            self.assertEqual(sdk_result.returncode, 0, sdk_result.stdout + sdk_result.stderr)
            shared = root / "src/native/apple/Shared"
            sources = [str(path) for path in sorted(shared.glob("*.swift")) if path.name != "PinItAnywhereKeychain.swift"]
            desktop = root / "src/native/apple/macos"
            sources += [str(desktop / name) for name in ("PinItAnywhereDesktop.swift", "PinItAnywhereSceneProtocol.swift",
                "PinItAnywhereSceneSurface.swift", "PinItAnywhereShortcuts.swift", "PinItAnywhereTrayMenu.swift")]
            sources.append(str(root / "tests/native/apple/TrayBridgeProbe.swift"))
            result = subprocess.run(common + ["-O", "-I", str(sdk), "-L", str(app / "Frameworks"), "-lGoogleSignIn",
                "-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks", *sources, "-o", str(binary)],
                text=True, capture_output=True, timeout=240)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            signing = subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(app.parent)], text=True, capture_output=True, timeout=30)
            self.assertEqual(signing.returncode, 0, signing.stdout + signing.stderr)
            result = subprocess.run([str(binary), str(folder / "data")], text=True, capture_output=True, timeout=120)
            if result.returncode == 77:
                self.skipTest(result.stdout.strip())
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("PASS tray bridge", result.stdout)
            self.assertIn("PASS macOS stacking", result.stdout)


if __name__ == "__main__":
    unittest.main()
