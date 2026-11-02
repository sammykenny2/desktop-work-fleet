# SPEC-010: Dataset checkpoints and deletable note history

## Metadata

| Field | Value |
|---|---|
| Status | Approved for implementation; remote acceptance remains subject to proof gates |
| Owner | Project maintainer |
| Reviewer | Further review to be arranged by the maintainer |
| Date | 2026-11-01 |
| Decision | [ADR-062](../decisions/062-dataset-checkpoints-and-deletable-history.md), Accepted direction |
| Plan | [PLAN-011](../plans/011-dataset-checkpoints-and-deletable-history.md), In progress |

## Summary and scope

A new device reads current checkpoints and a small recent tail. The immutable revision file used by that tail
also serves as history in a per-note folder. Checkpointing removes the tail's small publication references, not
history. UUID parents preserve known causality; unknown ancestry produces a conservative conflict. A permanent
note deletion publishes a content-free barrier before cleaning up history, attachments and checkpoint copies.

The approved minimum delivery is record-level local storage, checkpoint bootstrap, explicit old-format reset,
Delete forever and Empty Trash, with backup/restore integration sufficient to keep those operations safe.
Automatic Trash expiry, selective version deletion, packs and writer vectors are outside this delivery.
Clear this note's history is the first follow-up capacity feature. No runtime behavior is implemented by this SPEC.

### Confirmed user requirements

| ID | Requirement |
|---|---|
| U01 | Remove permanent inability to delete note-version content; substantial persistence redesign is acceptable |
| U02 | Do not migrate old test data; let the new app explicitly reset old Work Fleet Google data |
| U03 | New environments joining accounts with large history must become usable efficiently |
| U04 | Growing history must not slow ordinary actions; restoring a very old version may take longer |
| U05 | Future expiry applies to the whole note after entering Trash, not retention of each version |
| U06 | Prepare ADR/SPEC/PLAN for review before implementation |

These requirements do not imply unlimited Drive space or unlimited backup size. History of a retained note can
keep growing. Full export, legacy enumeration and physical cleanup necessarily cost their bytes/items; proposing
responsive foreground UI plus background completion is the accepted qualification to U04 (Q04).

### Accepted implementation defaults

| ID | Choice |
|---|---|
| D01 | One full-value immutable revision body, a small current publication reference, and independent full current checkpoints |
| D02 | UUID revisions and explicit parents; no DVV, writer incarnation or all-history ancestry traversal |
| D03 | A verified note purge is terminal for its identity, including an unseen concurrent restore; preserve unpublished work for Save as copy |
| D04 | MVP manual Delete forever for trashed notes and preview-bound Empty Trash; no automatic expiry yet |
| D05 | Retain only `trashedAt` and `trashEpisode` for future expiry; no deadline, policy revision or cloud-time anchor yet |
| D06 | New dataset readiness can precede completion of the exact old-data cleanup, with separate visible progress |
| D07 | Remote attachments are note-owned; Save as copy duplicates attachment uploads/storage across notes |
| D08 | Lazy history and attachment bytes; unsaved edits include their baseline content locally |
| D09 | Cloud disappearance is recoverable but does not automatically authorize republishing local data |

### Required invariants

- No acknowledged local edit is lost when network publication fails. One local transaction changes the affected
  entity, unsaved record, references and outbox. No full-history serialization or projection rebuild is permitted.
- No content winner is chosen by timestamp, filename or device ID. Concurrent heads remain explicit.
- Current activation, applicable purge decisions and the feed cursor commit atomically in the local store.
- Every request/result/journal is account-, dataset- and session-bound. A stale job cannot relabel its outbox or
  retarget a delete into a newer dataset.
- Cloud content is immutable. Replay reserves the same revision, operation and file IDs before the request;
  identical replay is idempotent and differing bytes under one identity fail validation.
- Missing files are not deletion authority. Purge requires a validated marker; unexpected absence triggers recovery.
- Native typed operations preserve protected storage, restricted bridges and durable acknowledgements on all five
  native hosts and the browser. Product wording uses the en/zh-TW catalogs, not protocol identifiers.

## Local transaction boundary

[The typed contract](../../contracts/storage.d.ts) separates seven indexed collections: `meta`, `current`,
`history`, `draft`, `outbox`, `control` and `job`. Rows have an account-local key, optional entity index (empty
string when not applicable), local commit ordinal and JSON value. The Workspace-specific value schemas and
activation still belong to Phase 1A; a storage primitive accepting a row is not proof of a valid note or checkpoint.

A `work-fleet-record-transaction` V1 envelope carries a random commit UUID, profile, next revision and at most
512 distinct puts/deletes/attachment deletions. Optional `attachmentDeletes` contains unique SHA-256 IDs;
byte deletion shares the row transaction, rollback and exact-replay receipt. It is at most 8 MiB; a row is at most 8 MiB minus 1 KiB for paging overhead. Revision
zero requires an empty profile; later writes compare the expected local revision. History IDs cannot be replaced
with different entity/content, and identical history replay preserves the original position. This local CAS is
provided by IndexedDB/SQLite; it does not imply that Google Drive provides CAS.

Changed rows, verified attachment bytes and the small `work-fleet-local-records` receipt commit together. Up to
512 attachments, individually bounded by 25 MiB and totaling at most 128 MiB, may accompany a transaction; native staging also applies its
existing aggregate capacity limit. The receipt contains the exact transaction digest and UUID. If an acknowledgement
is lost, equality of the revision alone cannot establish success. Replaying the exact acknowledged transaction
returns its receipt, consumes replay staging, and does not apply extra attachment uploads.

