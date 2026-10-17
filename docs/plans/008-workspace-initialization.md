# PLAN-008: Workspace Initialization and Resumable Reset

## Metadata

| Field | Value |
|---|---|
| Status | Completed, 2026-10-17 (Phases 1–3); real Google and native-app verification still open, see Progress Log |
| Owner | Project maintainer |
| Assigned To | Implementation session |
| Reviewer | Independent read-only review done; all findings fixed, no important finding remains |

## Related Spec

[SPEC-008](../specs/008-workspace-initialization.md)

## Overview

Add immutable prepare / ready to the existing V1 FileStore, atomic staging and activation of the Workspace, and resumable reset through a durable journal.
This document records the implementation boundaries; the execution status is in the Status field and the Progress Log.

## Implementation Phases

### Phase 1: Control files and receiver activation

Strictly define workspaceId, generation, requirement digest and receipt; enumerate the control files completely before taking data, and the receiver checks them and activates atomically.
**Deliverables**: source control module, Workspace and FileSync, TypeScript contracts.

### Phase 2: Reset / overwrite and UI

Persist the journal before clearing, upload only during the initialization stage; the reset starter and the restore manifest complete separately, and followers wait.
Restore the entry to the local copy of a superseded job, and reopen the durable writer when a save ack is lost.
**Deliverables**: reset helper, cloud restore, main-window wait / resume, descriptor support on five platforms.

### Phase 3: Regressions, documentation and review

Verify reconnection of six devices, manual groups with the same name, marker-only, missing bytes, save / upload faults, superseded jobs, incomplete enumeration and restore.
**Deliverables**: related and full tests, ADR / operating documentation, an independent read-only review record.

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `src/sources/workspace-initialization.js`, `source-reset.js` | Create | Control files and durable reset |
| `src/sources/file-sync.js`, `src/core/workspace.js` | Modify | Prepare / wait / activate transactions |
| `src/backup/cloud-restore.js`, `src/app/main.js` | Modify | Overwrite owner, resume and recovery entry |
| `src/native/`, `contracts/sync.d.ts` | Modify | Workspace descriptor, enumeration completeness and state |
| `tests/workspace-initialization.test.js` and sync / native tests | Create/Modify | Observable behaviour and fault regressions |

## Technical Decisions

[ADR-054](../decisions/054-explicit-workspace-initialization.md): deterministic bootstrap, a resumable reset owner, ready requires validated data.
Keep the ADR-053 identity, source generation and V1; introduce no locks, server or format migration.

## Testing Strategy

- **Unit / Integration**: real pages of MemoryFileStore, create / save boundaries and reopening, using six independent Workspaces.
- **Full checks**: the documented Node / Python tests, web build, config, docs, diff.
- **Manual**: after updating each device, reset with a dedicated test account, let another device wait, interrupt and resume on the initiating device, and confirm that manual groups with the same name and attachments are kept.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Old data read during clearing | High | Read control files first, wait on marker-only, no projection before ready |
| An old job clears later data | High | Marker generation guard, initialize no longer clears, local recovery entry for superseded jobs |
| Half a restore treated as complete | High | All revisions / attachment requirements and atomic activation |
| Different intents at the same time | Medium | Stop on a planId conflict, keep the content, do not pick an arbitrary first one |

## Progress Log

- 2026-10-17: Phases 1–3 done. The independent read-only review found boundary issues (manual groups during initialization,
  interrupted rescans, convergence of control files over repeated resets, the restore owner, missing files after ready); all
  were fixed, and no important finding remains.
- Not verified as of 2026-10-17: real Google and the six native apps; the user's cloud data was not touched. The test-account
  acceptance steps are in [testing](../testing.md).

The Status field and this log are updated in the same commit as the work; history and verification evidence are in the git
history and [testing](../testing.md).

Created: 2026-10-17.
