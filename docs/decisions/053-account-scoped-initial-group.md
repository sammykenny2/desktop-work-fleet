# ADR-053: An initial group identity shared by all devices

## Status

Accepted, 2026-10-17. Fixes the race in which six desktop devices each created their own "My notes" group after a
Google reset; stays on V1.
The completion condition and initiating flow of initialization are superseded by
[ADR-054](054-explicit-workspace-initialization.md); this ADR's deterministic identity and source-generation isolation
still apply.

## Context

The Google partition used to create no group; after a successful sync, the main window checked whether it was empty and
then created "My notes" with a random ID.
When several devices read an empty source at the same time, each created a different entity/root; sync correctly kept
every group, so the default group was duplicated.
After resetting the cloud and clearing the copies on the other devices, the same race happened again.

## Decision

- FileSync creates the initial group after a complete pull (including the changes caught up after a full scan)
  succeeds and before the push; the main window no longer creates a random group after sync.
  It is enabled with `bootstrapGroup: true`; other sync uses such as backup overwrite still never create one
  automatically.
- Initialization happens only when there are no local revisions or groups at all; pending history, retired groups or
  an existing group with the same name do not count as an empty source.
- The initial identity is `SHA-256(canonicalJson(['work-fleet-initial-group', sourceId, sortedResetFileIds]))`, using
  the full hexadecimal digest.
  The group ID is `initial-group:<digest>` and the root revision ID is `initial-group-root:<digest>`; the root content
  is fixed: the name `INITIAL_GROUP_NAME` (the original Traditional Chinese text of "My notes", stored the same in every
  UI language; see the initial group name in [i18n](../i18n.md)), not deleted, no parent.
  For the same account and the same reset batch the root bytes must be identical, with no device ID, clock or random
  value. Ordinary user creates and edits still use random UUIDs.
- The reset descriptor is recorded in `sync.files` in the same transaction as the cursor, with its bytes checked, but
  it is not stored as an attachment.
  When the first source read completes, `sync.sourceResetIds` is saved in the same transaction; an empty array also
  means the initial generation is established, and clearing an expired cursor does not clear this generation.
  An incremental replay of a known reset ID is no longer treated as a new reset; a device with an established
  generation that sees an unknown marker in an incremental or full scan pauses before receiving, and even when no upload
  file ID has been allocated yet, or the reset has not yet deleted the old files, it does not relabel the old outbox as
  the new generation.
  Existing V1 copies without this optional field derive it on read from existing sync evidence such as the cursor, known
  files and reservations; the derived value is kept until an expired cursor is cleared, with no added migration write.
  An existing marker whose generation cannot be confirmed pauses and keeps the copy.
  A new reset round uses a new marker ID and therefore creates a different initial group; a restart keeps the original
  batch.
- Initialization checks for a valid session, a non-empty cursor and the reset set used to compute the identity; the
  revision and the outbox are persisted before uploading.
  Several devices may upload different Drive files with the same content; the revision graph replays them by the same
  revision ID/bytes and shows only one group, without assuming any distributed lock.
- Uploads that an old device started may still arrive after the reset completes. New transfer files add a sorted
  `sourceResetIds` to the transport layer of the V1 revision JSON, meaning the set of reset markers already received
  when the transfer file was created; decoding takes that field out and then validates the portable revision against
  the original seven-field envelope.
  The transfer bytes/digest include the generation, while the core revision graph and backups do not store this
  transport field, and revision IDs and bodies are not rewritten because of it.
- A transfer with a generation enters the revision graph only when its `sourceResetIds` equals the current marker set;
  descriptors of other generations stay in the ledger, and cloud files are not deleted.
  An old device keeps its own groups/notes/edits and stops syncing when it receives a new marker; a device that has a
  reservation but has not completed any file must stop too.
  A full scan stages the revisions with a generation and receives them only after listing every page, so a marker on
  the last page cannot let old content be received first; an interruption keeps a null cursor, and a rescan recovers.
- An explicit backup restore keeps the original portable revision identities and bytes, then produces new transfer
  files for the current source generation, so a full overwrite of the same account and merge/replace are not mistaken
  for old in-flight uploads. Existing V1 files without `sourceResetIds` are still received in full; saved old
  reservations retry with their original bytes/file ID.
  Data cannot be skipped based only on root content or group name, because the same root may also be history the user
  explicitly restored.
- When a new or cleared Google partition has no valid group yet, adding notes and receiving shares must first complete
  the source read and create the initial group; the coordinator cannot be bypassed to create another random default
  group. Offline editing in a Google partition that already has groups, and local workspaces, are unaffected;
  once the initial group is on disk, even if the upload fails, that group must be selectable to allow adding notes
  offline.
- Existing duplicate groups are never deleted or merged automatically by name; each may already hold notes, so the
  explicit group merge operation is still used.

## Consequences

### Positive

Six devices initializing at once, reconnecting after a reset, an automatic root arriving late in the middle of a reset,
and process restarts all converge on the same initial group; accounts and reset batches are kept apart.
Existing data, offline branches and explicitly created groups with the same name are all kept in full.

### Negative

A new or just-cleared Google partition must complete its first source read before notes can be added; several devices
initializing at once may leave several identical root revision files.
The new generation transport field needs updated receivers; an older version receiving an unknown envelope field
pauses and keeps the data, so every syncing device should be updated.
Existing in-flight old transfers without a generation cannot have their generation determined after the fact; existing
data is not discarded on a guess.
Older app versions still create random groups, so every device must be updated to remove that initialization path.

### Neutral

No change to the app version, no release, no schema bump, and no added migration, server, listener or package.

## Alternatives Considered

- Sync once more / delay by a random time: only narrows the race window and cannot guarantee that simultaneous devices
  converge.
- Deduplicate by the "My notes" name: a name is not an entity identity, and this would wrongly merge groups the user
  created on purpose.
- The same group ID on every device with different revision IDs: produces several conflicting root branches, so the
  root revision and its bytes must be identical too.
- A fixed ID across all resets: a late rename/retire from an old device would find the new root and act on the group
  after the reset, so the source identity and the marker set are included.
- Skip only purely automatic roots of old batches: indistinguishable from a user's explicit backup restore, and could
  leave another device's restored notes without a group; rejected.

## References

- [ADR-012](012-durable-file-store-and-drive-adapter.md)
- [SPEC-004](../specs/004-revision-graph-and-file-sync.md)
- [Google operations](../google-setup.md)

Decision date: 2026-10-17. Current status is in [PROGRESS](../../PROGRESS.md); history and verification evidence are in
the git history and [testing](../testing.md).