Paged reads select a collection and optional entity, default to descending `(ordinal, key)` order, and return at most 100 rows and
8 MiB. A cursor names the last returned row. Each page checks the caller's expected local revision, so a caller
must restart a read if intervening work changes its boundary; there is no silently mixed snapshot.
An explicit closed `order: asc` selector uses the same index in reverse to publish pending revisions oldest first.
It does not accept caller-provided sorting expressions. Bulk current activation can retain the existing history
namespace while staging current rows and the pending queue; it never copies historical bodies into the new view.
The closed `keysOnly: true` projection returns only collection, key and ordinal. IndexedDB uses a key cursor;
SQLite does not select or decrypt payloads. History cleanup and abandoned-generation collection use this projection
in bounded pages. Indexed, content-free owner/reference rows protect attachment bytes still used by another note
or a preserved unsaved draft. Current-view controls activate atomically with the Workspace pointer; replaced views
and abandoned generations have durable cleanup jobs, rather than unbounded synchronous deletion during save.

Native rows remain protected with the host's existing encryption and owner/session boundary. The browser uses a
separate `work-fleet-records-v1` database, with entries, receipts and attachments in one transaction. Old workspace
presence is detected through metadata only and initial creation is refused until an explicit discard flow has
handled it. These primitives do not convert old data or activate themselves in the current application.

## Concrete candidate protocol

This section is the object of Phase 1 proof work. It specifies a candidate, not a claim that provider races have
already passed. Dataset JSON envelopes use `schemaVersion: 1`; the legacy reset fence retains `schema: 1`. The new discriminator is `work-fleet-dataset`; legacy
`work-fleet-file` is not interchangeable with it. Names below abbreviate UUIDs for readability; real identifiers
are full random UUIDs and Drive file IDs. Names are labels, never unique lookup keys.

### File layout and metadata

```text
appDataFolder/
  work-fleet-v1-reset-<digest>.json       old-format fence; deliberately outside the new root
  dataset-d7/                           new dataset root, with its own reserved Drive ID
    dataset-d7.json                     prepare descriptor: root IDs, source fence, format, shard rule
    ready-d7.json                       initialization receipt; references the verified initial state
    notes/
      note-n42/                        reserved folder ID stays fixed for this note's lifetime
        revision-r17.json              one full revision; remains here after consolidation
        attachment-<sha256>.bin
    groups/
      group-g1/revision-gr3.json        same lazy revision boundary for groups
    current/
      shard-0/ ... shard-f/             fixed note partition: first hex digit of SHA-256(note UUID)
        change-r17.json                small receipt referencing revision-r17.json
        checkpoint-c9.json             self-contained current values and exact covered inputs
      shard-groups/                    current groups and flattened redirect summaries
    purges/
      bucket-0/ ... bucket-f/           same note partition; markers are outside note folders
        purge-n42-p8.json              identity/episode/operation only; no note content
```

The initializer reserves the dataset root and fixed folder IDs in its durable prepare plan. New notes reserve
one folder ID before upload; retries/clones made after that reservation reuse it, not another folder found by name. A genuinely new
note/copy gets a new UUID. All later creates verify the active dataset and use those recorded parents.
Offline edits cannot reserve Drive IDs. Clones made before reservation may independently reserve duplicate
folders for the same entity; all verified owned folders remain discoverable by entity, with a bounded ceiling of
32. Identical revision UUIDs deduplicate by verified content, history includes every owned folder, and purge captures
all of them. Exceeding this ceiling preserves local work and pauses publication; no folder is discarded by age.

Every new-format object has `wfFormat=work-fleet-dataset`, `wfSchema=1`, `wfDataset=<UUID>` and `wfKind`.
Additional private properties are bounded strings, not lists of revisions or heads:

| `wfKind` | Additional properties | Immutable body / role |
|---|---|---|
| `dataset-root`, `folder` | `wfRole` for structural folders; `wfEntity` for a note/group folder | Folder metadata only |
| `dataset`, `ready` | `wfSha256` | Initialization plan / verified readiness; names exact root/fence IDs |
| `revision` | `wfEntity`, `wfRevision`, `wfSha256`, `wfShard` | Entity/revision UUID, parent UUIDs, full value; attachment descriptors |
| `attachment` | `wfEntity`, `wfSha256` | Note-owned bytes |
| `change` | `wfEntity`, `wfRevision`, `wfShard`, `wfSha256` | Dataset, operation UUID, revision file ID/digest/size, entity folder ID |
| `checkpoint` | `wfShard`, `wfSha256` | Dataset/shard, checkpoint UUID, explicit input file IDs/digests, full current heads/values/parents and current revision locators |
| `purge` | `wfEntity`, `wfShard`, `wfSha256` | Dataset, purge UUID, note UUID/folder ID, previewed Trash episode and heads |

The largest row uses eight properties; no property holds plaintext note data. Enforce Drive's property-size limits
in codecs. Metadata routes a read; strict envelope, identity, size and checksum validation establish usable content.
A checkpoint is one bounded payload, not a manifest over shared chunks. If it cannot fit the shard limit, keep
local changes and report capacity; do not silently split it using an unspecified reference/collection protocol.

### Concrete discovery queries

Use `spaces=appDataFolder`, `pageSize=100` initially, explicit response fields, full pagination, repeated-token
checks and `incompleteSearch` rejection. The examples show Drive `q` expressions before URL encoding. Validate
and escape all IDs. `D7`, `N42` and folder IDs stand for verified values, not user text.

