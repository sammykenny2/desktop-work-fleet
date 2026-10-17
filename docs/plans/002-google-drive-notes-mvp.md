# PLAN-002: Google Drive Notes 1.0.0 with Portable Backup

> 2026-10-04: full implementation of 1.0 on all five platforms is authorized; SPEC-003 Q01–Q07 are answered.
> The sync format follows SPEC-004 / ADR-011, and the FileStore / Drive provider follows ADR-012.
> Backups must include checklists, attachments, layout, automatic and encrypted backups, and three restore modes.

## Metadata

| Field | Value |
|---|---|
| Status | In Progress under the full 1.0 authorization; the 1.0 slice status is in [PLAN-003](003-desktop-interaction-implementation.md) |
| Owner | Project maintainer |
| Assigned To | Unassigned |
| Reviewer | Independent review pending |
| Date | 2026-10-03 |

## Related Spec

[SPEC-002: Portable backup and safe restore](../specs/002-portable-backup-and-restore.md).
Plain notes, Google sign-in and renderer scope follow the [MVP research](../research/2026-10-03-google-drive-notes-mvp-feasibility.md)
and [ADR-004](../decisions/004-google-drive-notes-mvp.md); the source transport decision follows
[ADR-012](../decisions/012-durable-file-store-and-drive-adapter.md).
This plan lists the work order and acceptance conditions and keeps no separate completion checklist.
The 1.0 slice status is in [PLAN-003](003-desktop-interaction-implementation.md); the current project status is in
[PROGRESS](../../PROGRESS.md).

## Overview

The 1.0 daily flow: sign in to Google → quickly add / edit notes → locked presentation on supported desktops →
sync on another device → export or import a backup when needed.
The latest product must include the card / group / formation / drag-and-drop semantics of
[SPEC-003](../specs/003-desktop-cards-groups-and-formation.md); interaction development follows
[PLAN-003](003-desktop-interaction-implementation.md).
The editor, checklists, attachments and complete / archive are approved; the earlier plain-text and no-checklist cuts do not apply.

appDataFolder + drive.appdata is adopted; backups are saved to a local / OS document location the user chooses.
The first version does not request drive.file or full Drive scope for backups and adds no note server of its own.
This does not provide a Keep / Drive app editor automatically; phone editing requires delivering this app's phone entry.
Only one active source / account is planned; no multi-provider aggregation or cross-account sharing.

Development integration starts from the existing AppKit host to reuse the work already done on public APIs / Sandbox;
this is the construction order and **does not mean a Mac-only release has been decided**.
The macOS / iOS / Android store, Windows Store candidate and Linux testable scope remain;
Windows/macOS/Linux and native iOS / Android apps are all part of this 1.0, including store submission preparation.

## Implementation Phases

### Phase 1: Freeze contracts and choose a deliverable implementation boundary

Deliverables:

- A list of release platforms and minimum OS versions, mapped to three capabilities: normal editor, desktop presentation, file backup.
- Minimal public contracts for Card / Group, SourceRef, NoteSource / FileStore, CardViewModel, DeviceLayout / InteractionState,
  LocalStore and BackupService / RestoreJob.
- Executable sync rules for the append-only revision file approach:
  noteId, revisionId, operationId, parents, deleted, full body; timestamps are for display only.
- Confirm SPEC-003 Q02 first, then freeze the backup v1 schema, group references, golden fixtures, error classes and size limits.
  The old SPEC-002 lacks full group semantics and cannot be used directly as the complete format.
- Record a runtime choice ADR: the current Swift / ES modules / Python is still the prototype,
  and shipping the Python server with 1.0 must not be assumed.

How the choice converges: for the confirmed platforms, compare native hosts + a shared core against cross-platform frameworks on
"store packaging, native OAuth / credentials, reliable local transactions, background life cycle, public desktop APIs, code licenses".
Experience from this repo's isolatable public-API hosts may be used; external UI is not ported.
The 1.0 scope for extension capabilities / plugins still needs confirmation; do not add or exclude dynamic plugins just because of an abstract interface.
Until the framework is settled, freeze only formats / contracts / test samples, to avoid building a bridge that must later be rewritten completely.

The sync rules must handle explicitly:

