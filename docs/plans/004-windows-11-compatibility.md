# PLAN-004: Windows 11 Compatibility Implementation and Acceptance Handoff

## Metadata

| Field | Value |
|---|---|
| Status | In Progress: Phases 1–2 done 2026-10-09; Phase 3 partly done; Phase 4 not started |
| Owner | Project maintainer |
| Assigned To | Windows compatibility implementation session |
| Reviewer | Significant native changes get a separate independent review; none so far |
| Date | 2026-10-09 |

## Related Spec

[SPEC-005](../specs/005-windows-11-compatibility.md), [ADR-034](../decisions/034-windows-11-compatibility-and-install-floor.md).
Product interaction still follows SPEC-003. This plan describes the construction order; each phase's status is recorded in
the phase below and updated in the same commit as the work.

## Overview

The project already has WPF / WebView2 three-layer scenes, classic / modern Explorer discovery and MSIX.
First obtain the actual 23H2 failures and the existing baseline on the newer version, then make small compatibility fixes, and only then adjust the install floor and verify the package.
Do not cherry-pick changes from another Tauri project, and do not borrow its test results as evidence for this project.

## Implementation Phases

### Phase 1: 23H2 native baseline and fault isolation

- Check the local build, WebView2, DPI, existing instances and working tree; first review the earlier fixes for black blocks / initialization order and pass-through in the git history.
- Take a read-only inventory with `Get-ShellLayerInventory.ps1`. The existing inventory is 22631.6199 / 144 DPI, with DefView under Progman and no new-style child WorkerW; it does not prove that the host was created / attached successfully.
- Test core, UI, composition, platform, wallpaper and host-check with the existing isolated-data probes; keep each PASS / FAIL / SKIP and its output first.
- Compare the bounded 0x052C request in `NativeShellLayers.Discover`, the classic sibling stacking order and DPI / SetParent; lowering the MSIX floor directly does not count as native success.

Delivered: this project's 23H2 baseline, the specific failures and the minimal places to change; not another round of framework rebuilding.

**Status**: done 2026-10-09 on 23H2 build 22631.6199, one display at 144 DPI, WebView2 154.0.4258.62. The full isolated native
baseline passed with no renderer, SetParent or DPI rewrite needed.

### Phase 2: Minimal fixes and regressions for old and new structures

- Fix failures with evidence first; keep the same Explorer PID, the real parent, DPI awareness and coordinate checks.
- Extract testable host selection / liveness decisions where appropriate, covering classic sibling, Progman child, wrong PID / icon host / missing, recreation and invalid handles.
- Do not change without reason the choice of windowed attached / composition floating, the Start creation order, paper regions / input, focus and draft transactions.
- Verify W11-C02–C07; patch the existing Explorer / display watchdogs first instead of adding a parallel mechanism that reattaches every second.

Delivered: the necessary native fixes, matching regressions and evidence; newer OS versions that could not be verified stay untested.

**Status**: done 2026-10-09. Host discovery was extracted behind a test seam with classic/modern and failure regressions;
only probe fixes were needed.

### Phase 3: MSIX install floor and acceptance of the normal app

- Change the generator's MinVersion from 26100 to 22000; keep MaxVersionTested 26200 and the compile framework baseline.
- In the tests that generate the manifest / final package, check Windows.Desktop, the minimum version, the version number and the preview identity; avoid tests that check only the identity version.
- Use the existing Build-WindowsPackage / Test-WindowsPackage and do not create another packaging path; do not change certificate trust.
- Normal Debug and the installed version share data; back up the existing data and close old instances first, then test with the user the first launch, layers, Group / All, text, dragging, icons and Win+D.
- Keep installing and publishing a new version clearly apart. Without a Windows preview release instruction, do not bump the version, dispatch CI or create a tag / GitHub Release.

Delivered: 23H2 evidence for W11-C01 and C03–C06 and the package contents; the newer-version / Windows 10 deployment matrix waits for later verification if devices are missing.

