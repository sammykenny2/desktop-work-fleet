# Requirements and Version Scope

Updated: 2026-10-12. The interaction contract is [SPEC-003](specs/003-desktop-cards-groups-and-formation.md).
That specification lists U (confirmed), D (authorized working defaults) and Q (open) items; research candidates must not
be treated as approved features.

## Confirmed product direction

- Backlog and quick capture of ideas come first; one card/note/post-it records one thing.
- A group is a general logical collection; the local device can highlight "mine", and no card is required to belong to
  a Project or to Agent work.
- Windows, macOS and Linux are required desktop platforms; the store targets for our own iOS/macOS/Android apps are kept.
- The first version uses a Google account and file-based storage, with no local note server of our own; the boundary for
  heterogeneous sources and renderers is designed now.
- Read-only and click-through day to day. One group or all groups can temporarily float above ordinary apps for
  dragging; adjust mode only arranges, and cards are edited in the main window (SPEC-003, 2026-10-24).
- Single click selects a card; an ordinary drag only changes position, and only the receiving label, a Shift drag
  into a group region or an action changes a card's group.
- An explicit formation can recall and arrange cards globally or per group; a stack shows each card's first line, a spread
  lays out whole papers. Regions are not hard containers.
- Cycling only changes the stacking order temporarily; the group being operated is above the other groups and the
  selected card is frontmost within its group, without moving any card.
- Paper size normally stays stable; when needed, formation resizes papers only with consent, and without consent they
  may overflow the group region.
- At most nine groups; the grid has rows ≤3 and columns ≤4, with a product ≤9. 2 rows × 4 columns and 3 rows × 3
  columns are valid; 3 rows × 4 columns is not.
- A new card starts in its own group region without rearranging older cards; formation offers undo.
- No Focus, Pomodoro or review features; the UI, architecture or large amounts of source code of external products are
  not copied.

[ADR-006](decisions/006-card-group-and-formation-semantics.md) accepts the semantics above;
the [discussion history](research/2026-10-04-desktop-card-interaction-design.md) keeps the reasons for the corrections.
"Float above ordinary apps" and the group-transfer gestures were explicitly confirmed during that consolidation; later
agents need not ask again.

## Working defaults that can be adopted directly

The user authorized planning the other details by best practice. The D items of SPEC-003 include:
one group plus an entry for all-group operations by default for new users, rows × columns with row-major placement, a
single primary group, shared content kept apart from per-device geometry, reliable drafts, explicit group-transfer
commands, cancel and undo, group transfers that do not trigger a formation, and rescuing only unreachable cards when a
display disconnects.
They are not UI the user specified word for word, but they can be carried out according to the specification under
later implementation authorization.

## 2026-10-04 implementation scope addition

The maintainer asked for slice-by-slice implementation and verification, pushed directly to main, until the complete
1.0 is done, and explicitly approved:

- Markdown, checklists, attachments, complete and archive.
- Per-card display and layer, read-only text selection.
- Automatic and encrypted backups that include groups and per-device layout, and import / merge / replace restores.
- Windows, macOS and Linux, plus native iOS and Android apps and store submission preparation.
- Other technical, capacity and operation details are settled by best practice; every U requirement is kept, and the
  reference application is not copied.

The Q01–Q07 table in SPEC-003 records these answers and working defaults.
[ADR-008](decisions/008-portable-interaction-core.md) records the shared semantic core and transaction boundaries.
Store preparation does not equal store approval; external OAuth, formal signing and real-device acceptance each need
their own evidence.

## Status of Google and backup

The [Drive research](research/2026-10-03-google-drive-notes-mvp-feasibility.md) recommends Drive rather than Keep;
the appDataFolder provider was adopted by ADR-012, and the protocol is in SPEC-004. Native OAuth and real Google
integration still await acceptance.
[SPEC-002](specs/002-portable-backup-and-restore.md) and [ADR-013](decisions/013-complete-portable-backup.md)
define complete ZIP / JSON, groups / layout / attachments, automatic and encrypted backups and three restores, replacing
the early candidates of ADR-005.
The current status is in PROGRESS and verification procedures are in [testing](testing.md). A lossless round trip must
not be tested on the text alone, and the format modules must not be taken as a delivered complete backup flow.

