# Drive dataset checkpoints and deletion: evidence and limits

Date consulted: 2026-11-01. Supports proposed
[ADR-062](../decisions/062-dataset-checkpoints-and-deletable-history.md),
[SPEC-010](../specs/010-dataset-checkpoints-and-deletable-history.md) and
[PLAN-011](../plans/011-dataset-checkpoints-and-deletable-history.md).
Repository code and public documentation were inspected. The timings below came from the external review supplied
by the maintainer; they were not independently rerun here. No live account or deletion experiment was performed.
Confirmed product requirements belong to SPEC-010; this document distinguishes evidence from design inference.

## Pre-change repository evidence

| Location | Observed behavior | Implication |
|---|---|---|
| [FileSync](../../src/sources/file-sync.js), `#fullScan` / `#receive` | Lists all descriptors and reads revision/attachment bodies before projection | New devices pay for history and attachment bytes |
| [RevisionGraph](../../src/sources/revisions.js), `analysisSteps` | Completeness requires complete ancestors | Removing historical bodies alone breaks the current model |
| [Workspace](../../src/core/workspace.js), `#commit` | Copies state including revisions, projects, persists another copy | Local mutations also depend on history |
| [NativeStorage](../../src/storage/native.js), `#save` | Serializes the complete state through the bridge | Cloud-only optimization cannot fix local serialization |
| [IndexedDbStorage](../../src/storage/indexed-db.js), `#save` | Replaces a complete workspace record | Browser storage needs record-level changes too |
| [Drive adapter](../../src/sources/google-drive.js), `listFileIds` | `spaces=appDataFolder`, `q=trashed = false`; collects IDs without format filtering | Old reset can delete new-format data too |
| [Source reset](../../src/sources/source-reset.js), `guard` and reset loop | Writes a legacy reset marker; stops when a new marker supersedes it; otherwise deletes every listed ID except its own marker | Reuse the fence to stop normal old sync, but not as protection against an old user starting another reset |
| [FileSync](../../src/sources/file-sync.js), reset/generation checks | A changed reset set raises a source-reset condition | The new app can publish the exact existing reset envelope as a compatibility fence |
| [Source reset](../../src/sources/source-reset.js), deletion loop | Guard is before a pass, not a revocation of each already-sent delete | An in-flight old reset can still damage new files; new clients need explicit recovery |
| [Backup contract](../specs/002-portable-backup-and-restore.md) | Complete known-local data and history with strict ZIP/entry/attachment limits | Lazy history needs explicit coverage; current limits do not support arbitrary complete exports |

These observations explain dependencies and failure modes; they do not prove the proposed new protocol.

## Supplied local performance baseline

Source: Claude's read-only review pasted by the maintainer on 2026-11-01. The reviewer described these as **JS-only**
measurements. No benchmark script, machine, runtime version, repetition count, percentile or cold/warm methodology
was supplied. Preserve that limitation rather than presenting the numbers as independently reproduced results.

| Fixture | Historical revisions | Open | Type one character | Save |
|---|---:|---:|---:|---:|
| 2,000 notes x 10 versions | 20,000 | 0.75 s | 65 ms | 96 ms |
| 5,000 notes x 20 versions | 100,000 | 3.9 s | 364 ms | 503 ms |

These are starting comparisons for SPEC VC01/VC02 and motivate the independent local-storage track. They exclude
native bridge/database, full application startup and Drive/network cost. Both current note count and history grow
between the two fixtures, so the table does **not** isolate history as the only cause or establish a scaling law.
Reproduce with a recorded harness, then fix current note count/bytes while varying history and report p50/p95,
records touched, allocations, serialization/bridge bytes and native I/O separately. Do not use these observations
as production performance targets or as evidence for the new implementation.

## Implementation component measurements, 2026-11-02

These author-run measurements replace the missing reproducible baseline for the current implementation; they do
not reproduce the external review's unknown machine or justify a direct speedup ratio. The host reports Apple M6,
12 CPU cores, 16 GiB memory, macOS 27.0.1 / Darwin 27.0.0 arm64. Node is 26.13.0. Browser engines are Chromium
153.0.8010.12 and WebKit 26.6. Builds/tests were not run concurrently with the timed component passes.

