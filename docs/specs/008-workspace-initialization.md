# SPEC-008: Workspace initialization and proof of reset completion

## Metadata

| Field | Value |
|---|---|
| Status | Approved. Current status is in [PROGRESS](../../PROGRESS.md); implementation history and verification evidence are in the git history and [testing](../testing.md) |
| Owner | Project maintainer |
| Reviewer | Independent read-only review; its findings and fixes are in the git history and [PLAN-008](../plans/008-workspace-initialization.md) |

## Summary

Google appData explicitly records the preparation and completion state of the current workspace round, distinguishing
a brand-new account, clearing in progress, initialized and empty, and a backup overwrite.
The user's intent for groups with the same name is kept through entity IDs. The user approved the implementation,
which stays at V1.

## Goals

- After a reset with six devices, reconnecting devices receive only the one logical initial group prepared by the
  device that started the reset.
- Several devices signing in to a brand-new account at the same time can still replay, and if the initializer is
  interrupted, another device can complete the same plan.
- Resets and overwrites resume safely; before completion, no partial remote graph is published and no sync success is
  misreported.

## Non-Goals

Automatically merging existing groups with the same name, version upgrades or migrations, an own coordination server,
a cross-device global lock, and remotely forcing old app versions to update.

## User Stories

After the user resets, the other devices only need to clear their local copy and sync; a "My notes" group created
deliberately in addition remains a separate group.
After a network or process interruption, the device that started the work can resume it without clearing already
restored content again.

## Requirements

### Functional Requirements

1. I01: prepare/ready are bound to the source and the reset generation, and ready references the exact planId; a
   different plan keeps the data and stops.
2. I02: The starter plan of a new account is deterministic and can be completed by any updated device; manual groups
   and the default group have independent identities.
3. I03: A new reset is cleared and initialized by the device that started it; followers wait in the marker-only or
   prepare state, without uploading or creating a default group.
4. I04: The graph and layout are activated atomically only after the complete required bytes and attachments are
   received and validated; ready by itself does not mean that all data has arrived.
5. I05: The journal is persisted before the marker, deletions and uploads; retries with the same ID verify the bytes,
   and nothing is cleared again in the initialize or upload stages.
6. I06: When a new reset round replaces an old job, the old job creates no marker and deletes no later data; export
   and clearing the local copy are offered.
7. I07: The restore manifest contains all portable revisions and historical attachments and can keep valid pending
   history; it must not be ready before the complete upload.
8. I08: An existing declaration keeps the existing data; a workspace that is initialized and empty gets no groups
   added. Existing V1 data without control files is scanned completely before the declaration.
9. I09: An incomplete, cross-account or invalid manifest found while listing stops the work before deletion or
   publishing completes; waiting does not update the successful sync time.

### Non-Functional Requirements

- **Integrity**: control files are capped at 8 MiB, with strict fields and sorted, unique requirements; all current
  formats are V1.
- **Security**: credentials stay in the native services; no new bridge gets arbitrary HTTP permission.
- **Recovery**: a lost save or upload response and a reopen can both resume; content not yet uploaded and old devices'
  copies are kept.

## Design Overview

The flow is journal → reset marker → complete clearing → prepare → required bytes → ready → receivers check and
activate.
A brand-new account skips the destructive clearing; existing uses a declaration with empty requirements. Details are in
ADR-054 and contracts/sync.d.ts.

## Dependencies

SPEC-004 FileStore and revision graph, SPEC-002 backups, ADR-053 source generations, and the existing native Google
services of each platform.

## Open Questions

No open questions are needed for this round's implementation; acceptance with real Google and six native devices runs
separately, depending on the environment.

## References

- [ADR-054](../decisions/054-explicit-workspace-initialization.md)
- [PLAN-008](../plans/008-workspace-initialization.md)
- [SPEC-004](004-revision-graph-and-file-sync.md)

Created: 2026-10-17. Current status is in [PROGRESS](../../PROGRESS.md); history and verification evidence are in the
git history and [testing](../testing.md).
