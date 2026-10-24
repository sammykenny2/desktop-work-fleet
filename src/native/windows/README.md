# Windows native App

The build API baseline is Windows 10 build 19041+/11; building needs the .NET 10 SDK, the Evergreen WebView2 Runtime and
Node 22+.
The product support target is early Windows 11/23H2 and 24H2+, and Windows 10 is not supported; the MSIX floor is 22000,
and MaxVersionTested stays 26200. The isolated native probes passed on 23H2; the untested range of other versions and of
installation and normal interaction is in [ADR-034](../../../docs/decisions/034-windows-11-compatibility-and-install-floor.md),
the [handoff](../../../docs/handoff/2026-10-09-windows-11-compatibility-handoff.md) and [testing](../../../docs/testing.md),
and the current status in [PROGRESS](../../../PROGRESS.md).
This directory is the 1.0 native host: a .NET WPF + WebView2 main window, desktop scenes and SQLite/DPAPI storage.
Neither the main window nor a scene zooms with two fingers on a touch screen or touchpad (`IsPinchZoomEnabled` off,
2026-10-24); scenes also ignore Ctrl+wheel, while the main window keeps Ctrl+wheel zoom.
Quick move (SPEC-003, 2026-10-24) reads Ctrl from the scene's own pointer event at the press; the maintainer confirmed
on a real machine that WebView2 reports it although scenes are never activated. A Desktop-layer paper rides the Top
layer while it drags (`liftQuickMove`): the attached scene keeps the pointer and stays shown, with an empty region if
that was its only paper, until the release. Until 2026-10-24 the coordinator hid an attached scene whenever its rects
changed, which ended the move as soon as the paper moved. Now only a paper that moves or resizes inside an attached
scene hides it; a paper that leaves or arrives (a quick move or quick edit lifting it, or a new note) changes the region
instead: `scene.prepare` drops what leaves before the browser erases it, Explorer is asked to draw the uncovered area
again as hiding does, and `scene.applied` adds what arrives. The Windows UI probe drags with DevTools mouse input and
Ctrl, so native capture and Explorer's redraw of the uncovered area are checked only by hand.
Quick edit (SPEC-003, 2026-10-24) opens the paper in the display's Top-layer scene. On the owner's `desktop.focusEditor`,
shortly after a scene sent `card.edit`, the coordinator activates that scene's input window as adjust mode does and
remembers the window that had the foreground; when the frame no longer shows the editor there and the scene still has
the foreground, it gives the foreground back. The maintainer opened and typed in one on a real machine (2026-10-24).

## Structure

- `WorkFleet.sln`: the Windows solution, the counterpart of Apple's `WorkFleet.xcodeproj` and Android's Gradle root.
- `app/`: `WorkFleet.Windows.csproj`, the WPF main program, desktop scenes, shortcuts, tray and Google sign-in.
- `core/`: `WorkFleet.Windows.Core.csproj`, SQLite/DPAPI, the bridge, backup files and scene transport.
- The test projects are in `tests/native/windows/core` and `tests/native/windows/ui`, under the solution's `tests` folder.

## Open

- VS Code: open the repository root and install the recommended C# Dev Kit; `.vscode/settings.json` selects this
  solution.
  F5 with "Windows: Work Fleet (Debug)" first runs `Build-WindowsApp.ps1 -Configuration Debug`, then starts
  `WorkFleet.exe`.
  "Debug + CDP 9339" also opens a loopback CDP port, see [ADR-032](../../../docs/decisions/032-windows-debug-webview-inspection.md).
- Visual Studio 2022: open `WorkFleet.sln`. Before building directly, run `npm run build` in the root, otherwise the
  packaged assets are missing.

The ZIP and the unpackaged Debug build use `%LOCALAPPDATA%\WorkFleet`; the MSIX uses the package's private
`%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalCache\Local\WorkFleet`.
Each data folder allows only one instance. MSIX updates keep the data; uninstalling removes the local and Google
workspaces, settings, drafts, attachments, credentials and caches,
so export a ZIP from Data and backup first. Exported files and Google cloud data are not affected.
An old standalone folder is neither moved nor deleted automatically; export with the old version/ZIP, then import into
the MSIX. The policy is in [ADR-037](../../../docs/decisions/037-msix-data-lifetime-and-google-backup-overwrite.md).

## Localization

- The Settings > General > Display language choice (`auto`, `en` or `zh-TW`) is the `language` field of
  `host-preferences.json` in the data folder above, next to the startup settings; it is never part of a profile, a
  backup or Google data. `Program.cs` applies it before any window opens, so the tray and startup dialogs of a sign-in
  start are already in that language; `auto` follows the Windows display languages.
- The host's own text (tray, dialogs, picker titles, fatal-error text and the reasons it returns for the page) is in
  `core/HostText.cs`, with an `i18n:en` and an `i18n:zh-TW` block.
- The main window answers `host.language.set`: it saves the preference, re-resolves the locale and replies with
  `{ preference, system }`. `HostText.Changed` then redraws the tray tooltip and the update text; the tray menu reads
  its labels each time it opens. The rules are in [Internationalization](../../../docs/i18n.md).

## Command line

```powershell
.\scripts\windows\Build-WindowsApp.ps1 -Configuration Debug
.\scripts\windows\Test-WindowsNative.ps1
.\scripts\windows\Build-WindowsPackage.ps1 -LocalTestSign
```

The scripts first build the shared web assets, and the NuGet dependencies are restored from the lockfile into the
Git-ignored `build/nuget-packages`.
A restore by the IDE uses the default NuGet cache, and the versions are still pinned by the lockfile.
`Build-WindowsPackage.ps1` is self-contained win-x64 by default: the MSIX/ZIP bundles the .NET 10 Desktop runtime, and
the receiving computer still needs the Evergreen WebView2.
Do not use `-SkipRestore` for a first package build; that option requires the matching win-x64 runtime packs in the
cache.
Ordinary `Build-WindowsApp.ps1`/IDE output still depends on the system .NET; `-SelfContained` is the x64 restore/build
option the packaging entry point uses.
The bundled runtime patch and its licence record are in [ADR-036](../../../docs/decisions/036-windows-self-contained-packaging.md);
updating it requires releasing the app again.
The full instructions are in [setup](../../../docs/setup-guide.md), [testing](../../../docs/testing.md) and
[deployment](../../../docs/deployment.md).