```text
# Dataset discovery (metadata only; then verify the matching descriptor/ready pair):
trashed = false and appProperties has { key='wfFormat' and value='work-fleet-dataset' }
  and appProperties has { key='wfKind' and value='dataset' }

# Prove the declared dataset root is a direct app-data child, including when metadata returns a real parent ID:
trashed = false and 'appDataFolder' in parents
  and appProperties has { key='wfFormat' and value='work-fleet-dataset' }
  and appProperties has { key='wfDataset' and value='D7' }
  and appProperties has { key='wfKind' and value='dataset-root' }

# Current discovery for D7; never lists the revision bodies used only as history:
trashed = false and appProperties has { key='wfDataset' and value='D7' }
  and (appProperties has { key='wfKind' and value='checkpoint' }
       or appProperties has { key='wfKind' and value='change' })

# History page for the selected note, ordered by createdTime desc:
trashed = false and 'NOTE_FOLDER_ID' in parents
  and appProperties has { key='wfDataset' and value='D7' }
  and appProperties has { key='wfKind' and value='revision' }

# Targeted anti-resurrection check (bounded OR groups may check several current identities):
trashed = false and appProperties has { key='wfDataset' and value='D7' }
  and appProperties has { key='wfKind' and value='purge' }
  and appProperties has { key='wfEntity' and value='N42' }

# Legacy reset fences, including fences written by an old app:
trashed = false and appProperties has { key='wfKind' and value='reset' }
```

Request `id,name,mimeType,parents,size,createdTime,appProperties,sha256Checksum` plus pagination fields where
applicable. The dataset descriptor validates ancestry/parent IDs as well as tags; tags alone are not ownership.
Normal bootstrap queries applicable purges for its current identities, not all past markers. Outbox identities
get their own checks. Marker cardinality and query latency must be tested independently of history volume.

There is no mutable `latest.json`. More than one incompatible initialization/generation is a conflict requiring
recovery, not a choice of the greatest timestamp. An expected legacy fence is recorded in the descriptor; an
unexpected fence pauses publication for reset reconciliation.

### Save and publish

1. Atomically commit changed local records and a durable outbox entry containing new revision/operation UUIDs,
   observed parents and the full value. Before any remote create, durably reserve the exact folder, attachment,
   revision and receipt IDs in the publication job. Unsaved changes include their own baseline content.
2. Confirm the account, generation/fence, current heads and absence of a purge for the target. On a new/conflicting
   head, preserve the existing conflict barrier; on purge, keep distinct unpublished work for Save as copy.
3. Upload required note-owned attachments, then the revision in the note folder. Verify identity, size and digest.
   This is the only history-body upload. A body left before publication is recoverable upload work, not proof of
   a new current head; valid retained bodies may be shown in history without claiming current-sync completion.
4. Create `change-r17.json` with its already reserved file ID and verified revision descriptor. This small immutable
   receipt makes the change discoverable in the current query. Read back/verify before acknowledging cloud sync.
5. Recheck the generation and purge state after uncertain/in-flight completion. A late forbidden file never makes
   the old identity visible; journal cleanup and preserve unpublished work. Do not recreate a missing parent folder.

A transiently visible partial upload is not a valid receipt. Readers keep the last verified projection and retry
within their work budget. A lost create reply uses read-back, not a new operation. A 404 after an uncertain reply
requires current reconciliation before another create: retirement may have already consumed that receipt.
Late duplicate receipts must be deduplicated by revision ID and verified coverage, never counted as a new edit.

### Consolidate and retire

1. Choose one shard. Capture a concrete set of verified checkpoint and change files, with IDs and digests. Merge
   their current semantics; ignore a captured input explicitly covered by another captured checkpoint. Apply
   known parent relationships and relevant purge decisions. Keep every unproven/concurrent head.
2. Write `checkpoint-c9.json` with full current values/heads and those exact covered input IDs. It is independent
   of predecessor checkpoint payloads. Its input list is bounded by the captured tail/candidate budget, not all
   history. Group state includes current redirects rather than requiring historical group replay.
3. Verify the new checkpoint's bytes, coverage, required current revision/attachment descriptors and purge state.
   Do not acknowledge the consolidation or retire any input while the upload outcome is uncertain.
4. Delete only the captured change references and predecessor checkpoint files. Keep all revision bodies in their
   entity folders, including historical non-heads. Persist cleanup progress and accept validated already-gone IDs.
   Uncovered changes and concurrent checkpoints are untouched.
5. A follower may finish the same retirement from the verified successor. If that successor was itself retired,
   reacquire the current candidates; do not assume a missing successor is proof of coverage. Retirement never
   needs to walk an unbounded chain of predecessor checkpoints.

A checkpoint may suppress an input only when it records verified semantic coverage of that exact input; merely
mentioning another file is insufficient. Publication-order edges are acyclic: a checkpoint cannot cover an output
that did not yet exist when its inputs were captured. Concurrent outputs are retained until a later merge covers
both. This is the safety argument to test, including stale responses and overlapping retirement, not an assumed
Drive transaction. No shared-chunk reference counting, clock lease or CAS is used.

An interrupted cleanup leaves redundant current files, not missing history. Retired snapshots are deleted rather
than kept as a second historical archive. Orphan/partial publication cleanup must not delete a file that another
valid candidate still needs. Phase 1 must exercise that race before defining safe automatic orphan cleanup; the
MVP does not infer abandonment from age alone. Unresolved uploads/cleanup consume the admission budget.

