# Drive vault checkpoints and deletion: evidence and limits

Date consulted: 2026-11-01. This is research for proposed
[ADR-062](../decisions/062-vault-checkpoints-and-deletable-history.md),
[SPEC-010](../specs/010-vault-checkpoints-and-deletable-history.md) and
[PLAN-011](../plans/011-vault-checkpoints-and-deletable-history.md).
Only repository reads and public documentation were inspected. No test account, live vault, deletion or performance
experiment was used. The confirmed product requirements belong to SPEC-010, not this research record.

## Repository evidence

| Location | Observed behavior | Implication |
|---|---|---|
| [FileSync](../../src/sources/file-sync.js), `#fullScan` / `#receive` | Lists all descriptors, reads revisions and attachment bytes, then builds the current projection | A new device pays for historical data as well as current content |
| [RevisionGraph](../../src/sources/revisions.js), `analysisSteps` | A revision is complete only when every ancestor is complete | Simply deleting an old payload would make its descendants pending |
| [Workspace](../../src/core/workspace.js), `#commit` | Copies the state, including revisions, and persists another complete copy | History also affects ordinary local commits |
| [NativeStorage](../../src/storage/native.js), `#save` | Serializes the entire state and transfers it through the native bridge | Changing only the Drive reader cannot remove the local cost |
| [IndexedDbStorage](../../src/storage/indexed-db.js), `#save` | Replaces a complete workspace record | Browser persistence needs the same separation |
| [Drive adapter](../../src/sources/google-drive.js), `listFiles` / `listFileIds` | Normal listing requests all non-trashed app-data files; reset listing can read IDs without decoding payloads | Metadata-only legacy cleanup is possible; normal discovery needs a narrower contract |
| [Source reset](../../src/sources/source-reset.js) | Journals marker, clearing and initialization stages | Preserve recoverable destructive work; do not copy the full-scan prerequisite into routine new-vault startup |
| [Backup contract](../specs/002-portable-backup-and-restore.md) | Known-local-data, all known history, strict ZIP limits and complete attachment checks | Lazy history changes what a new device knows; backup coverage must become explicit |

These observations establish dependency on history, not a measured latency or supported maximum vault size.

## External evidence

- Drive supports searching private `appProperties` and selecting response fields. This can separate current objects,
  history and generations in a query. It does not establish a query-latency guarantee or a unique key for a file name.
  [Custom properties](https://developers.google.com/workspace/drive/api/guides/properties),
  [file search](https://developers.google.com/workspace/drive/api/guides/search-files).
- `files.list` is paginated; an invalid page token requires restarting the listing. Adding or removing items can
  change expected results. A page boundary is not an application transaction or proof that a checkpoint is complete.
  [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list).
- `changes.list` supports `spaces`, but has no `q` or app-property filter. Its documented page tokens do not expire.
  A client can still need recovery after a rejected token, lost local cursor or excessive backlog. Old history cleanup
  can create feed traffic even when its files are excluded from current-state discovery.
  [changes.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list).
- Drive batch requests allow up to 100 calls, count each inner call toward usage, and do not support media upload or
  download. Thus one content GET per note cannot be turned into one bulk content download by using that endpoint.
  [Performance and batching](https://developers.google.com/workspace/drive/api/guides/performance).
- App-data files are private to the app; they cannot be trashed, shared or moved between spaces. The product's Trash
  must therefore be its own logical state, followed by permanent API deletion.
  [Application data](https://developers.google.com/workspace/drive/api/guides/appdata).
- `files.delete` permanently removes the target. For a folder it also deletes descendants owned by the user.
  A note-owned folder is a possible cleanup optimization, but app-data hierarchy behavior under concurrent upload,
  interruption and large deletions has not been tested here; the proposal does not rely on constant-time cascade
  deletion. [files.delete](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete).
- Pre-generated file IDs allow a retry to use the same ID; a repeated successful create returns 409. The existing
  byte/digest read-back rule remains necessary. This is not a distributed lock for independently allocated IDs.
  [Upload retries](https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files).
- Updating a binary file can leave Drive-managed content revisions. Removing a note from its newest body alone
  does not establish removal of older copies. Immutable data chunks that are deleted as whole files avoid depending
  on Drive revision retention for application history.
  [File revisions](https://developers.google.com/workspace/drive/api/guides/manage-revisions).

## Terminology and design inferences

Incremental backup records changes since the previous backup; differential backup accumulates changes since the
last full backup. A synthetic full assembles a new full image from an existing backup chain. These explain the
proposed checkpoint model, but none supplies multi-writer synchronization or deletion semantics by itself.
[Backup comparison](https://aws.amazon.com/compare/the-difference-between-incremental-differential-and-other-backups/),
[synthetic full](https://helpcenter.veeam.com/docs/vbr/userguide/synthetic_full_hiw_hv.html).

The proposal infers that current-state chunks plus bounded deltas can remove application work proportional to all
history. Provider latency, concurrent checkpoint discovery, causal-summary size, deletion fencing and attachment
ownership still need model tests and isolated real-Drive probes. No portable conditional-update primitive or
multi-file transaction has been established for this application's five adapters; the design must not assume one.
An app without a continuously running executor cannot promise physical cleanup at an exact wall-clock deadline
while all devices are off. These are implementation constraints, not evidence that a particular new protocol works.