[The browser harness](../../scripts/testing/dataset-performance-probe.mjs) creates isolated actual IndexedDB
records, seeds full current envelopes and materialized note history, and uses the production current Workspace
and record adapter. Current text is 128 ASCII characters plus a note number, with no attachments. Each fixture
gets two warmups followed by 12 samples. Timings include record serialization and strict durable IndexedDB
transactions; open includes current loading/projection. Typing times `saveDraft` after constructing the changed
draft; saving times `commitDraft`; search includes the current working snapshot. Fixture setup, application DOM,
layout rendering, network and native WebView dispatch are excluded. Twelve samples are a small component sample,
not a production latency SLA; p95 is the slowest measured sample.

| Engine | Current notes | Retained note versions | Open p50/p95 ms | Type p50/p95 ms | Save p50/p95 ms | Search p50/p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| chromium | 2,000 | 20,000 | 106.6 / 113.9 | 0.6 / 0.7 | 13.1 / 13.9 | 2 / 2.1 |
| chromium | 2,000 | 100,000 | 102.9 / 107.9 | 0.8 / 9 | 13.4 / 24.1 | 2 / 2.4 |
| chromium | 5,000 | 100,000 | 269.4 / 274.2 | 0.7 / 0.7 | 32.7 / 33.4 | 4.9 / 5.1 |
| webkit | 2,000 | 20,000 | 149 / 152 | 2 / 4 | 22 / 23 | 4 / 4 |
| webkit | 2,000 | 100,000 | 151 / 152 | 2 / 4 | 21 / 23 | 4 / 4 |
| webkit | 5,000 | 100,000 | 378 / 383 | 5 / 6 | 53 / 58 | 9 / 11 |

All measured operations read **zero history records**. Open reads 2,008 or 5,008 current/meta rows. Typing writes
two rows with at most 1,188 serialized transaction bytes; save touches five rows with at most 2,342 bytes. Those
counts stay fixed when only H grows. An additional one-row maintenance journal commit queued with typing gives
p50/p95 of 0.8/6.9 ms in Chromium and 1/2 ms in WebKit at 2,000 current notes / 100,000 versions. This measures
local journal contention only, not a slow Google request or full purge worker.

A separate attempt to materialize **1,000,000 local note versions** in the isolated Chromium context failed with
`QuotaExceededError` during setup. There is no passing million-row local timing claim or inferred universal quota
threshold. The harness retains partial reports on failure. The application now translates storage quota failures
into a specific recovery message; it does not delete histories automatically. Synthetic million-history protocol
tests establish bounded dependency/query counts, not actual local or Drive storage capacity.

[The Apple component harness](../../scripts/testing/record_performance_probe.py) compiles the production
`FleetDatabase`/`FleetProtocol` with Swift 6.4.2, Swift 5 language mode and `-O`. It uses disposable profiles and a
synthetic AES-GCM key, 2,000 current rows, 128-character text values, two warmups and 12 samples. It measures JSON
encoding, transfer staging, encryption and SQLite separately from JS/WebKit. Open closes/reopens the database and
pages all 2,000 current rows. Draft/save are two/four-row storage transactions, not full Workspace operations.

| Native retained rows | Current open p50/p95 ms | Two-row draft commit p50/p95 ms | Four-row save commit p50/p95 ms |
|---|---:|---:|---:|
| 20,000 | 38.80 / 39.26 | 0.33 / 0.43 | 0.38 / 0.41 |
| 100,000 | 39.04 / 39.62 | 0.34 / 0.37 | 0.39 / 0.53 |

Native current loading returns approximately 561 KiB. Draft/save transaction envelopes remain below 731 / 1,353
bytes for these fixtures. Installed WebView bridge latency, native UI interaction, real-device power-loss recovery
and Google latency remain unmeasured. JSON outputs belong in ignored `build/`, while this section owns the durable
method and results. Re-run with the documented commands rather than treating these figures as targets.

## Official provider evidence

