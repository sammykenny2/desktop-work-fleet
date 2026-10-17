# ADR-004: Google Drive file-based notes as the 1.0 MVP

## Status

Original proposal: 2026-10-03; the provider and data space were adopted and superseded on 2026-10-04 by
[ADR-012](012-durable-file-store-and-drive-adapter.md). The scope candidates of that time are kept below and
cannot override the approved requirements for five platforms, the editor and complete backup.
The user has decided to start with simple notes based on a Google account and files, with no local server in the
first version; the Drive provider, data space and conflict format are this proposal's suggestions.
Native apps and store preparation for Windows/macOS/Linux and iOS/Android are included in this complete 1.0.
The card, group, formation and interaction rules of 2026-10-04 are in
[ADR-006](006-card-group-and-formation-semantics.md).
The editor and backup scope in this document that was not yet approved cannot override the latest requirements.

## Context

The user wants ordinary people to be able to use it by signing in to Google, without bringing in full project
management yet.
The boundaries between heterogeneous data sources and the renderer still need to be designed now.
Keep's official API is meant for enterprise administration and lacks an interface for updating the content of
existing notes; Drive can store this app's data files.

## Decision

Proposed:

- The first source uses the Google Drive API, authorized with the user's own account.
- The planning baseline for now is appDataFolder + drive.appdata; users export and import backup files through
  the app.
  If managing work files directly in Drive is required in the future, evaluate a separate drive.file mode then;
  never maintain two sources of truth at the same time.
- 1.0 provides basic notes, locking and unlocking on the desktop, cross-device sync, drafts and kept conflicts.
- NoteSource separates data sources; the file source is implemented by FileNoteSource + a FileStore adapter.
  The renderer only uses NoteViewModel and edit commands, never Google tokens or APIs directly.
- The presentation surfaces on one machine share the local store and sync coordination; the per-machine layout is
  separate from the shared cards and groups.
  A card is not a native window; the presentation topology is in [ADR-007](007-desktop-scene-and-platform-host.md).
- File sync first compares immutable revision records and provable conditional writes; silent last-writer-wins
  overwrites are forbidden.
- Both Google authorization and content sync go directly from the app to Google; no resident backend of our own is
  added.
- The backup candidate uses a source-independent ZIP/JSON, and the restore candidate imports as new notes after a
  preview; whether this is the only mode is still to be confirmed;
  drafts, conflicts and resuming after interruption are in [ADR-005](005-portable-backup-and-restore.md).
- ADR-003's PM / self-hosted server route is deferred, keeping its full text and future applicability.

Detailed evidence and open questions are in
[Drive MVP feasibility](../research/2026-10-03-google-drive-notes-mvp-feasibility.md).

## Consequences

### Positive

Users do not have to deploy a service; the product features can first converge on notes.
The boundary between data sources and presentation leaves room for future expansion without implementing every
provider now.

### Negative

Drive does not provide this app's note editor or automatic conflict UX.
appDataFolder does not let users edit directly in the Drive UI, and it does not support sharing across accounts.
Sign-in, the sync format, OAuth setup and store configuration still have to be implemented.

### Neutral

No SDK was added and the product runtime did not change.
The existing platform targets stay; this proposal does not silently shrink an unknown platform scope to a
Mac-only 1.0.

## Alternatives Considered

- Keep's official API: does not fit two-way note editing for ordinary accounts; excluded from this MVP.
- Unofficial scraping of Keep: not a basis for stable releases.
- A self-hosted authoritative server: stays on ADR-003's later route.
- A fully overwritable notes.json: the overwrite and contention scope is too large; not used as a sync guarantee.

## References

- [Drive MVP research](../research/2026-10-03-google-drive-notes-mvp-feasibility.md)
- [ADR-003 (Deferred)](003-product-architecture-boundaries.md)
- [Existing validation report](../validation/2026-10-03-validation-report.md)
