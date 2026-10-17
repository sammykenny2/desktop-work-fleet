# ADR-005: Source-independent backup format and additive restore

## Status

Superseded by [ADR-013](013-complete-portable-backup.md), 2026-10-04.
The 2026-10-03 candidates and later scope corrections are kept below; the current complete format, the three
restore modes and automatic/encrypted backups follow [SPEC-002](../specs/002-portable-backup-and-restore.md), and
the undecided items of this proposal no longer apply.

## Context

appDataFolder lets the app read and create files, but users cannot organize that content directly on the Drive
website.
1.0 should provide backups that users can hold, while keeping future sources and renderers replaceable.
With several devices syncing continuously, overwriting current files directly from an old backup would compete
with other devices' changes.

## Decision

- Backups use standard ZIP plus public, versioned JSON; BackupService sits in the shared data core,
  does not depend on Drive tokens, file IDs or sync cursors, and the renderer does not serialize data itself.
- 1.0 backups keep notes, recoverable content in Deleted, all conflict heads and local drafts;
  group references must be complete; the scope of history, layout and content formats is to be confirmed.
  Credentials and the old outbox are not portable content.
- Export uses a consistent local snapshot and states sync freshness; offline, it does not pose as the latest
  version of the whole cloud.
- The candidate restore mode in this document is "import as new notes"; whether it is the only mode has not been
  approved. New IDs, a full preview, a persisted RestoreJob and an atomic local commit prevent overwrites and
  duplicates on retry.
- Recovered drafts stay local first and are committed only when the user saves; saved notes go out through the
  normal sync flow.
- Success of the local transaction is reported separately from full remote sync; no multi-file Drive transaction
  is promised.
- 1.0 provides manual backup to a location the user picks in the OS, without adding drive.file or full Drive
  permissions.
- The 1.0 scope of whole-library replacement, full history, encryption and automatic backup still has to be
  decided; old exclusion proposals must not be treated as confirmed requirements.

## Consequences

### Positive

Users can carry data across installations and accounts; later providers can share the format.
Restore does not wipe out work that another device just finished, and the data core can be tested without Google.

### Negative

Import creates new note identities; it does not bring back old links, full history or whole-account state.
Imports started separately on different devices can still add two sets of notes.
A plaintext ZIP must be clearly labelled, and content from other devices that has not been synced or downloaded
cannot be included automatically.

### Neutral

Windows/macOS/Linux are required desktop targets; whether they ship on the same release cadence, and the
implementation framework, are still open.
ADR-004 stays Proposed; ADR-003's PM/server design stays Deferred.
The 0.1.0 SQLite backup/restore is a different format from this proposal, with no implied compatibility promise.

## Alternatives Considered

- Back up the Drive files as they are: keeps transport details, but binds to the provider and its version
  relationships, so it is not suitable as a source-independent user backup.
- Copy the local SQLite directly: risks mixing in caches and credentials and binds to the runtime schema;
  it can serve as an internal diagnostic technique, but not as this version's user format.
- Export plain text only: readable, but loses deletion, colour, conflict and draft relationships.
- Overwriting restore of the whole library: fits some administrative uses, but needs rules for other devices,
  the outbox and version generations; not suitable for this minimal version.
- Automatically saving a ZIP to an ordinary Drive folder: can be added later; this version first does manual
  backup through the OS save dialog.

## References

- [SPEC-002](../specs/002-portable-backup-and-restore.md)
- [PLAN-002](../plans/002-google-drive-notes-mvp.md)
- [Official backup capabilities and design](../research/2026-10-03-appdata-backup-and-restore-design.md)
- [ADR-004](004-google-drive-notes-mvp.md)