### UUID causality without full ancestry

A checkpoint retains head revision IDs, their immediate parents, full values and revision locators. Current-tail
parent edges can prove transitive relationships while those edges are available. A new revision naming all
current heads as parents is a successor; naming a subset does not erase the remaining branches. An older known
ancestor is ignored, identical replay is deduplicated, and a branch without a proved relation remains concurrent.

After complete current reconciliation, a still-unknown parent is permitted as historical context. It does not
make the current value incomplete or require fetching its body. Example: a checkpoint has `r30 -> r29`, while an
offline edit is `r31 -> r4`; without evidence connecting those branches, keep `r30` and `r31`. Even a late ancestor
may therefore create a conservative conflict. Show the normal conflict UI, not a fabricated ordering.

Do not apply this rule to a missing *declared current input* or a malformed receipt; that is an integrity/recovery
problem. Cloning an installation replays unchanged queued UUIDs identically; independent new edits allocate fresh
UUIDs. Future version deletion can keep content-free identity markers without restoring mandatory ancestry loading.

### Bootstrap and long-offline reconciliation

1. Verify account and format using metadata; find the unique compatible dataset/ready pair and expected fence.
   Empty, incompatible and conflicting generations use the explicit first-run/recovery flows below.
2. Capture changes token `c0` **before** current discovery. List every current-query page, verify checkpoint/tail
   bodies, remove explicitly covered inputs and merge candidates. Fetch only revisions referenced by uncovered
   current changes, not the note-folder histories. Attachments remain metadata until opened/needed.
3. Check purge markers for the staged note identities and local outbox identities using bounded targeted queries.
4. Drain `changes.list` from `c0`. It has no app-property filter: account for irrelevant history cleanup events in
   the work budget. Add newly published current files and purge/reset decisions. A removed input requires either
   verified coverage in the staged set or a fresh current query; deletion alone is not proof that it was safe.
5. If a concurrently retired checkpoint disappears during its GET, reacquire current candidates for that shard.
   Do not download all history to repair the race. Verify every required current reference before activation.
6. At the returned end-of-feed boundary, atomically activate current state, applicable controls and the new token.
   An edit after that boundary remains in subsequent feed work. Revalidate the preserved local outbox before upload.

For a huge old feed, keep the old local state and start a new current reconciliation with its own token captured
before listing. Never jump the cursor to now without installing the corresponding verified current state.
If sustained writes exceed the budget, retain a verified usable local view with Sync pending, prioritize
consolidation and throttle this client's new cloud publication/cleanup. Do not loop invisibly or claim full sync.
Real-Drive progress under the supported write/concurrency profile is a release gate; arbitrary unbounded writers
or network outages cannot have a fixed latency guarantee.

## Four concrete scenarios

### A. Two devices checkpoint at the same time

`checkpoint-c0.json` contains note `n42` at `r10`. Device A publishes `revision-r11.json` (`parents=[r10]`)
and `change-r11.json`; B independently publishes `revision-r12.json` (`parents=[r10]`) and `change-r12.json`.
A captures `c0 + change-r11` into `checkpoint-ca.json`; B captures `c0 + change-r12` into `checkpoint-cb.json`.

Each verifies its own output before deleting its captured inputs. Neither covers `ca` or `cb`, so both outputs
survive. A reader unions their heads and shows `r11`/`r12` as a conflict. A later `checkpoint-cab.json` covers both
candidates and can retire both. `revision-r10.json`, `revision-r11.json` and `revision-r12.json` remain history.
If one compactor dies, its verified successor or still-unretired inputs remain usable; the other cannot delete
an uncovered edit. If a late stale candidate has less ancestry evidence, preserve an extra conflict, not less data.

### B. New device joins while a write and retirement happen

```mermaid
sequenceDiagram
  participant J as Joining device
  participant D as Drive
  participant W as Existing writer
  J->>D: getStartPageToken -> c0
  J->>D: list current (sees checkpoint-cab)
  W->>D: upload revision-r13 and change-r13
  W->>D: publish verified checkpoint-c13 covering cab + change-r13
  W->>D: delete covered cab and change-r13
  J->>D: GET cab (may be 404)
  J->>D: reconcile current candidates + changes since c0
  D-->>J: checkpoint-c13 / publication and removal events
  J->>J: verify current state, purges and cursor; activate atomically
```

If `change-r13.json` survives, the joiner applies it; if already consumed, it reads `checkpoint-c13.json`.
It cannot interpret the 404 as an empty note or finish with a skipped cursor. An event coalesced to removal is
handled by current reconciliation, not an assumption that every intermediate feed state will be available.

### C. Offline edit meets permanent deletion

A has `r13` and device-only unsaved text based on its embedded baseline. B moves `n42` to Trash episode `e7`,
then explicitly confirms Delete forever. B verifies `purge-n42-p8.json`, publishes a sanitized checkpoint,
and deletes `note-n42/` plus covered checkpoint copies.

A reconnects before uploading `revision-r14.json`. Its targeted purge check blocks publication and offers Save
as copy under new note `n99`, with new attachment ownership. If an upload had already started and arrives late,
all readers still exclude `n42`; the uploader/collector removes the stray file. The purge marker is retained
outside the deleted folder. No UI claims disconnected devices or already exported backups have been erased.

### D. Reset old 0.4.x data