- The order of initial cursor / full paging / catching up on changes, duplicate responses and replay after a crash;
  local data is committed together with the cursor.
- Single-parent branches, unknown parents, delete versus edit, and a late second branch after a conflict was resolved.
- New operation content is persisted before it is sent; once sending starts, the payload of that operation cannot change.
- Pre-generated Drive file IDs are written to disk before the request; after a lost success response, retry with the same ID;
  a 409 must be read back and checked, not treated as success directly.
- When remote files are unreadable, purged or in a newer format, keep local data and stop lossy sync;
  do not infer a user deletion from a missing file.
- The first version does not clean up version files automatically; save throttling, quota backoff and growth go into the performance budget.

**Exit criteria**: fixed-input / out-of-order / duplicate / interruption tests can decide results unambiguously;
the choice and scope are recorded. If the expected Drive space cannot be shared across client IDs, resolve the product identity setup first
instead of quietly switching to another source.

### Phase 2: Local data core and a backup round trip without Google

Deliverables:

- A local transactional store, per-account partitions, drafts, outbox, a single sync coordinator.
- Note add / edit / soft delete / restore and a multi-head display model.
- BackupService: snapshot, ZIP export, full validation, preview, atomic local import, RestoreJob resume.
- An in-memory NoteSource / fake FileStore and platform-independent fixtures.

**Exit criteria**: SPEC-002 T01–T03, the local parts of T05–T06 and the simulatable parts of T08–T12 pass.
First complete a content round trip without an account, proving that the backup format does not depend on Drive;
this development test mode does not promise a switchable Local-only provider in 1.0.

### Phase 3: Google sign-in and reliable sync between two clients

Deliverables:

- Google OAuth / SDK setup, the sign-in UI the system allows, credential storage, reconnection and sign-out.
- A minimal-scope appDataFolder adapter; the app calls the Google APIs directly.
- FileNoteSource: version scan, incremental sync, persisted IDs / retries, conflicts and quota/backoff.
- Real integration evidence with two independent profiles / credentials; across platforms, use the actual platform client IDs.
- Active refresh, foreground sync and moderate polling; second-level background sync on mobile is not promised.

**Exit criteria**: after both sides edit the same note offline at the same time, both bodies are kept;
a retry after a lost response does not duplicate; delete-versus-edit conflicts are kept; revocation / account switching does not mix data.
Verify with clean test data; when no test account / OAuth setup is available, list the external dependency explicitly
and do not pass a mock off as completed Google integration.

### Phase 4: Complete UI and platform integration per SPEC-003

Deliverables:

- The bundled editor is implemented to the confirmed content scope; cards / groups / formation and gestures follow SPEC-003,
  and text CRUD does not replace full desktop interaction.
- Sync shows only useful information: saved locally / syncing / needs attention;
  network errors and conflicts appear only in the details, with no PM / agent work status added.
- Desktop presentation uses the same NoteViewModel: shared content is separate from per-machine position / size / displayed set / highlight settings;
  locked by default, unlocked actively for editing; each platform reports through capabilities which desktop layers it can provide.
- "Data and backup" is fully connected to the OS file UI, preview, import progress and restore jobs.
- The renderer does not connect to Drive directly; the host exposes only typed, allowed commands
  and allows no arbitrary file reads or writes, remote scripts or token access.

**Exit criteria**: an ordinary user can complete the full flow: sign in, add, see it on another client, unlock and edit text, lock again,
export, and import into another clean profile.
The existing Mac evidence serves as the design basis; this phase does not redo the original exploratory probe project.
After formal product changes, the necessary regressions for the actual features run in the release phase.

### Phase 5: 1.0 release preparation for the chosen platforms

Deliverables:

- Installers, formal identity / signing, updates and the actual file selection flow for the confirmed platforms.
- Store materials and privacy statements for macOS / iOS / Android; Windows follows the feasibility of the Store plan;
  the Linux release promises only the tested distros / compositors and provides an explicit normal-window fallback elsewhere.
- Final dependency / transitive dependency license inventory, notices, Google setup and the operating instructions review requires.
- A release regression on the final packages covering data round trips, real sign-in, cross-device use and desktop behaviour.
- Documentation describes the finally approved backup / restore scope; an unapproved exclusion list is not a product decision.

