# PLAN-005: MSIX Data Lifetime and Google Backup Overwrite

## Metadata

| Field | Value |
|---|---|
| Status | Completed, 2026-10-12 (Phases 1–4); real-environment verification is still open, see Progress Log |
| Owner | Project maintainer |
| Assigned To | Implementation responsibility: Windows host, shared backup and UI |
| Reviewer | Independent review not yet available |

## Related Spec

[SPEC-002](../specs/002-portable-backup-and-restore.md), [ADR-037](../decisions/037-msix-data-lifetime-and-google-backup-overwrite.md).
A follow-up authorization on 2026-10-12 added the two-way migration flows of [ADR-038](../decisions/038-portable-local-and-cloud-backup-flows.md).

## Overview

Following the user's explicit choice, fix MSIX data to the package-private data area and add a full cloud overwrite protected by validation / a safety backup.
At planning time the version stayed at 0.1.2 with local checks only; there was no authorization for a new version or an Actions dispatch.

## Implementation Phases

### Phase 1: Data location

The Windows host chooses an explicit private location based on the package identity; keep the currently virtualized DB path and do not move / delete old external data automatically.
Add a data location probe; the packaging probe may write only with an independent test identity.

### Phase 2: Full overwrite

On an empty Workspace of the same account, prepare a validated complete restore plan bound to the profile / revision / source.
Persist the Workspace, attachments and the job in the same transaction; clearing / uploading run in stages, and normal sync refuses to run during the clearing stage.
The UI first validates, saves a safety backup and gets an explicit confirmation to clear; failures / restarts offer resume, and normal sync pauses during the preview.

### Phase 3: Verification and delivery

Use a synthetic FileStore to verify that all old content is cleared, attachments / drafts, the reset protection on another device, save failure, wrong account and restart retry.
A real browser / IDB verifies the confirmation and the backup-saving gate; the Windows build and the isolated package data lifetime verification list their actual results separately.
Documentation, requirements and future release notes are completed in the same commit; real Google tests must never use clearing the user's data in place of a fixture.

### Phase 4: Complete local restore and export after sync

Keep the public ZIP and add an immutable plan for clearing local data and restoring plus Workspace graph replacement; replace the attachment set of the same profile atomically in SQLite / IndexedDB.
A backup of the old data is optional, permanent replacement needs explicit confirmation; automatic backups wait for idle first, and other partitions and settings are kept.
A manual Google export syncs first; on failure it needs explicit consent to a known copy. Source, target, last successful sync time and pending information are shown clearly.
Regressions for the four directions, rollback / cancel / expiry, lost responses, the real IDB UI and native SQLite; without real Google / cross-platform SDKs, list them as untested.

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `src/native/windows/app/AppDataDirectory.cs` | Create | Package-private data path |
| `src/backup/cloud-restore.js` | Create | Preview, safety backup and persistent reset / upload jobs |
| `src/backup/restore.js`, `src/backup/export.js` | Modify/Create | Local complete replacement plan and export after sync / explicit copy choice |
| `src/storage/`, each native Database / bridge | Modify | Atomic replacement of the same partition's attachment set and workspace |
| `src/app/backup.js`, `src/app/main.js` | Modify | Overwrite entry, sync barrier and resume |
| `src/sources/file-sync.js` | Modify | Stop / wait and protection for jobs that have not finished clearing |
| `tests/cloud-restore.test.js`, native / browser probes | Create/Modify | Synthetic-data regressions |

## Technical Decisions

See ADR-037 / 038. Drive has no atomic transactions; if a cloud overwrite fails, the local restore job and the safety ZIP the user saved are kept.
A complete local restore can keep the original data when the single transaction fails, so the safety ZIP of the old data is optional.

## Testing Strategy

- Unit / integration: MemoryFileStore clearing, full round trip, CAS / expiry / wrong account, reset / upload restart.
- Real browser: saving a safety backup and ticking the confirmation are both required, and the confirmation becomes invalid after the file / mode changes; regressions for the existing three modes.
- Two-way migration: same-format round trips in four directions, the optional backup / CAS / rollback / attachment removal of a complete local restore, export after sync and the explicit copy choice.
- Windows: compile, a read-only probe of the unpackaged path; writes and uninstall with an independent MSIX identity, never touching the real package.
- Manual: after Google is configured, end to end with a dedicated test account; another device that receives the marker exports first, then clears its copy.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Network / authorization lost after clearing | High | Complete local data already saved; a resumed upload does not clear again |
| Other devices upload old data | High | Reset marker, an explicit request to stop sync, the old copy paused and cleared manually |
| Old external data from before the update | Medium | Prompt to export / import; do not delete data of uncertain ownership automatically |

## Progress Log

- 2026-10-12: Phases 1–3 done ([ADR-037](../decisions/037-msix-data-lifetime-and-google-backup-overwrite.md)) and Phase 4
  done ([ADR-038](../decisions/038-portable-local-and-cloud-backup-flows.md)), verified with model tests, Edge probes over a
  synthetic FileStore and an isolated `app.workfleet.storageprobe.*` MSIX on 23H2.
- Not verified as of 2026-10-17: a real Google overwrite, a real product update keeping data, other Windows versions, and
  resume after failure in the full native main window.

The Status field and this log are updated in the same commit as the work; history and verification evidence are in the git
history and [testing](../testing.md).

---

*Created: 2026-10-12*