The reset journal first captures old app-data file IDs, including `work-fleet-v1-revision-OLD.json`, through
metadata-only pages. It reserves a legacy-compatible marker and new dataset `d8`. It publishes
`work-fleet-v1-reset-NEW.json` with the exact old envelope below, then creates `dataset-d8/`, `dataset-d8.json`,
the deterministic initial group/checkpoint, and `ready-d8.json`. Cleanup deletes only the captured old IDs,
never a newly listed "everything except my marker" set.

```json
{"format":"work-fleet-reset","schema":1,"resetAt":"2026-11-01T00:00:00.000Z","initialization":"workspace-init-v1"}
```

The marker uses the existing `work-fleet-file` metadata (`wfSchema=1`, `wfKind=reset`, `wfSha256`) and remains
outside old cleanup. Existing clients observing a changed reset set stop their normal sync. They do not receive
a fake old-format ready receipt. An old user-initiated reset can nevertheless enumerate and delete `d8` too;
this is why updating/stopping all old devices is required and cloud-loss recovery is explicit.

## History, Trash and permanent removal

History reads the selected entity's folder in pages. Deduplicate by revision ID and refresh an invalidated page
cursor when files change; this is not a frozen transactional list. Once a selected file locator is known, its
full revision body needs one media GET, plus any independently requested attachments and control checks.
Cached local rows are labelled as cached coverage. Remote pages contain metadata entries, not eagerly fetched
revision bodies; displaying a cached page never establishes that a complete backup is available offline.
Restore creates a new UUID revision observing the previewed current heads; a stale preview must be refreshed.
No text-patch chain, pack rewrite or all-account history index is required.

MVP Trash fields are `trashedAt` and `trashEpisode`. Restore clears that episode and re-entry creates a new one.
Metadata edits do not reset it. There is no countdown, automatic expiry, time-authority policy or deadline queue
in this delivery. Archive keeps the existing editable behavior and never becomes eligible for purge merely by
being archived. A later expiry ADR must settle days, offline clocks, concurrent restore and policy changes.

Delete forever previews one trashed note/episode and its histories/attachments; Empty Trash previews an exact
set of note/episode pairs. A note already observed restored or with unresolved eligibility is excluded and the
preview refreshed. Under D03, a restore not observed before the purge commits loses to the terminal identity
barrier. This precedence requires Q03 approval; a Drive preflight query is not a lock against concurrent restore.

The durable cleanup procedure is:

1. Persist the previewed targets/reservations and publish/verify a content-free purge marker for each target.
   Marker commitment makes the identity invisible to current readers and blocks future ordinary saves/restores.
2. Stop this client's affected outbox/transfer work; retain distinct unpublished content in device-only recovery.
   Query the relevant current shard, including redundant/retiring checkpoints. Publish verified replacements
   preserving every non-purged head before deleting any snapshot containing the target.
3. Delete the exact note folder and owned descendants. Test app-data folder cascade separately; use a resumable
   metadata-only per-file fallback if necessary. Neither approach permits deleting the dataset/purge folder.
4. Reconcile the feed/current shard and targeted entity metadata to detect late files or snapshots; repeat cleanup
   in bounded slices. An in-flight publisher rechecks barriers, rejects its result and cleans its own late file.
   Partial/unresolved publications keep cleanup pending; age alone does not establish safe collection.
5. Invalidate this device's history, previews, undo/layout references and unreferenced attachment cache. Other
   devices do so when they reconnect. Keep purge markers for the dataset lifetime; do not compact away the last
   anti-resurrection evidence merely because every currently known device acknowledged.

The provider's closed `entity-data` query selects only note revision, attachment and note-folder metadata for
at most 20 identities in one dataset. Cleanup also accepts owned files with no remaining parent after a folder
was removed; these metadata records are not usable revision locators. It deletes bounded batches and repeats
from the first page, so deletion cannot invalidate a pagination cursor and skip remaining owned files. The
change feed uses the same ownership checks for late orphan uploads and reopens their cleanup jobs. A stale
uncommitted preview moves to review-needed state without blocking other confirmed notes in an Empty Trash job.

The UI distinguishes request pending, logical deletion committed with cloud cleanup pending, and cloud cleanup
verified through the last reconciled boundary. Those are necessary acknowledgements of a destructive operation,
not an expiry policy engine. A later stray upload reopens cleanup. No CAS-free client protocol can physically
prevent an already accepted remote request from completing later. It can reject that data and clean it up.

Clear this note's history is a follow-up manual command: preserve current/conflict heads, preview removal of
historical non-heads, and keep content-free deletion evidence. Selective Delete version follows the same rule.
Neither is enabled by this SPEC's MVP approval. Before implementation, specify the exact captured targets,
concurrent publication, backup restoration and local-cache handling; do not use a timestamp alone as authority
to delete unknown revisions. These commands are storage controls, not age-based per-version retention.

## First startup, reset and cloud loss

The new local discriminator is checked before building the old revision graph. Opening/signing in does not
convert, delete or upload the old profile. Present these localized choices with the verified account and separate
local/cloud scope; default to keeping data intact:

