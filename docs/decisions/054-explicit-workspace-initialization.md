# ADR-054: Explicit workspace initialization and resumable resets

## Status

Accepted, 2026-10-17. The user approved the implementation. Supersedes ADR-053's flow of "deciding whether to
initialize only from an empty revision graph"; keeps its account/generation identity and transport isolation.

## Context

Six devices on the same Google account must not each create a different default group. A fixed root revision alone
does converge, but still cannot clearly tell apart a new account, a reset that has not finished clearing, a
deliberately empty workspace and a backup overwrite that has not finished uploading. A name cannot stand for the
initialization identity, and a "My notes" group the user created by hand must be kept.
Drive file names are not unique keys; pre-generated IDs solve retries of the same known ID, but cannot provide a
cross-device lock for IDs that six devices each allocate.

## Decision

- Stay on V1 and add an immutable `kind: workspace` control file, capped at 8 MiB; every native host uses the same
  allowlist.
  `workspaceId` is the SHA-256 of the account source identity, and `sourceResetIds` binds the current generation.
- `prepare` describes the mode, the origin, the sorted, unique revision IDs / portable bytes SHA-256 and the attachment
  hashes.
  `ready` references the SHA-256 of the whole canonical prepare bytes (planId). Repeating the same plan/receipt is a
  replay; a different planId in the same generation stops and keeps the data.
- New account: only after listing completes and the changes are caught up does a device propose the deterministic
  `starter` plan; any device can complete the same plan.
  Concurrent plans, roots and receipts may each have several physical Drive files, but there is only one logical
  initialization; there is no arbitrary pick of the first copy, no lease and no permanent leader.
  Once a starter is chosen, another group the user creates does not cancel the required root revision; ordinary
  createGroup still uses an independent UUID.
- Existing source: when a complete read finds any revision (including pending or retired groups), an `existing` plan
  declares it initialized.
  That declaration lists no revision/attachment requirements, so that different full-scan windows cannot produce
  different manifests for the same existing source; the existing sync integrity rules still apply.
  An empty workspace with an explicit ready stays empty and does not get a default group again because it has no
  groups.
- The reset initiator first persists an account-bound journal, the allocated marker ID, the original generation's
  marker set and the complete plan, and then publishes a marker with `initialization: workspace-init-v1`. After a
  complete listing and clearing, it first saves the `initialize` stage, then writes prepare, the root and ready.
  Other devices that see a pending marker only wait: they create no default group, upload no outbox and do not
  declare sync successful.
- A backup overwrite uses a `restore` plan that lists all the backup's revisions (including pending history) and every
  historical attachment.
  The initiator publishes ready only after uploading and verifying the requirements; an empty missing-parents list is
  not the completion condition, because a backup may legitimately keep history still waiting to be filled in.
- A receiver first lists all descriptors completely, then reads every reset and workspace control file, and only then
  the data; this avoids publishing old content first when the marker shows up on the last page.
  Before ready, data is stored in `sync.initialization.incoming` and is not projected into groups, notes or the layout.
  On receiving a receipt it still checks the actual bytes, the required revision digests and the verified attachments,
  then commits activePlan, the graph and the layout atomically.
  When a receipt arrives, it lists again to fill in data skipped while waiting. The waiting state does not update the
  last successful sync time.
  The rescan requirement is saved in the same transaction as the receipt/cursor and cleared only after a full scan
  completes and the staged data is saved, so a restart never waits forever.
- During a marker-only cleanup, a fresh follower may converge old control files and generations along with ordinary
  removals; this grace applies only to a receiver with no plan/receipt of this round, no activePlan and no restore
  work. Once a plan of this round has arrived, the strict missing-file check returns, so staged bytes cannot mask a
  remote deletion.
  A restore initiator also checks the journal's generation and owner planId, so an old backup outbox cannot be labeled
  as a later generation.
- The reset journal is saved at every stage and after upload IDs are allocated; a lost response reuses the same ID, and
  a 409 must be read back and checked.
  After entering initialize/upload, resuming never clears again. An incomplete listing, a wrong source identity or an
  invalid plan stops the job, which must not publish ready.
  When a later reset marker is found, or its own published marker disappears, the old job stops clearing for good.
  The UI offers a way to export a backup first, clear the local copy and fetch the current cloud again; it does not
  rerun a cloud reset that is no longer valid.
  When a successful storage response is lost, the durable journal is reopened, and no old in-memory writer is started.

## Consequences

### Positive

The reset initiator initializes and the other devices download; a new account can still finish initialization after
one device is interrupted. A manual group with the same name is not swallowed, and an empty workspace is not
misjudged.
Resets, restores and enabling reception all have an explicit basis for completion, and a disconnect never counts half
a workspace as success.

### Negative

A few more small control files and journals; receiving ready may cost one more full scan. When the initiator's reset is
interrupted, the other devices wait for it to resume; there is no automatic takeover of the destructive clearing.
This is a client protocol and cannot force older app versions to follow it; every syncing device should be updated.
Existing unscoped V1 transfers still cannot have their source generation determined after the fact.
Conflicts between different plans keep the data and stop, without guessing the user's intent. No compare-and-swap or
global distributed lock, which Drive cannot provide, is implemented.

### Neutral

No change to the app version, no release, no schema bump, and no new backend, listener or runtime package; existing
duplicate groups are still merged explicitly by the user.

## Alternatives Considered

- **Deduplicate by name**: would swallow a group with the same name the user created on purpose; rejected.
- **First upload wins, or one fixed leader device**: the first cannot express different intents, and the second would
  depend forever on one device being online; a new account uses the same replayable plan.
- **A single initialized boolean**: cannot prove that the data/attachments finished uploading and cannot resume a reset
  safely, so prepare + ready + verification of the actual requirements is used.
- **Reset followers take over the clearing automatically**: could delete later data twice; the initiator's journal is
  kept for an explicit resume.

## References

- [SPEC-008](../specs/008-workspace-initialization.md), [PLAN-008](../plans/008-workspace-initialization.md)
- [ADR-053](053-account-scoped-initial-group.md), [ADR-012](012-durable-file-store-and-drive-adapter.md)
- [Drive files.name](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
- [Pre-generated IDs and retries](https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files)

Decision date: 2026-10-17. Current status is in [PROGRESS](../../PROGRESS.md); history and verification evidence are in
the git history and [testing](../testing.md).
