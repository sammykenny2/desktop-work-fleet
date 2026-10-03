# Project State

Updated: 2026-10-03.

## Current focus

The user narrowed 1.0.0 to simple sticky notes backed by Google-hosted files,
with Google sign-in and no local note server. Heterogeneous sources and renderers
need explicit boundaries now; project management can wait.

Research recommends Drive rather than Keep. NoteSource, FileNoteSource/FileStore
and renderer/platform-host boundaries are proposed in ADR-004 and the MVP study.
Storage space, conflict format and the exact 1.0 platform release set remain open.
No Google Cloud project, OAuth session, SDK or Drive data has been changed.

ADR-003 and the complete PM/server blueprint are Deferred, preserved for later.
ADR-002 still documents the implemented 0.1.0 prototype: Swift/AppKit/WebKit,
ES modules and a Python/SQLite local server. That code has not become the Drive MVP.

## Entry points

- PROGRESS.md: authoritative execution status.
- docs/architecture.md: implementation and MVP direction.
- docs/resreach/2026-10-03-google-drive-notes-mvp-feasibility.md: evidence and design.
- docs/decisions/004-google-drive-notes-mvp.md: Proposed MVP architecture.
- docs/decisions/003-product-architecture-boundaries.md: Deferred complete design.
- docs/validation/2026-10-03-validation-report.md: existing Mac evidence and limits.

## Roles

No Conductor or implementation team is assigned. Follow the active user-authorized task.
