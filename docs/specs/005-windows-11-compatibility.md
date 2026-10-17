# SPEC-005: Windows 11 new and classic desktop compatibility

## Metadata

| Field | Value |
|---|---|
| Status | Approved. Current status is in [PROGRESS](../../PROGRESS.md); implementation history and acceptance evidence are in the git history and [testing](../testing.md) |
| Owner | Project maintainer |
| Reviewer | The user confirmed the support scope; an independent technical review is not yet scheduled |
| Date | 2026-10-09 |
| Related Plan | [PLAN-004](../plans/004-windows-11-compatibility.md) |

## Summary

Make the same Windows app usable on Windows 11 23H2 and earlier versions while keeping the 24H2+ features.
The desktop is handled according to the actual Explorer structure and capabilities, and early Windows 11 is not
excluded by the package's minimum version.
Windows 10 needs no adaptation, but the future Store listing must refuse to install on it. Current status is in
[PROGRESS](../../PROGRESS.md); history and verification evidence are in the git history and [testing](../testing.md).

## Goals

- Test on the 23H2 machine the user provided: the Desktop, Wallpaper and Top layers, group/All operation, and restoring
  on exit.
- Keep the newer Explorer path and the existing renderer and save behaviour; reduce regressions with suitable
  regression tests.
- Change the MSIX install floor to the Windows 11 baseline and verify the actual manifest of the final package.
- Clearly distinguish target support, native testing, model tests, preview installs and Store submission.

## Non-Goals

- Windows 10 product feature adaptation or a full test matrix.
- In this batch: reserving the Partner Center name, applying for accounts or certificates, submitting to the Store or
  publishing a preview release.
- Replacing WPF/WebView2, porting other products, or changing sync, backup or data formats and non-Windows behaviour.

## Requirements

### Functional Requirements

| ID | Requirement |
|---|---|
| W11-F01 | Windows 11 21H2/22H2/23H2 and 24H2+ are support targets; the minimum version must not be raised to 24H2 just to exclude Windows 10 |
| W11-F02 | Discover the real icon host from the actual Explorer topology, and the WorkerW after it as a sibling or the child WorkerW below the icons inside it; the same-PID, stacking-order and validity constraints still hold |
| W11-F03 | The three resident layers and the temporary floating of a given group or All follow SPEC-003; exit restores according to the current group settings, and compatibility handling does not rewrite positions, sizes or preferences |
| W11-F04 | Icon stacking, click-through on the empty desktop, paper input and read-only text selection, and Wallpaper click-through follow the existing policy; another product's defaults must not be copied |
| W11-F05 | Keep the windowed WebView2 attached display, the Start order of visible creation and empty region, 3-logical-pixel rounded paper corners, the floating composition, and the behaviour of not stealing focus |
| W11-F06 | After attaching, check the real parent, WS_CHILD, non-topmost, physical bounds and DPI; a failure must not pass for success, and an arbitrary WorkerW must not be chosen as the wallpaper |
| W11-F07 | Explorer rebuilds, display changes and wake recover per ADR-020/030; a healthy state is not reattached repeatedly on a timer; the draft save barrier and the single Workspace are kept |
| W11-F08 | The MSIX TargetDeviceFamily is Windows.Desktop with MinVersion target 10.0.22000.0; keep the current MaxVersionTested of 26200; the final artifact is verified to match the source |
| W11-F09 | Windows 10 should be excluded by MSIX version applicability; before listing, the Store's acquisition and install entry is verified separately and not replaced by an error at start |
| W11-F10 | Support and evidence are separate: another project's Rust/Svelte/native test results, pure topology tests or WebView offscreen screenshots do not replace this project's real-machine display and input |

### Non-Functional Requirements

- Keep data transactions, drafts, Google, attachments and backups. Before testing with normal data, back up and close
  existing instances; Debug and the installed build share the data directory.
- Test probes use synthetic data; do not automatically restart Explorer, change the wallpaper or the registry, install
  certificates or remove the app.
- Without devices running newer versions, keep the existing baseline, add old/new topology and failure/recovery
  regression tests, and disclose the untested scope item by item.

## Acceptance

| Case | Required evidence |
|---|---|
| W11-C01 Install eligibility | Assertion of the final MSIX's Windows.Desktop/22000 floor; actual install and start on 23H2; Windows 10 install rejection checked later when a device is available |
| W11-C02 New and classic hosts | Regression tests for the classic sibling and the Progman child, and for wrong PID / icon host / no host decisions; the parent and stacking order on a real 23H2 Explorer |
| W11-C03 First presentation at start | A direct start draws desktop and wallpaper notes correctly without switching layers first; real screen pixels and a visual check for black blocks and corners |
| W11-C04 Operation and input | Group/All → floating → exit; selecting, dragging, editing and read-only selection; click-through on the empty desktop and the wallpaper; desktop icons still work |
| W11-C05 Coordinates and regions | Repeated layer switches do not drift or change size; after resize or DPI changes, regions align with the actual papers; mixed DPI needs real multiple displays |
| W11-C06 System life cycle | Win+D with the user's cooperation, Explorer restart, sleep/wake and display changes; content and drafts protected, host rediscovered |
| W11-C07 Newer-version protection | Existing native probes and shared behaviour regressions; 24H2/25H2+ real machines are checked later by someone with the devices; missing devices must not be marked as passed |
| W11-C08 Store | At listing time, confirm the formal identity, Windows 10 acquisition and install rejection, and the support text; not started in this batch |

The table below keeps the baseline from before the work started. Later native and package-content results from the
same day are in the git history and [testing](../testing.md); current status is in [PROGRESS](../../PROGRESS.md).

| Version | Support target | Evidence before this batch (historical) |
|---|---|---|
| 21H2/22000, 22H2/22621 | Yes | No device this round; untested |
| 23H2/22631 | Yes; test first | Read-only host inventory on the local 22631.6199 at 144 DPI; this project's native probes not yet run |
| 24H2/26100 | Yes | No device or test this round |
| 25H2/26200 and later | Yes | Historical native evidence on 26200 is in the git history; no real-machine regression after this batch's changes, and newer versions are untested |
| Windows 10 | No | Future MSIX/Store install rejection; product features are not accepted |

## Dependencies and Open Questions

Depends on the existing packaging and scenes of ADR-028/030, .NET 8/Evergreen WebView2, and an available Windows
desktop session.
The user has settled the support scope; there is no need to ask again whether 23H2 or Windows 10 feature adaptation is
wanted.
The external conditions still pending are devices with newer versions or a full display matrix, and the later Partner
Center identity; they do not block finishing the 23H2 work first.

## References

- [ADR-034](../decisions/034-windows-11-compatibility-and-install-floor.md), [PLAN-004](../plans/004-windows-11-compatibility.md), [Handoff](../handoff/2026-10-09-windows-11-compatibility-handoff.md)
- [SPEC-003](003-desktop-cards-groups-and-formation.md), [Testing](../testing.md), [PROGRESS](../../PROGRESS.md)

*Created: 2026-10-09*
