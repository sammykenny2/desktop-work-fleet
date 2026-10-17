# 2026-10-09 Windows 11 Compatibility Handoff

## User requirements and this round's authorization

On 2026-10-08 the user asked for Windows 11 23H2 and earlier and 24H2 and later to be supported together;
Windows 10 does not matter, but once the app is in the Store it must not be installable there.
The user will test together on this 23H2 machine, has no 24H2+ device, and wants to avoid regressions on newer versions as far as possible.
Partner Center has not reserved the app yet, and the Store stage has not started.

On 2026-10-09 the user pointed out that the previous session had picked the wrong project and that this project is the real target.
This round was asked to organize the related ADR / SPEC / PLAN first, commit / push directly to main, and then continue in a new session in this project.
What is handed over is the requirement and the implementation route, not another app's implementation or passing results.
A new session on the same day received implementation authorization and continued the native / packaging work; the entry points for user interaction and install acceptance are below, the phase status is in PLAN-004, and the evidence is in the git history.

## Read first

1. The root AGENTS, your own agent file, docs/AGENT-GUIDE.
2. [PROGRESS](../../PROGRESS.md) for the current Windows status and the phase status in PLAN-004; the 2026-10-09 Windows 11 implementation record and the original requirements handoff are in the git history.
3. [ADR-034](../decisions/034-windows-11-compatibility-and-install-floor.md), [SPEC-005](../specs/005-windows-11-compatibility.md), [PLAN-004](../plans/004-windows-11-compatibility.md).
4. [ADR-030](../decisions/030-windows-explorer-wallpaper-layer.md), [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md), and the 2026-10-06 fix for black blocks at display / startup in the git history.
5. [Testing](../testing.md), [packaging](../deployment.md). Do not explore WPF again or ask again about the confirmed support scope.

## Current state

- The Windows host is .NET 8 WPF / WebView2. Attached scenes use windowed WebView2 / opaque paper regions; floating uses composition. A modern Windows manifest / PerMonitorV2 is already in place.
- `NativeShellLayers.cs` already looks for both the Progman child and the classic sibling, restricted by Explorer PID / visibility / below the icons.
- `DesktopSurface.cs` reads the real parent with GetAncestor, checks DPI awareness and converts coordinates with ScreenToClient; Start keeps the attached window with an empty region visible until WebView2 is created, avoiding black blocks.
- TaskbarCreated, display / wake and low-frequency liveness checks already exist; no additional recovery mechanism is needed first.
- The MSIX generator's minimum version is now `10.0.22000.0`, keeping MaxVersionTested 26200; the contents of the final unsigned package were checked, and installation still awaits acceptance.
- The historical native evidence is build 26200 / 25H2, one display at 144 DPI; it cannot count as passing evidence for 26100 / 24H2 or this round's 23H2.
- Read-only inventory on 2026-10-09: the local 23H2 is build 22631.6199, and the icon host Progman / DefView is at 144 DPI / PMv2.
  There is no new-style child WorkerW under Progman; the isolated native probes were completed afterwards, and the real Explorer three-layer pixels, coordinates / attachment and layer switching all passed. The other manual items are in PLAN-004 Phase 3.
- The recorded Windows version is now `0.1.2`; on 2026-10-10 the user reported no particular problem seen on 23H2 so far and explicitly agreed to bump to 0.1.2 and trigger a GitHub preview release.
  The private repo's Actions quota for this month is nearly used up; other work still prefers local checks, and later version bumps and dispatches each need their own authorization.

## Where to continue

The earlier native verification and the unsigned package contents are verified. The user later authorized creating a local preview certificate and trusting it; the existing
`Build-WindowsPackage.ps1 -LocalTestSign` produced a 0.1.1 MSIX, which the user installed and tested.
The private key stays in the local CurrentUser/My store, marked non-exportable; the local certificate is not used as the CI certificate for GitHub releases.
The user had reported topmost papers snapping back after fast drags and white ghosting at old positions; fixing them and packaging locally was authorized.
After installing the first round of fixes, the user confirmed again that the white blocks remained: a note whose position was adjusted leaves white at its old position after Stack / Spread, without any dragging.
The second round of attached-host background and region life cycle fixes is in [ADR-035](../decisions/035-windows-attached-scene-background-lifecycle.md).
The earlier background fix was packaged without testing; when testing resumed, 23H2 turned out to reject adding the NOREDIRECTIONBITMAP style, and a transparent windowed WebView
also darkened the actual paper colour, so both were reverted. Do not record the first round's hide/invalidation as a successful fix for the ghosting.
The user had asked to stop testing and taking screenshots, then later said explicitly "I'm not using the computer now; you can test or take screenshots", which lifted the restriction.
Testing now uses isolated data and our own test notes; the running installed app and its data were not touched.
Pixel checks were added for a real owner adjusting positions / Stack / Spread and for the old background; a copy of the installed app also passed the same isolated cases,
so the user's original white blocks could not be reproduced in isolated cases. On 2026-10-10 the user's own testing reported no particular problem so far; this is not extended to a root-cause verification for all scenarios.
The earlier local delivery stayed at 0.1.1; the 0.1.2 preview release authorization and the implementation / verification evidence are in the git history, and the release result is on GitHub.
When new native changes need regression, check the working tree and the existing app, then use the existing isolated entry points and keep failure evidence:

```powershell
./scripts/windows/Get-ShellLayerInventory.ps1
./scripts/windows/Test-WindowsNative.ps1
# When dependencies are already restored, use instead:
./scripts/windows/Test-WindowsNative.ps1 -SkipRestore
```

Do not run the two Test commands back to back; the second is the offline option of the same entry point.
Analyse classic host creation / selection, SetParent / DPI and WebView2 display; change only what actually fails.
Change the MSIX floor and verify the final package only after native success, and add regressions for the old and new branches and the package version.

On 2026-10-10 the data policy was decided by [ADR-037](../decisions/037-msix-data-lifetime-and-google-backup-overwrite.md):
ZIP / unpackaged Debug use `%LOCALAPPDATA%\WorkFleet`, and MSIX always uses the package-private data area; export a backup before uninstalling.
Do not delete data, uninstall or change certificate trust. The user presses Win+D manually; Explorer restart / mixed DPI are arranged separately.
Store identity and submission are deferred; 23H2 comes first, and the missing newer-version devices and independent review are recorded explicitly in PLAN-004.

## Delivery boundary

The initial c53494a contained only documents and the read-only inventory; later the same day, implementation continued with this repo's native regressions and the install floor change, and the exact done / untested status is in PLAN-004.
Whether the previous round's commits in the other project are kept is for the user to decide separately; this repo does not depend on them and does not revert / cherry-pick them.
Detailed completion status is kept in PLAN-004; this document is the entry point for continuing.