**Status**: partly done. The MSIX floor is 22000 with MaxVersionTested 26200. On 2026-10-10 the user reported that 23H2
"seems fine, nothing special seen" and approved 0.1.2; this is one user's machine, not the full manual matrix.
The user acceptance list from 2026-10-09 is still open: first display and black blocks, rounded corners, Group/All floating
and exit, drag, edit and read-only selection, icon and blank/wallpaper click-through, close and reopen, Win+D.
The white blocks at old positions after stacking or spreading (reported 2026-10-09) were not reproduced in isolated cases,
including with the installed assembly; the root cause is not proven and no later report is recorded.

### Phase 4: Later Store submission gate

After Partner Center reserves the identity, configure the formal package identity / publisher, signing and support text.
Confirm that Windows 10 is rejected at the Store acquisition / install stage and that supported Windows 11 versions can acquire it normally.
There is currently no instruction to submit, so this phase does not start, and preview MSIX verification does not replace Store acceptance.

**Status**: not started; Partner Center has no reserved app.

Still open as of 2026-10-17: 21H2, 22H2, 24H2 and 25H2+ after the install-floor change; Windows 10 install rejection;
mixed DPI; a real Explorer restart; sleep/wake; virtual desktops; Win+D with the user; .NET 10 on 23H2.

## Files to Inspect or Modify

| Location | Purpose |
|---|---|
| `src/native/windows/app/NativeShellLayers.cs` | Old and new host discovery, PID / visibility / stacking order and liveness; change only if needed |
| `src/native/windows/app/DesktopSurface.cs` | Attachment, real parent, DPI, coordinates, display / region; keep the tested display path |
| `src/native/windows/app/DesktopCoordinator.cs`, `NativeDisplayWatcher.cs` | Existing host / display recovery and draft barrier |
| `tests/native/windows/ui/WallpaperProbe.cs`, `HostChildProbe.cs` | Display / input / coordinate verification on the real Explorer and a simulated host |
| `scripts/generate-windows-manifest.mjs`, `tests/release-versions.test.js` | Package minimum version and generated manifest regressions |
| `scripts/windows/Test-WindowsPackage.ps1`, `Test-WindowsNative.ps1` | Final package and native gates; extend only if needed |
| `docs/setup-guide.md`, `docs/deployment.md`, `docs/testing.md`, `PROGRESS.md` | Update the current limits and tested status after implementation |

## Testing Strategy

Run the read-only inventory first, then `scripts/windows/Test-WindowsNative.ps1` (add `-SkipRestore` when already restored).
Shared JS / Python and build commands follow [testing.md](../testing.md).
The `--wallpaper` WebView capture only proves that the page drew; if the real-screen check SKIPs because another window covers it, it does not count as a presentation pass.
When needed, the user presses Win+D manually to expose the test points; do not inject Windows system shortcuts or restart Explorer automatically.
Keep the existing historical evidence for build 26200 and record this round's 23H2 results separately; write results for old and new devices separately.

## Risks and Mitigations

| Risk | Handling |
|---|---|
| Native failures found only after widening install eligibility | Run the native probes first, then adjust the package and do install acceptance |
| No device with the newer version this round | Minimize changes, keep the existing renderer / host paths, add branch regressions and disclose what is untested |
| Cross-DPI SetParent / black block regression | Keep the awareness guard, physical bounds and the visible initialization with an empty region; verify with real pixels |
| Tests read or write normal data | Use synthetic probes first; back up before testing the normal app, keep atomic saves and the draft barrier |
| Mixing in another project's requirements / evidence | Hand over only this requirement; only this repo's records (git history, [testing](../testing.md)) count as execution evidence |

## Handoff

The initial document handoff was committed and pushed directly to main at the user's request; at that time MinVersion was 26100 and there was no native PASS from this round.
Later the same day, 23H2 native verification and verification of the final unsigned package followed, with MinVersion 22000; the phase status is recorded above, the evidence is in the git history, and the untested scope is listed above.
Next: Phase 3's normal user interaction and install acceptance with a usable signature; real machines with other Windows versions are arranged separately. At the time of this handoff there was no new preview release or Store submission.

*Created: 2026-10-09*