- Private `appProperties` support indexed query expressions. Drive documents limits including 30 private properties
  per app and a 124-byte UTF-8 key-plus-value limit per property. Keep only small routing identities/digests in them,
  not head/coverage lists. This does not promise unique names or bounded server-side query latency.
  [Custom properties](https://developers.google.com/workspace/drive/api/guides/properties),
  [file search](https://developers.google.com/workspace/drive/api/guides/search-files).
- `files.list` is paginated and can return partial/empty pages before completion; changes to files can affect the
  result and invalid page tokens require restarting. Listing is not a multi-file snapshot.
  [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list).
- `changes.list` has `spaces` but no `q`/app-property filter. Tokens are documented not to expire, but a large backlog
  still needs a bounded current-reconciliation path. Do not assume every intermediate state is preserved in the feed.
  [changes.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list),
  [track changes](https://developers.google.com/workspace/drive/api/guides/manage-changes).
- Batch requests allow at most 100 calls, each still counts individually, and media upload/download is unsupported.
  Per-note media GETs are not transformed into a single bulk body read by that endpoint.
  [Performance and batching](https://developers.google.com/workspace/drive/api/guides/performance).
- App-data files/folders cannot be shared, trashed or moved between spaces. Logical Trash must be an application
  state followed by permanent deletion. Hierarchy behavior and cascade races still require app-data-specific probes.
  [Application data](https://developers.google.com/workspace/drive/api/guides/appdata).
- `files.delete` permanently deletes a file and, for a folder, descendants owned by the user. It does not delete
  copies in a separate current-checkpoint folder or establish atomicity against later uploads.
  [files.delete](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete).
- Generated file IDs let a retry reuse an ID, with 409 for an already successful create. This is replay support,
  not a distributed lock; uncertain outcomes still need read-back and generation/retirement checks.
  [Upload retries](https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files).
- Binary-file updates can retain provider-managed content revisions. Deleting immutable files avoids relying on
  provider revision retention to establish removal of an old application payload.
  [File revisions](https://developers.google.com/workspace/drive/api/guides/manage-revisions).

### Item limits and test shapes

Google documents **500,000 direct children per My Drive folder** (the My Drive root is exempt), and **500 million
items created by an account**. Descendants in subfolders do not count as direct children of their ancestors.
These sources describe general/My Drive limits, not a verified exemption or exact enforcement rule for this app's
`appDataFolder`. Do not assume the special app-data root inherits the My Drive root exemption.
[Folder and item limits](https://developers.google.com/workspace/drive/api/guides/folder#file_and_folder_limits),
[capacity errors](https://developers.google.com/workspace/drive/api/guides/handle-errors#numChildrenInNonRootLimitExceeded).

Per-note folders are therefore a useful proposal: a million versions spread over many notes need not be a million
direct children. One note with 500,000 versions, many attachments, too many note folders or growing purge buckets
can still hit a limit, as can total account storage/items. A million-version synthetic test is not a claim that
one flat app-data folder or one note can hold that fixture. SPEC Q07 covers real applicability, conservative
supported ceilings, metadata-count maintenance, error handling and any later folder partitioning. Do not add an
unreviewed history pack system merely to avoid acknowledging finite capacity.

Drive API quotas and backend throttling also vary by project/account and must be checked for the actual test
project. No fixed request throughput is inferred from a synthetic provider.
[Usage limits](https://developers.google.com/workspace/drive/api/guides/limits).

## Model and scope inferences

Incremental backup captures changes since the previous backup; differential captures changes since the last full
backup. A synthetic full assembles a full image from existing backup data. Those are useful analogies for current
checkpoints, not a solution to multi-writer publication or purge races.
[Backup comparison](https://aws.amazon.com/compare/the-difference-between-incremental-differential-and-other-backups/),
[synthetic full](https://helpcenter.veeam.com/docs/vbr/userguide/synthetic_full_hiw_hv.html).

The revised candidate retains UUID parents, uses a single revision body plus a small current publication receipt,
and stores full current shard checkpoints without shared chunks. That removes DVV incarnation management,
duplicate history bodies and pack indexes. It still needs proof of publication visibility, captured coverage,
concurrent retirement, orphan/late publication handling and bounded progress. Conservative unknown-parent
conflicts are a deliberate correctness tradeoff, not a claim that the simplified graph knows every ancestor.

No per-version retention means retained-note history can grow indefinitely until capacity is reached or a user
removes it. Initial complete ZIP export remains bounded; current-only export must be explicitly chosen. Manual
Clear this note's history is a planned pressure valve, not permission to expire versions automatically. Remote
note-owned attachments also duplicate bytes when a note is copied. These are product costs requiring clear scope.

The legacy fence mitigates old normal sync but cannot revoke old destructive commands sharing the same grant.
Likewise, disappearing cloud files do not prove accidental loss: automatic republishing could reverse a reset or
purge from a more current device. Explicit coverage-aware recovery is the selected proposal. Documentation alone does not validate protocol safety. The isolated implementation measurements above do not
validate provider latency, cascade behavior or real-account deletion.
