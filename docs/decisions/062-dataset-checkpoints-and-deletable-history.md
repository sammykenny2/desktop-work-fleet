# ADR-062: Dataset checkpoints and deletable note history

## Status

Proposed, 2026-11-01; revised following external review. Implementation is not approved.
[SPEC-010](../specs/010-dataset-checkpoints-and-deletable-history.md) contains the candidate protocol and examples;
[PLAN-011](../plans/011-dataset-checkpoints-and-deletable-history.md) separates local work from remote proof work.
This proposal authorizes no runtime changes, account reset, version bump or release.

## Context

Today a new device downloads the revision graph, including ancestors and attachments. Ordinary local mutations
also copy and serialize the accumulated history. Deleting an ancestor payload breaks that model. Repository
observations, externally supplied measurements and Drive limits are distinguished in
[the research](../research/2026-11-01-drive-dataset-checkpoints-and-deletion.md).

The user requires efficient ordinary operations even with a long history, permits deleting historical content,
and wants explicit reset of incompatible old Google data instead of migration. Future automatic expiry concerns
whole notes after entering Trash, not individual versions. This does mean retained live-note history can grow
until the user removes it or storage reaches a limit. Checkpointing alone does not reduce that storage.

Use **dataset** for synchronized notes and their control records. Reserve **vault** for the existing credential
and backup-password APIs. The incompatible persistence change belongs in the next maintainer-approved **minor**
application release, not a compatible 0.4.x patch. The target version is not selected or authorized by this ADR.
Public JSON stays V1 under ADR-051; an explicit format discriminator distinguishes the new layout.

## Decision

### 1. Incremental synchronization with synthetic current checkpoints

Use full-value immutable revision files and periodically consolidate their current results into checkpoints.
This resembles incremental backup plus a synthetic full, but is a multi-device synchronization protocol.
It does not introduce an incremental-backup product or a chain of patches needed to reconstruct a note.

| Data | Storage and purpose | Normal loading |
|---|---|---|
| Dataset control | Initialization, generation identity and content-free purge decisions | Current control and targeted identity checks |
| Current checkpoint | Full current values, unresolved heads and exact covered input file IDs for one fixed shard | Bootstrap and reconciliation |
| Recent change reference | Small immutable publication record pointing to a verified revision file | Bounded tail only |
| Revision | One immutable full-value file in its note's folder, serving both sync and history | Current tail, or explicit paged history |
| Attachment | Bytes owned by one note, hash reuse within that note | On demand |

There is **one durable revision body per save**, not separate transport and history bodies. The small change
reference is an index/publication receipt, not another history copy. Consolidation removes covered references,
not the revision files. There are no packs or application-maintained history-page indexes in this scope.

A checkpoint owns its full shard payload; checkpoints do not share content chunks. This deliberately spends
some current-state bytes to avoid a separate shared-chunk reference-counting protocol. It never embeds the full
list of historical revision IDs. Limits on shard bytes, discovery and in-flight publication are explicit in the
SPEC; reaching a limit preserves local work and pauses dependent cloud publication.

### 2. Keep random revision IDs and parent IDs

Retain UUID revision identity and explicit parents. Current checkpoints carry the current head values and their
parent IDs. A new revision can replace heads it demonstrably descends from; other heads remain concurrent.
Explicit conflict resolution observes all previewed heads. Neither a timestamp nor a checkpoint name chooses
which content wins.

Remove the dotted version vector and writer-incarnation proposal. It adds clone/restore lifecycle obligations
without a demonstrated need here. A revision ID replay with identical bytes is idempotent; the same ID with
different bytes is an integrity error. New edits always get new random IDs, including after cloning an install.

The simpler model has a cost: after current reconciliation, an unrecognized parent is treated conservatively as
concurrent. For example, if only `r3 -> r2` is known, a late `r1` cannot be discarded merely because it might have
preceded `r2`. A conflict may be unnecessary, but silently discarding content would be unsafe. No foreground
operation walks arbitrarily old ancestry to eliminate that uncertainty. Historical deletion will retain identity
markers where needed; it must not turn an all-history marker list into a startup dependency.

### 3. A concrete immutable publication protocol, without a mutable latest pointer