## 2026-10-09 Windows support scope addition

The user confirmed that the real target of the earlier Windows compatibility discussion is this project, and asked for
the documentation handoff to be committed first.
Windows 11 21H2, 22H2, 23H2 and 24H2+ are all supported targets, tested first on the current 23H2 computer.
With no newer-version device in this round, the existing display path for newer versions is kept and regression tests
are added, without claiming zero regressions.
Windows 10 needs no product adaptation, but a future Store listing must exclude it at install time; the MSIX target
MinVersion is 22000.
The generator was changed to 22000 while keeping MaxVersionTested 26200, the final unsigned MSIX was checked, and the
isolated native probes passed on 23H2.
Normal user interaction, 23H2 MSIX installation and other Windows versions on real machines still await acceptance;
the current list is in PROGRESS.
Partner Center has no reserved app yet; the Store identity and formal submission are deferred, and this round does not
bump the version or publish.
Detailed requirements, acceptance and the order of work are in
[ADR-034](decisions/034-windows-11-compatibility-and-install-floor.md),
[SPEC-005](specs/005-windows-11-compatibility.md) and [PLAN-004](plans/004-windows-11-compatibility.md).
These requirements do not apply to another application, and its implementation and pass records are not evidence for
this project.

## 2026-10-10 uninstall and Google overwrite policy

The user confirmed that uninstalling the MSIX should clear all local data. Export a backup first, then sign in to
Google, and you can explicitly choose to clear all Work Fleet data in Google first and then restore the backup.
Updates keep the data; exported ZIPs and the Google cloud are not deleted by uninstalling. The old standalone folders of
ZIP and Debug builds are not moved or deleted automatically.
The new full overwrite does not change the history-preserving semantics of the existing import / merge / replace; it
requires a saved safety backup and an explicit confirmation of the clearing, and drafts are not published automatically.
The contract, lifecycle and resumption after failure are in
[ADR-037](decisions/037-msix-data-lifetime-and-google-backup-overwrite.md),
[SPEC-002](specs/002-portable-backup-and-restore.md) and [PLAN-005](plans/005-msix-data-and-cloud-overwrite.md).

## 2026-10-12 two-way migration between local and Google backups

The user confirmed that both kinds of workspace need backup and restore in the same or a compatible format, so that a
local workspace can move to Google, or a Google workspace can move to local for offline-only use.
A complete local restore does not force a backup of the old data first: it validates, previews and asks for explicit
confirmation, then replaces all notes, history, drafts, layout and attachments in the same transaction.
A manual Google export syncs first; on failure it saves nothing by default, and the user can explicitly choose to export
the known copy. The existing replace and the full Google overwrite keep their safety-backup requirement.
The decision and implementation contract are in [ADR-038](decisions/038-portable-local-and-cloud-backup-flows.md) and
[SPEC-002](specs/002-portable-backup-and-restore.md).

## Deferred but kept directions

The user confirmed on 2026-10-17: the app is not yet offered to others for testing, and before listing on the Windows
Store, Apple App Store and Google Play, the current note, sync and backup JSON schemas all stay at V1, with fields and
structure changed in V1 directly.
Per-version migrations, upgrade copies and compatibility maintenance for old test formats are deferred until formal
store launch is planned; basic format validation and the existing data preservation boundaries are kept.

Full PM, Project/Item/View, a self-hosted server and multiple membership remain for later research;
this does not mean the old Note container model must come back. The concrete 1.0 UI for a simple Todo / In Progress /
Done is not decided. Agent execution states such as Queued/Running/Waiting/Succeeded/Failed/Cancelled are not introduced
as a default.

## Evidence and handoff

API feasibility, native foundation tests, acceptance of new features and store approval are recorded separately.
See the [platform research](research/2026-10-04-desktop-interaction-platform-feasibility.md),
the [0.1.0 validation report](validation/2026-10-03-validation-report.md) and the
[handoff rules](handoff/2026-10-04-desktop-interaction-handoff.md).
