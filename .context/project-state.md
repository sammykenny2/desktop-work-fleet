# Project State

Updated: 2026-10-03.

## Current focus

The user narrowed 1.0.0 to simple sticky notes backed by Google-hosted files,
with Google sign-in and no local note server. Heterogeneous sources and renderers
need explicit boundaries now; project management can wait.

Research recommends Drive rather than Keep. NoteSource, FileNoteSource/FileStore
and renderer/platform-host boundaries are proposed in ADR-004 and the MVP study.
The planning baseline is appDataFolder with portable ZIP/JSON backups.
SPEC-002 defines snapshot freshness, draft/conflict preservation, preview, import as new notes,
durable restore jobs and validation cases. ADR-005 is Proposed; SPEC-002 and PLAN-002 are Draft.
The exact release platforms, production runtime and sync protocol still need decisions.
Next work follows contracts/stack → local core/backup → Google sync → UI → platform release.
Do not restart the paused validation goal or repeat Mac exploratory probes as the next design task.
No Google Cloud project, OAuth session, SDK or Drive data has been changed.

ADR-003 and the complete PM/server blueprint are Deferred, preserved for later.
ADR-002 still documents the implemented 0.1.0 prototype: Swift/AppKit/WebKit,
ES modules and a Python/SQLite local server. That code has not become the Drive MVP.

## Entry points

- PROGRESS.md: authoritative execution status.
- docs/architecture.md: implementation and MVP direction.
- docs/resreach/2026-10-03-google-drive-notes-mvp-feasibility.md: evidence and design.
- docs/decisions/004-google-drive-notes-mvp.md: Proposed MVP architecture.
- docs/specs/002-portable-backup-and-restore.md: backup and restore behavior.
- docs/plans/002-google-drive-notes-mvp.md: implementation sequence and acceptance.
- docs/decisions/005-portable-backup-and-restore.md: Proposed portability decision.
- docs/decisions/003-product-architecture-boundaries.md: Deferred complete design.
- docs/validation/2026-10-03-validation-report.md: existing Mac evidence and limits.

## Roles

No Conductor or implementation team is assigned. Follow the active user-authorized task.