**Exit criteria**: each chosen platform has reproducible artifacts and acceptance evidence;
platforms not chosen or not finished claim no support. Actual store approval depends on the store result.
This plan itself does not submit, buy certificates, create accounts or publish a release.

## Files to Create/Modify

The logical locations expected during implementation are below; file extensions follow the Phase 1 runtime decision.
These modules were not created in this round.

| Location | Change | Purpose |
|---|---|---|
| contracts/notes/, contracts/backup/ | Add | Schemas, versioning rules and test samples |
| src/core/ | Add | Notes, drafts, snapshots, restore plans, sync coordination |
| src/sources/ | Add | NoteSource, FileNoteSource, Drive adapter |
| src/macos/ | Adjust | Connect to the core / Google sign-in / native file operations |
| src/web/ | Adjust or replace gradually | Bundled editor and the ViewModel / command boundary |
| tests/backup/, tests/sync/ | Add | Format round trips, fault injection, cross-account and sync contracts |
| scripts/testing/ | Extend | Integration and packaging acceptance entry points with isolated data |
| docs/ | Update | Final format, operation, testing, privacy and release notes |

src/server keeps its 0.1.0 validation purpose; its token / epoch / Python service is not carried over as the formal Drive architecture.
Until the new version passes the replacement acceptance, old validation records are not deleted and known issues are not erased.
Direct migration of the old SQLite is not included in 1.0 by default; if migration is needed, write a separate converter instead of renaming the file extension to pass it off as a ZIP backup.

## Technical Decisions

- appDataFolder is the planning baseline for this round; ordinary Drive folders are handled by a future, separate provider mode.
- ZIP + public JSON, a source-independent BackupService and the incremental import mode are in [ADR-005](../decisions/005-portable-backup-and-restore.md).
- The append-only revision format and the pending / heads rules follow [SPEC-004](../specs/004-revision-graph-and-file-sync.md) /
  [ADR-011](../decisions/011-immutable-revision-graph.md); real Google and transaction integration have their own acceptance.
- Structured PM, team permissions, QR pairing, a self-hosted server and cross-source aggregation remain on the future roadmap.
- One shared backup ZIP is not used as the live sync file for several machines; backup and sync each have their own contract.

## Testing Strategy

Build tests that actually verify that user data is not lost, following SPEC-002 T01–T12:
schema fixtures / content round trip → transactions and crash points → out-of-order and lost responses over a fake transport →
two clients on real Drive → file operations on each release platform and the packaged apps.
Also test account switching, the explicit boundary for two devices importing at the same time, quota / revocation and protection against newer schemas.

The original prototype tests keep their applicable scope; the Windows fsync failure of the old restore and its later fix are recorded in the git history.
The new backup specification does not reuse that failing path as a verified implementation.
This round is a documentation change, so only Markdown / link / format checks run; the product tests above are not claimed to have run.
An author's own check is not an independent review; on implementation delivery, arrange an independent review according to the repo rules.

## Risks & Mitigations

| Risk | Handling |
|---|---|
| Locking in a framework before the platforms are confirmed | Phase 1 confirms the release set / choice first; file and semantic contracts stay independent first |
| A backup is mistaken for the latest state of all devices | The UI / manifest keep snapshotAt and the sync scope |
| A restore is interrupted while other devices keep editing | New IDs, a persisted job, the normal outbox, no overwriting of existing notes |
| A backup misses text the user has not saved yet | Flush drafts before export; abort if any editor fails |
| Drive version files grow without bound | Merge unsent drafts locally, explicit save throttling, measured growth; a compaction protocol is a separate case |
| Assuming that hidden AppData needs no file protection | ZIP allowlist, size limits, transactional writes only after full validation |
| Store / SDK license blockers found late | Phase 1 checks during the choice, Phase 3 integrates the real identity, Phase 5 audits the artifacts |

## Progress Log

The plan was created on 2026-10-03 and aligned with SPEC-003 / PLAN-003 on 2026-10-04.
The text still keeps technical proposals such as the additive import mode; that does not mean a single restore mode was approved.
The status of this plan's work is updated in the Status field above in the same commit as the work; history and verification
evidence are in the git history and [testing](../testing.md).