| Situation | Screen and available choices |
|---|---|
| Old local profile detected | Explain incompatibility and keep the profile unopened. Leave unchanged/close; open a compatible old app to export; or explicitly discard this local profile and start/rejoin with the new app |
| Old local profile, compatible new cloud dataset | After explicit local discard, join current cloud state; warn that unsynced old local edits are lost. Do not relabel the old outbox |
| Old local profile, old cloud data too | Local discard and cloud reset are separate confirmations. A compatible old app can export before either; this app cannot promise to read that old backup |
| Empty local profile, legacy cloud files | Offer Cancel/use compatible old app, or preview Reset old Google data. Do not download history to show this screen |
| Compatible new-format backup | Offer validated restore with coverage preview; unsupported old-format backup is preserved and rejected without conversion |
| Dataset/fence disappeared unexpectedly | Keep local data usable with sync paused; inspect reset/generation controls and show recovery choices, not an unrecoverable corruption screen |

Cloud reset stages are `capture exact old IDs -> publish legacy fence -> initialize isolated dataset -> ready ->
clean captured old IDs -> complete`. The capture is a streamed, durable metadata-only journal; it may take time
but does not block editing an already usable local view. The reset confirmation warns to update/stop every old
device, including devices with reset/Google-overwrite jobs. No compatible safety export is falsely required for
unreadable legacy data; for readable current data, existing safety-backup requirements still apply.

New data is never created below an old captured folder. Every deletion revalidates account, expected fence and
dataset, and is limited to the captured IDs. On a new fence/generation or loss of the reset's own marker, stop the
old job. Two competing initializers do not elect a winner by clock; show an initialization conflict and preserve
both plans for a previewed resolution. Followers verify readiness and do not independently create starter groups.
An initialized intentionally empty workspace remains empty. Old files created after the captured set are ignored
as incompatible and reported as residual legacy writes; do not widen deletion scope automatically. After captured
cleanup, a resumable metadata audit reads at most 100 entries per step, excludes new-format files/folders and the
active fence, and retains a warning when legacy leaves remain. Later bounded changes-feed observations persist
the same warning without downloading old bodies or starting a global scan.
The reset worker captures at most 100 metadata entries per durable page and deletes at most 20 captured leaf
files per step. Captured old fences are retired first after new readiness, allowing the new dataset to become
usable while content cleanup continues. Reset does not cascade-delete captured folders: a child can arrive after
an empty-folder check and Drive has no conditional empty-folder delete. Retain/count those obsolete containers;
all captured content files are still removed. The legacy flat layout has no such containers. Note purge has a
different, explicitly terminal whole-identity scope and may delete its owned folders and late descendants.

Old 0.4.x `resetSource` uses unfiltered `listFileIds`: it can delete **all** app data, not just old-format files.
The compatibility fence reduces ordinary old-client writes but is not an access-control boundary and cannot
cancel deletion requests already sent. New clients must detect their root/ready/fence loss and pause publication.

For cloud loss, first distinguish a newly observed reset/generation from unexpected absence. Offer Rejoin the
verified new dataset (with local unsynced-work preview), retain local data/export, or **Recover this local data to
Google** with an explicit coverage preview and a new generation. Never claim uncached history/attachments are
recoverable, or auto-republish identities whose purge records may have disappeared. After user confirmation,
recheck the remote state and use the normal initialization/reset protocol. Automatic recovery from local data
is intentionally not selected: absence cannot distinguish accident, deliberate reset and an incomplete replica.

## Backup and capacity contract

The initial export choices are **Complete retained history** (default) and an explicitly selected
**Current state only**. The latter is self-contained for current notes/conflicts, referenced attachments, groups,
unsaved work and layout; its manifest declares excluded history. A cached subset cannot claim complete history.
Existing encrypted/automatic backup and atomic restore guarantees remain; automatic backup does not silently
switch to the smaller mode. Backups are independent artifacts, not checkpoint chains.

The V1 manifest adds `coverage: { workspaceFormat: "work-fleet-workspace-current", mode }`, where `mode` is
`complete-retained-history` or `current-state-only`. The dataset application rejects archives without this
discriminator instead of converting them. The retained-record validator accepts unknown historical parent IDs
as ancestry boundaries, while still rejecting cycles, cross-entity parents and conflicting UUID contents.
Current-only exports omit undo/rebase edges that need excluded historical values; unsaved baseline content is
self-contained, and current note/conflict/draft attachment bytes remain required. Complete capture verifies every
owned history locator, including duplicate UUID copies, before deduplicating record contents.

For the initial container, keep the existing 20,000-entry / 128 MiB expanded-data limits and all other SPEC-002
validation limits. Preflight metadata/counts and enforce running byte limits during staging. On overflow, stop
without creating a valid-looking truncated backup, leave source data intact, and report which capacity was hit.
Offer a separate current-state export only through explicit selection; it too may exceed capacity. Preserve the
last good automatic backup and show a capacity failure. Do not advise deleting history as a prerequisite to
obtaining a complete backup. Supporting complete oversized exports requires a separately reviewed streaming or
segmented-container change, including encryption/restore on every host. The MVP does not support a million-version
complete ZIP; Q04 must approve that boundary or expand the implementation scope before delivery.

