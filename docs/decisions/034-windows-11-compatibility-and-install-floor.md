# ADR-034: Windows 11 compatibility range and MSIX install floor

## Status

Accepted (support range and implementation boundary), 2026-10-09. Native and MSIX content verification on 23H2 followed;
normal interaction, installation and real machines with other versions still await acceptance; the current status is in
`PROGRESS.md`.
Supplements ADR-028/030; replaces the earlier product scope of "24H2 and later only".

## Context

On 2026-10-08 the user asked to support Windows 11 23H2 and earlier versions while keeping 24H2 and later;
Windows 10 needs no adaptation, but a future Microsoft Store listing must exclude it at install time.
The user provided a 23H2 computer for joint testing; there is currently no 24H2+ computer to verify on, and the user wants
regressions avoided as far as possible.
No Partner Center app identity has been reserved yet, and the Store listing stage has not started.

On 2026-10-09 the user confirmed that the requirement really belongs to this project and asked to commit the ADR, SPEC and PLAN
first and hand the work to a new session.
Code and pass records from the previous round that were mistakenly applied to another Tauri project are not implementation or
acceptance evidence for this project.

This project uses WPF/WebView2 and already has MSIX/ZIP packaging and discovery paths for both new and old Explorer hosts.
At the initial document handoff, `scripts/generate-windows-manifest.mjs` set `MinVersion=10.0.26100.0`, which excluded 23H2;
a later implementation the same day changed it to 22000.
The existing native records are on build 26200, which corresponds to 25H2 and cannot be taken as a test on build 26100/24H2.

## Decision

- Windows support targets Windows 11 21H2/22H2/23H2 and 24H2+. The version is an acceptance dimension; handling of Explorer's
  private structure is not hard-switched by OS build.
- The target MSIX install floor is `Windows.Desktop MinVersion=10.0.22000.0`, which covers early Windows 11 and excludes
  Windows 10. Native verification on 23H2 comes first, then the packaging change and verification of the final package; it is
  not acceptable to change only the product description or to let Windows 10 install the app and then fail at startup.
- The existing `MaxVersionTested=10.0.26200.0` and its historical evidence are kept; without evidence from newer versions,
  compatibility behavior is not changed without reason.
  `net8.0-windows10.0.19041.0` is the compile API baseline, not the product support floor or the Store install floor; this task
  does not need to change the framework.
- ADR-030's checks continue: the same Explorer PID, the real icon and wallpaper hosts and z-order validation, a bounded host
  creation request when needed, the DPI awareness check and the physical/client coordinate conversion.
  The existing classic sibling path is verified first, and fixes are minimal and based on actual failures.
- The verified windowed WebView2 attached scenes, the floating composition scenes, the startup order with an empty region and
  the rounded paper corners are kept. Tauri's window management, fallback and input policies are not brought in, and another
  product's code or data model is not copied.
- Group operations, read-only text selection, pass-through, formation, the single Workspace and draft transactions keep
  following SPEC-003/ADR-018/020/030. When a system host fails, preferences and data are kept and handled under the existing
  capability reporting and recovery contract, without falsely reporting a successful attachment.
- Store identity reservation, official signing, submission and acceptance of the Windows 10 Store install entry are left to
  the listing stage. This task can verify the version restriction of the preview MSIX; that must not be taken as a completed
  Store listing. The existing preview identity and certificate stay separate.

## Consequences

### Positive

- 23H2 can enter the support and test scope, and the future Windows 10 install restriction has a clear packaging contract.
- Reusing this project's existing architecture and probes keeps changes to the paths verified on build 26200 small.

### Negative

- Explorer is a private structure; this round has no devices with 21H2, 22H2 or 24H2+, so cross-version completion claims are
  limited by the evidence.
- A pass on 23H2 and pure logic regression tests cannot guarantee that newer systems have no regression; follow-up checks on
  real machines are needed.

### Neutral

- The note format, sync, accounts, backups and the other platforms do not change; the compatibility work uses the existing
  native presentation path, with no automatic version bump or release.

## Alternatives Considered

- Keeping the 26100 minimum: would exclude 23H2, which the user specified, and early Windows 11; rejected.
- Only lowering the minimum and skipping native verification: proves only install eligibility, not that display and input
  work; rejected.
- Copying another project's compatibility layer: the runtime, renderer, scenes and data authority differ; rejected.
- Removing the DPI checks or falling back to an arbitrary WorkerW to make tests pass: violates ADR-030; rejected.

## References

- [SPEC-005](../specs/005-windows-11-compatibility.md), [PLAN-004](../plans/004-windows-11-compatibility.md), [Handoff entry point](../handoff/2026-10-09-windows-11-compatibility-handoff.md)
- [ADR-028](028-native-package-and-signing-entry-points.md), [ADR-030](030-windows-explorer-wallpaper-layer.md), [PROGRESS](../../PROGRESS.md)
- [Windows 11 release information](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information): build baselines of 21H2/23H2/24H2/25H2.
- [TargetDeviceFamily](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-f-targetdevicefamily): MinVersion deployment applicability and MaxVersionTested compatibility behavior.
- [SetParent](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent): WS_CHILD/WS_POPUP and cross-process DPI risks.

*Decision made: 2026-10-09*