SPEC-010 defines file kinds, properties, queries and four worked races. A save uploads and verifies its revision,
then publishes a small change reference. A compactor captures explicit current inputs, writes a self-contained
checkpoint, verifies it, and only then deletes the covered change references and predecessor checkpoints.
Revision bodies remain in the note folders. A reader activates its verified projection and changes cursor in
one local transaction.

Concurrent checkpoints are combined, not elected by timestamp. Inputs explicitly covered by another visible
checkpoint can be omitted; incomparable candidates and uncovered references remain. A successor can retire only
inputs named in its own verified coverage. Since it cannot cover an unpublished future checkpoint, two concurrent
compactors cannot authorize deletion of each other's outputs merely by having started together.

This is a candidate protocol with a stated safety argument, not a proof result. Phase 1 must model incomplete
uploads, stale/paginated listing, lost acknowledgements, late duplicate receipts and concurrent retirement.
Real Drive probes validate provider assumptions separately. Local record-level storage can proceed independently
once its own scope is approved; it does not wait for Google authorization or this remote proof.

### 4. Record-level local persistence on every host

Separate current entities/heads, history, unsaved changes, outbox, attachment references and maintenance journals.
An ordinary mutation writes affected records atomically without copying old history through JavaScript or a
native bridge. Preserve local CAS, one writer, account isolation, durable acknowledgements and ADR-061 semantics.
Unsaved changes carry their baseline content so deleting history does not destroy the comparison baseline.

Windows, macOS, Linux, iOS, Android and the browser need equivalent semantics. ADR-058's proposed process split
is not a dependency. The local track must handle an incompatible profile explicitly, without converting it.

### 5. Ship explicit whole-note purge first

The minimum proposed scope is local record-level storage, checkpoint bootstrap, legacy reset, Delete forever
for a trashed note, and Empty Trash. A remotely verified purge is terminal for that note identity. Offline edits
or restores cannot resurrect it; distinct unpublished work remains available for explicit Save as copy.

A content-free purge marker lives outside the note folder. Readers and uploaders check it. Cleanup then removes
the note folder, sanitizes current checkpoint copies, retires old snapshots and invalidates local cached copies.
Folder cascade is an optimization for note history and attachments, not proof that all content has disappeared.
No client-side marker can stop a request already in flight or an incompatible client with the same OAuth grant;
late files are excluded from projection and scheduled for cleanup. Completion is scoped to verified cloud work,
not a remote-wipe promise about offline devices or external backups.

Retain only `trashedAt` and a unique `trashEpisode` as the new lifecycle fields. Restore clears the episode;
re-entering Trash creates another. Automatic days-based expiry, clock policy, deadline queues and policy revisions
need a later ADR. They are not part of this implementation plan. The current application view is called Deleted;
this proposal uses Trash for that lifecycle and does not itself rename the UI.

Manual **Clear this note's history** is the first follow-up capacity feature, retaining current/conflict heads.
Selective Delete version follows it. Both need their own deletion-target and stale-restore rules before enabling
UI; neither introduces automatic per-version retention. Archived notes keep their existing editable behavior.
Archive is retained organization; Trash is eligible for explicit permanent removal. Making archive read-only is a
separate interaction decision, not a prerequisite for this storage change.

Remote attachments belong to one note. Save as copy uses a new note identity and uploads its attachment bytes
again, even when hashes match another note. This increases storage and transfer; global cross-note deduplication
is deferred. Local deduplication may continue with transactional references.

### 6. Explicit reset and recoverable first startup

Detect the old local/cloud format before decoding all history. Preserve an old local profile until the user
chooses to leave it, use a compatible old app to export it, or explicitly discard it and start/rejoin. A compatible
new-format backup may be restored through the normal validated flow; this app does not convert old profiles or
old backups. The SPEC defines the first-run choices and the separate local/cloud scopes.

Before cloud reset, warn that every device must update or stop using the old app. Publish and verify a reset
marker that existing 0.4.x clients recognize, then create the new isolated dataset and initialize it. Persist exact
old file IDs for cleanup; never run an unfiltered delete-all loop after new data exists. A legacy marker stops
normal old-client sync, but does **not** prevent an old client from explicitly running its own reset/overwrite
command, nor revoke a deletion request already in flight.

If the dataset disappears, keep local data and enter a recoverable cloud-data-missing state. Check for a new reset
or generation and offer an explicit, previewed recovery from local data. Do not automatically republish: a local
replica may lack purge decisions or uncached history, and disappearance may be an intentional reset. Recovery
creates a new generation with declared coverage, rather than pretending all old cloud history was recovered.