A complete export enumerates/fetches all retained history for a declared capture boundary in a background job.
Concurrent purge/reset cancels or restarts the affected capture; it cannot produce an artifact claiming a later
complete state with silently missing data. Ordinary merge/replace/history restore respects current purge markers.
Capture checks the local revision/generation and targeted purge decisions before hydration, after archive/encryption
validation, and immediately before publishing the artifact. Local typing during capture invalidates that attempt;
it does not freeze the editor or produce a mixed snapshot. An offline current-only export declares its restricted
coverage and checks known local barriers; it cannot establish fresh remote deletion knowledge. Restore rechecks the
previewed barriers and remaps purged identities and their revision/draft references to new UUIDs. Bulk local
replacement stages history and attachments under a new generation before one atomic activation pointer changes.
Cloud replacement stages the verified replacement locally first, with a saved safety-backup receipt, fresh entity/
revision identities and a captured outbox boundary. It uploads those immutable revision/attachment bodies before
publishing readiness, then places only the captured current heads in the 17 initial checkpoints. It creates no
per-history current receipt tail. Per-upload journals contain reserved file locators rather than another content
copy. The final seed acknowledgement and its completion control commit with outbox removal; a lost reply cannot
restart all history uploads. Edits made after the captured boundary stay queued for normal sync. Missing prepared
directories stop initialization after seeding begins; they are not recreated as an empty namespace. Large seeded
checkpoint bodies have separate temporary local rows, removed after durable readiness. Old-content cleanup then
continues independently of usable new current state.
Explicit recovery of purged content is previewed as new identities, with attachment copies. Full cloud replacement
is an explicit generation reset. Previously exported backups are not rewritten by purge.

Per-note folders avoid placing every account revision directly under one folder. They do not make storage
unlimited: one note can still approach the documented 500,000-child limit, and account-created items have a
500-million limit. App-data enforcement is unverified. Use a conservative supported per-folder ceiling of 100,000
items for initial tests, count folders/attachments/control files too, and handle provider capacity errors without
losing local edits. Exact production ceilings, headroom and metadata-count maintenance are Q07 gates. Do not scan
all history during each save to count it. Purge buckets themselves have finite capacity; targeted queries avoid
loading every marker at startup but do not remove that capacity cost.

## Work budgets and performance acceptance

N is current entities/conflicts, H is retained historical bodies, P is concurrent publishers, B is the tail budget,
and K is a requested history page. Required foreground work depends on N/current bytes/P/B, not H.

| Operation | Required boundary |
|---|---|
| New-device bootstrap / lost cursor | Current checkpoint bytes + bounded current tail + relevant purge checks; no all-history descriptor scan |
| Open/type/save/search/desktop operations | Affected or indexed current local records; no full-history copy, encryption, bridge transfer or graph rebuild |
| Ordinary sync | New current records, relevant controls and required attachments; no ancestry walk |
| Long-offline reconnect | Bounded feed replay or new verified current reconciliation; preserve pending edits |
| First history page / selected version | K entries in one note folder / one selected full body; no account-wide history walk |
| Consolidation | One current shard and exact recent inputs; no history scan or second history-body write |
| Purge submission / Empty Trash confirmation | Bounded commands over the previewed current targets; physical work proceeds separately |
| Complete export / legacy reset / physical cleanup | Volume-dependent background work with progress, cancellation/resume and foreground priority |

Starting engineering budgets for model/benchmark work, **not measured production promises**:

| Dimension | Initial candidate budget |
|---|---|
| Note shards | 16 plus one group shard, fixed by the dataset descriptor |
| Checkpoint body | 8 MiB hard codec bound per shard, including conflict heads and coverage |
| Tail admission | Consolidate at 64 current references/account or 4 MiB referenced revision bytes; pause new cloud publication at 128 / 8 MiB until maintenance makes progress |
| Candidate admission | Consolidate when a shard has two incomparable checkpoints; pause ordinary publication at eight. Finish each client's one journaled compaction before starting another; allow a consolidation output at the ceiling so eight incomparable candidates cannot deadlock |
| Feed catch-up | 1,000 events or 8 MiB metadata before switching to current reconciliation; no endless silent restart |
| History page | At most 100 descriptors, on demand |
| Supported-concurrency experiment | Up to eight simultaneous publishers; test late in-flight work above the admission threshold explicitly |

Admission checks are not distributed locks: already in-flight writers can overshoot. The model must derive a finite
overshoot bound for its concurrency profile and maintain usable verified local state under overload. Repeated
partial publications/failed cleanup consume capacity; stopping dependent publication is preferable to silently
turning the current catalog into history. Hard decoder/allocation bounds must include the tested overshoot.
Actual cold-bootstrap progress and absolute p50/p95 targets on named devices/network remain Q07 acceptance gates.

The current model admits 135 change receipts (127 already present plus eight in-flight publishers) and 16 checkpoint
candidates per shard (eight incomparable inputs plus eight simultaneous consolidation outputs), at most 151 captured
inputs for one checkpoint. It reserves up to 64 MiB of referenced tail bytes for eight in-flight 8 MiB revisions.
These are decoder ceilings for the stated experiment, not a real-Drive latency guarantee. In particular, repeated
stale/incomplete provider discovery is not evidence that new publication is admissible. Unknown outcomes retain
one exact journaled output; a missing output triggers current reconciliation, not deletion of its old inputs.
If later coverage is no longer provable, its local journal values remain conservative branches in a new verified
checkpoint, subject to terminal purge. An existing dirty output is sanitized before retirement can proceed.

Test fixed N/current bytes/conflicts/P with H = 10,000 / 100,000 / 1,000,000 spread across note folders. Separately
test a hot note and per-folder/account quota errors; a synthetic million-record fixture does not prove Drive can
store that shape. Measure listed descriptors, media requests, bytes, history reads, touched records, bridge bytes,
memory and latency. Independently vary purge-marker count, stale candidates and group history. The externally
supplied JS-only baseline in the research is comparison evidence, not a native/provider benchmark.

## Acceptance cases

These are required future cases, not passing tests.

| ID | Scenario | Required result |
|---|---|---|
| VC01 | Fixed current data, H from 10k to 1m | No historical bootstrap reads/listing; measured work follows current-data budgets |
| VC02 | Open/type/save/search with large local history | No whole-history mutation/bridge payload; report JS and native timings separately |
| VC03 | Join while writes/pages/retirement race, scenario B | No acknowledged current change omitted; cursor and verified state activate together |
| VC04 | Concurrent overlapping checkpoints, scenario A | Preserve both branches; retire only explicitly covered inputs |
| VC05 | Crash, partial upload or lost reply at each publish/delete | Same operation IDs, safe read-back, no duplicate edit or lost acknowledged content; orphan work stays bounded/pending |
| VC06 | Missing current dependency, bad digest or differing replay bytes | Keep last verified state; distinguish integrity recovery from authorized purge |
| VC07 | Huge/stale feed and sustained writers | Bounded reconciliation, preserved outbox, visible overload and demonstrated supported-profile progress |
| VC08 | Unknown parent after reconciliation | Preserve conservative conflict without fetching old ancestry or inventing causality |
| VC09 | Cloned install/restored outbox | Identical queued UUID replay; fresh independent edits; differing replay bytes rejected |
| VC10 | History first page and selected old-version restore | Entity-scoped page/direct body; stale preview rejected |
| VC11 | Clear-history or selective-version controls in MVP | Unavailable; no accidental implicit retention or unreviewed partial-deletion path |
| VC12 | Purge during unsaved edit, export or restore | Embedded baseline retained for explicit recovery; in-flight jobs revalidate/cancel |
| VC13 | Trash, restore, re-trash, unrelated metadata edit | Correct episode changes; no automatic timer/deadline behavior |
| VC14 | No clients running for days / device clock skew | MVP performs no automatic expiry; no false cloud-cleanup claim |
| VC15 | Two purgers and unseen restore | Approved terminal-identity rule, idempotent markers and explicit recovery of unpublished work |
| VC16 | Content in current/redundant snapshots and partial publication | Preserve other heads, remove all in-scope copies, leave unresolved races pending |
| VC17 | Save as copy and attachment cleanup | New remote ownership/upload, visible storage cost, no other note's bytes removed |
| VC18 | Offline note edit after purge, scenario C | No resurrection; Save as copy and late-upload cleanup |
| VC19 | Many purge markers, redundant snapshots, group history | Targeted/bounded startup; no substitute all-history metadata scan |
| VC20 | Old local/cloud format on first launch | Explicit choices and separate scopes; no automatic conversion, deletion or upload |
| VC21 | Legacy reset, old-client destructive reset, scenario D | Fence plus exact-ID cleanup; detect loss of new data, preserve local data and require previewed recovery |
| VC22 | Concurrent initialization, empty dataset, followers | Verified prepare/ready, deterministic starter; conflicting generations not arbitrarily elected |
| VC23 | Cold client complete/current-only export; capacity overflow | Honest coverage; hydrate declared data or fail intact, no silent fallback or partial valid artifact |
| VC24 | Purged identities in old backup / cloud disappearance | No implicit restoration; explicit new-identity/new-generation recovery with coverage preview |
| VC25 | Account switch, native commit failure, restart | Atomic local reconciliation, durable journals and account/session fencing |
| VC26 | Slow maintenance with active foreground work and provider limits | Foreground stays responsive; truthful progress, bounded backlog/backpressure, preserved edits |

## Review and proof gates

| ID | Remaining decision or evidence | Blocks |
|---|---|---|
| Q01 | Model and independently assess the concrete publication/discovery/retirement protocol above, especially partial uploads, coalesced removals, late replay, orphan cleanup and progress; then test Drive assumptions in an isolated authorized account | Remote implementation acceptance; not local record storage |
| Q02 | Validate UUID-parent projection and acceptable conservative-conflict behavior with old/unknown ancestry; prove no silent branch loss | Conflict codec/behavior acceptance; no DVV proposal remains |
| Q03 | Resolved by implementation approval: terminal purge versus unseen restore, MVP manual scope and explicit local recovery presentation | Destructive operations still need implementation acceptance |
| Q04 | Resolved by implementation approval: background bulk completion, complete/current-only export choices and initial bounded backup capacity | Measured performance and truthful backup coverage still require acceptance |
| Q05 | Resolved by implementation approval: old-profile choices, all-device warning, minor-release boundary and confirmed recovery from local data | No real reset, target version or publication authorized |
| Q06 | Later design only: Clear this note's history then selective deletion; separate ADR for automatic Trash expiry and any archive interaction change | Follow-up features only; not MVP |
| Q07 | Validate candidate budgets/overshoot, folder/property/quota behavior including appData applicability, supported hot-note capacity, and measured latency on named devices/network | Production capacity and performance acceptance |

## References

- [ADR-062](../decisions/062-dataset-checkpoints-and-deletable-history.md),
  [PLAN-011](../plans/011-dataset-checkpoints-and-deletable-history.md),
  [research and measurement provenance](../research/2026-11-01-drive-dataset-checkpoints-and-deletion.md)
- [SPEC-004](004-revision-graph-and-file-sync.md), [SPEC-002](002-portable-backup-and-restore.md),
  [SPEC-008](008-workspace-initialization.md): implemented contracts pending approved replacement
- [SPEC-007](007-schema-evolution-and-migrations.md),
  [ADR-061](../decisions/061-unsaved-changes-instead-of-drafts.md)
- [Testing](../testing.md), [Google setup](../google-setup.md), [security](../security-guidelines.md)