### 7. State capacity and backup consequences honestly

Normal work must not scale with historical bodies. This does not promise unlimited storage, constant provider
latency, or instantaneous deletion/export of arbitrary bytes. Drive documents a 500,000-direct-child folder limit
and a 500-million account-created-item limit; app-data applicability needs isolated verification. Per-note folders
spread total history but do not solve one extremely hot note or the account limit.

The initial backup contract remains self-contained and bounded by the existing 20,000-entry / 128 MiB expanded
ZIP limits, with explicit history coverage and an early, non-destructive capacity failure. A complete export must
fetch all retained history; a current-state-only export is a separate explicit choice, never the automatic fallback.
Automatic backup must report failure rather than silently narrowing scope. Supporting complete exports above
those limits needs a separately reviewed streaming/container change. See SPEC-010 for the initial behavior and
PLAN-011 for the capacity gate; this draft does not claim million-version complete backup support.

### Relationship to existing decisions

These are proposed replacement boundaries; implemented contracts remain in force.

| Existing contract | Proposed replacement | Retained boundary |
|---|---|---|
| ADR-011 / SPEC-004 | Current heads independent of complete historical ancestry | UUIDs, strict validation, explicit conflicts |
| ADR-012 / SPEC-004 | Filtered checkpoint/tail discovery and collection | Account-bound transport, hashes, durable file reservations |
| ADR-013 / SPEC-002 / ADR-038 | Explicit history coverage and purge-aware recovery | Self-contained backup, encryption, validation; bounded ZIP initially |
| ADR-053 / ADR-054 / SPEC-008 | Isolated dataset reset and readiness before old cleanup completes | Prepare/ready, deterministic starter, resumable journal |
| ADR-009 / ADR-015 / native contracts | Record-level transactions and paged reads | One local writer, protected storage, restricted bridge |
| ADR-051 / SPEC-007 | Explicit incompatible layout within V1 | No migration, no silent destruction |
| ADR-061 | Embedded unsaved baseline and Save as copy after permanent purge | Device-only unsaved work |

## Consequences

- Current-data work can be independent of history volume. Performance, concurrency and provider acceptance remain
  unverified; proposed budgets are not measurements.
- UUID causality avoids writer lifecycle machinery, with conservative conflicts when evidence has been discarded.
- Checkpoints temporarily duplicate current content, and publication receipts add small metadata files and requests.
  Permanent deletion must account for those copies and receipt races.
- History, purge evidence and attachment copies consume storage. No automatic version retention means no automatic
  upper storage bound. Physical cleanup and complete export are cancellable/resumable background work; approval
  of that qualification to the user's speed requirement remains explicit in SPEC-010 Q04.
- The next format boundary is deliberately incompatible with old local/cloud test data. No migration or currently
  approved release version follows from this proposal.

## Alternatives Considered

| Alternative | Reason not selected |
|---|---|
| Keep all ancestors on startup and add deletion UI | Still scales with history and breaks ancestry when bodies disappear |
| Unbounded incremental chain | A new device eventually replays years of changes |
| Differential since last full snapshot | Repeats changed content and grows until another full snapshot |
| One mutable latest dataset file | No established cross-device CAS; overwrites risk lost branches |
| Dotted version vectors | Extra incarnation and retirement complexity; no required use case established |
| Separate history packs and transport bodies | Duplicate writes and additional indexing/deletion protocols |
| Automatic per-version retention | Explicitly excluded by the user |
| Drive-native file revisions | Does not supply the application's history, conflicts or portable recovery contract |

## References

- [SPEC-010](../specs/010-dataset-checkpoints-and-deletable-history.md),
  [PLAN-011](../plans/011-dataset-checkpoints-and-deletable-history.md),
  [evidence and limits](../research/2026-11-01-drive-dataset-checkpoints-and-deletion.md)
- [SPEC-004](../specs/004-revision-graph-and-file-sync.md),
  [SPEC-002](../specs/002-portable-backup-and-restore.md),
  [SPEC-008](../specs/008-workspace-initialization.md)
- [ADR-051](051-schema-evolution-and-atomic-migrations.md),
  [ADR-061](061-unsaved-changes-instead-of-drafts.md)
