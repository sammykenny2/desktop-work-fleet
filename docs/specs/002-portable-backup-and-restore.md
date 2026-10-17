# SPEC-002: Portable backup and safe restore for 1.0

## Metadata

| Field | Value |
|---|---|
| Status | Accepted technical contract. Current implementation and acceptance status is in [PROGRESS](../../PROGRESS.md); history and verification evidence are in the git history and [testing](../testing.md) |
| Owner | Project maintainer |
| Date | 2026-10-04; 2026-10-10 cloud overwrite; 2026-10-12 full local restore and two-way migration |
| Scope basis | SPEC-003 Q01–Q07: complete content, groups and layout, automatic and encrypted backups, three restores, five platforms |

## Summary

A backup is a file the user owns. It does not depend on the original Google account, on Drive file IDs or on the
original files still being in the cloud.
The shared core saves one committed local snapshot with all known revisions, drafts, groups, per-device layouts and
attachments.
Before a restore the whole file is validated and the target partition and the impact are previewed; after confirmation
the restore commits atomically. A backup is never treated as executable content.
[ADR-013](../decisions/013-complete-portable-backup.md) replaces the candidate design of ADR-005.
Manual, automatic and encrypted backups and the three restores all belong to 1.0. On 2026-10-10 a full Google
overwrite and the MSIX uninstall policy were also confirmed; see
[ADR-037](../decisions/037-msix-data-lifetime-and-google-backup-overwrite.md).
A finished container module does not mean that every feature is finished.

## Goals

- Changing devices, reinstalling or switching accounts still recovers all known data, keeping unfinished work and
  unsaved drafts.
- Markdown/checklists, attachments, completed/archived/deleted states and unknown JSON value extensions round-trip
  without loss.
- Provide additive import, merge by identity and replacing the visible state; these three modes keep history and
  concurrent versions.
  There is also an explicit full Google overwrite that keeps only the history in the backup; the old data must first be
  saved in a safety backup.
  A full local restore does not force a backup of the old data first; after confirmation it replaces notes, drafts,
  history, layout and attachments in one step.
- Distinguish bytes produced, saved by the OS, restored locally and synced remotely.

## Non-Goals

OAuth and OS credentials are not backed up, and no Drive permission is added; content that other devices have not
uploaded yet is not promised.
The 0.1.0 SQLite backup is not this format. URLs, HTML, scripts or external paths inside the archive are never executed.
It is not promised that deliberate repeated imports across devices produce only one copy, nor that Drive offers
multi-file atomic transactions.

## Requirements

| ID | Requirement |
|---|---|
| B01 | "Data and backup" in Settings offers export, validate/preview, restore and automatic backups; no permanent toolbar is added to the desktop |
| B02 | Export one ZIP, with optional encryption of the whole payload, through the OS save/share UI |
| B03 | Show the snapshot time, the last successful sync time (unknown stays unknown) and the counts of pending sync, drafts, conflicts and pending items |
| B04 | An export is always bound to the captured profile and cannot use another partition's attachments after a switch |
| B05 | Nothing is written to the target before full validation; the preview shows the target account or local partition, the mode and all affected counts |
| B06 | All three modes need explicit confirmation; replace also needs a saved pre-restore safety backup |
| B07 | The job, the backup fingerprint, the ID map, content/attachments/drafts/layout and the new outbox are one local atomic transaction |
| B08 | Restarting or retrying the same job adds no duplicates; importing the same file again after completion must explicitly create a new job |
| B09 | Corruption, a wrong password, unsupported content, exceeded capacity, cancellation or a failed save must not leave a half success |
| B10 | No loss of unknown values, conflicts or drafts; no automatic choice of a winner among concurrent versions |
| B11 | Automatic backups have a location grant, a retention count, last success/failure and catch-up runs; they manage only the files they created |
| B12 | MSIX updates keep the package data; uninstalling clears all local data inside the package, while ZIPs the user exported and the Google cloud are not affected |
| B13 | A full Google overwrite needs a validated backup, a saved safety backup of the same account and revision, and confirmation of permanent clearing; the complete restore data is persisted first, then the cloud is cleared |
| B14 | Clearing the cloud and uploading are separate persisted stages; after a failure or restart they resume, an upload retry must not clear again, and old devices that meet the marker stop syncing |
| B15 | Local and Google backups share one format and can migrate in both directions; a manual Google export syncs first and, on failure, saves the known copy only with explicit consent |
| B16 | A full local restore needs full validation, staleness protection and confirmation of permanent replacement; a backup of the old data is optional; the workspace and its attachment set are replaced atomically without affecting other partitions |

## Design Overview

### Consistent snapshot and data boundary

Before an export the UI must flush every editor draft and wait for the commit; on failure the input is kept and the
export stops.
A manual Google export syncs first. If that fails or content is still waiting to sync, it does not export silently; it
backs up the known local data only after an explicit choice.
The success time is persisted only after a complete pull/push/pull with no pending operations; on failure the old time
stays. Automatic and safety backups remain local snapshots.
One copy of Workspace.state gives a consistent snapshot;
afterwards immutable SHA-256 attachments are read only from this profile and their bytes are verified. Later edits wait
for the next backup.

| Content | How it is saved |
|---|---|
| Cards / groups | All immutable revisions, including complete ancestors, concurrent heads, retired redirects and all states |
| Missing parent | Pending records and missing IDs are kept as they are, without inventing parents; the manifest counts them and states the known local scope |
| Drafts | All drafts, uncommitted cards, recoveredFrom baselines and their attachments; after a restore they are still local drafts |
| Local reading preferences | The current complete head selection and entity order, proofs of pure membership rebases, unfinished transfer intents |
| Per-device layout | deviceId, grid/regions, placement/size/order, display/layer/selection, shortcuts, myGroup, undo |
| Attachments | The bytes referenced by all history, drafts and their baselines; a missing file, a size mismatch or a wrong hash rejects the complete export |
| Excluded | Profile/account, tokens, client secret, Drive file IDs, source/session, cursor, upload URLs, outbox packets and restore receipts |

Unknown content formats and JSON extensions of value/draft/layout can be kept; the fixed envelope, manifest and local
fields cannot be extended at will. Unsupported non-projected conflicts must not be silently omitted. A backup does not
clear the outbox or drafts.
The scope is always known-local-data; remote data that was not received cannot be included. Pending does not mean that
the backup is damaged.
Draft lineage is compared on canonical JSON values after strict parsing, not on the serialized key order.

### Public container v1

Suggested file name: `work-fleet-backup-YYYY-MM-DD-HHMMSS-<short-id>.zip`.
A plain ZIP uses store (0) or deflate (8), with UTF-8 JSON and fixed ASCII paths; the ordinals are unrelated to the
actual data IDs:

```text
manifest.json
local.json
layout.json
revisions/00000000.json
drafts/00000000.json
attachments/<64 lowercase SHA-256 hex>.bin
```

Items that do not exist get no empty directory entry. Ordinals need not be contiguous; paths and revision IDs must not
repeat.
The reader never extracts to the file system; it accepts only single-volume, non-ZIP64 regular files. It rejects links,
directories, path traversal, other encrypted ZIPs, SFX prefixes, trailing garbage, local/central differences and
overlapping or non-contiguous ranges.
A data descriptor may come with or without a signature; a CRC equal to the signature is still told apart by its
boundary.
Only timestamp, NTFS time and UID/GID extra fields are accepted. The directory and the limits are validated first;
then the native DecompressionStream('deflate-raw') decompresses as a stream, checked against the actual bytes, the CRC,
a complete end and the SHA-256.
A runtime that lacks the capability refuses explicitly and does not fall back to a lenient parser.

The manifest has only the following fields; an unknown schema is rejected:

| Field | v1 definition |
|---|---|
| format / schemaVersion | work-fleet-backup / 1 |
| backupId | A valid ID per SPEC-004, generated once when the backup is created |
| createdAt | A real UTC ISO date with fixed milliseconds, YYYY-MM-DDTHH:mm:ss.sssZ |
| appVersion | A version description of 1–64 UTF-16 code units |
| scope | known-local-data |
| pendingOperations | A non-negative safe integer, the outbox count at capture; the packets are not carried |
| lastSuccessfulSyncAt | The same date format as createdAt, or null; a missing record must not pretend to have just synced |
| counts | cards, groups, revisions, drafts, attachments, conflicts, pendingRevisions, all non-negative safe integers |
| files | Every entry except the manifest itself, exactly once: {name,size,sha256}; size is the decompressed byte count |

cards/groups include deleted and retired entities. A pending-only entity has no complete head and does not count as a
projectable card, but its records are included in revisions/pendingRevisions. conflicts are rebuilt from the graph,
group refs, overflow and transfer intents.
The fingerprint is the SHA-256 of the canonical manifest; all payload hashes are inside the manifest.
SHA detects integrity and does not prove that the author is trustworthy; user content that passes validation is still
treated as external data.

local.json always holds cards, groups, membershipRebases and transferIntents.
cards/groups are {id,revision} arrays that cover every projectable entity and select a valid complete head.
membershipRebases map an old revision → {cardId,revision}; each must be a direct parent edge of the same card, and the
rest of the value must be identical once groupId/revision are removed. A transfer intent always has
kind/cardId/groupId/expectedRevision.
layout.json holds a schema 1 LayoutStore; its card/group/undo references must be valid.
Group cycles, retired targets and more than 9 groups are kept and clearly marked as needing repair; no data is deleted
for a backup.
revisions follow [SPEC-004](004-revision-graph-and-file-sync.md); drafts keep the Workspace format, with a nullable
baseRevision and a linear recoveredFrom, and a baseline must not embed another recoveredFrom.
A known draft base must be a revision of the same card; an unknown base is kept as an unfinished intent.

The executable validators are src/backup/payload.js, archive.js and src/sources/revisions.js.
Beyond field shapes, the graph, references, hashes and counts must be checked; passing JSON parsing alone is not enough
to import.

### Encryption envelope v1

The outer ZIP holds only encryption.json and payload.bin. The payload is the AES-256-GCM ciphertext and 128-bit tag
of the whole plain ZIP, so inner file names, the manifest and the content are all encrypted. Ordinary unzip tools can
extract only the two outer entries;
this format is not a traditional ZIP password or WinZip AES.

The header has only format=work-fleet-encrypted-backup, schemaVersion=1, cipher=AES-256-GCM,
kdf=PBKDF2-HMAC-SHA256, iterations=600000, a 16-byte salt, a 12-byte nonce (lowercase hex) and tagBits=128.
Salt and nonce are generated randomly every time, and the canonical header is the additional authenticated data.
The password is UTF-8 without Unicode normalization; on export it has at least 12 Unicode code points and at most 1024
UTF-16 units.
The password cannot be recovered and is never written to the manifest, settings JSON, logs or .env.
The KDF values are a fixed allow-list; the inner layer is parsed only after the tag check succeeds, and nested
encryption is not accepted.
Temporary byte buffers under the app's control are cleared; there is no promise that JavaScript strings or GC memory
can be cleared deterministically.

### Capacity and cancellation

| Limit | v1 maximum |
|---|---|
| ZIP entries (including the manifest) | 20,000 |
| Total decompressed plain data | 128 MiB |
| Plain ZIP | 136 MiB |
| Encrypted ZIP | 136 MiB + 4096 bytes |
| Single JSON | 8 MiB, depth 64 / 200,000 nodes, strict JSON per SPEC-004 |
| Single attachment | 25 MiB |
| Encryption header | 4096 bytes |

Export and import share these limits; content is never truncated. Large stored entries are copied and CRC-checked in
64 KiB pieces, yielding to the event loop, and the decompression stream checks the actual output; after cancellation
nothing returns success or writes the target. Once native KDF/AEAD has started, it must finish before the operation is
refused.
These are engineering limits; stress tests on minimum devices of the five platforms need their own evidence. Running
out of memory fails explicitly and never omits data.

### Export and the three restores

After the ZIP is produced, it is reopened and checked with the same reader before it goes to the OS for saving.
Success is shown only after the host confirms a complete save; a browser download can only report that the file was
handed to the browser and cannot claim that it is on disk. An unconfirmed save must not report success.
A browser with File System Access first obtains the user-chosen handle in the click event, then compresses and
encrypts; a save receipt is issued only after the write, the close and a read-back of the full size and SHA-256 all
succeed. With only download capability an export is still possible,
but it cannot unlock replace. The receipt of the pre-replace safety backup is bound to the captured profile/revision
and becomes invalid when the data changes.
Before close, the save enters a non-cancellable file commit/verification stage; the UI disables cancel, and a late
abort does not misreport an already written file as cancelled.
A close or read-back failure must state that the destination file may have changed and that the save is unconfirmed;
there is no promise to roll back a published file.
A restore is first fully validated in memory or in an isolated staging area, and shows the counts, pending items and
conflicts, the target and the mode:

| Mode | Identity / content | Local layout |
|---|---|---|
| Import as new data | Maps every entity, revision, draft and missing referenced ID; keeps graphs and branches; attachments are deduplicated by hash | Existing cards do not move; new cards can optionally take the backup geometry, otherwise they get an initial position |
| Merge | Deduplicates identical immutable IDs/content; the same ID with different content rejects the whole batch; keeps new branches and history; no winner chosen by time | Keeps the current layout by default; applies the backup layout only on explicit choice |
| Replace visible state | Saves a safety backup first; restores the backup heads as appended revisions, and extra cards go to Deleted; deletes no history or Drive files | Explicitly applies the backup layout with the target deviceId; for unreachable positions only the title is rescued |

A replacing revision takes all related heads observed in the preview as parents; multiple branches in the backup stay
multiple branches.
One replace allows at most 1,024 parents per entity; beyond that the user must resolve conflicts first, and heads are
never truncated.
Retiring extra groups and where drafts go are part of the preview; both the original drafts and the restored drafts are
kept and not published automatically.
The same draft ID with different content gets a new ID, and its lineage/baseline are mapped along with it; identical
drafts are deduplicated.
When the same membership baseline points to different successors, history is kept, that automatic continuation edge is
paused, and the preview says so.
When the backup being restored by replace has no active group, a "Kept after restore" group is added to receive the
retired extra groups and later records.
No active group, cycles or more than nine groups cannot be solved by dropping data; the recovery or merge method must
be stated.
Temporary scope, focus and drag state are not restored; geometry is not sent to other devices as shared content.

The plan is bound to the profile, workspace revision, fingerprint and restoreJobId; if data changes before the commit,
the preview must be redone.
Attachments, the ID map, new revisions/outbox, drafts, layout and the receipt are one local atomic transaction.
Transfers reuse persisted operation/file IDs, so a lost response adds no duplicates; new remote branches that were not
observed can still form conflicts.
Cancelling an uncommitted plan writes nothing; cancelling after the commit only stops the transfer and does not
compensate by deleting published data.
Placing new cards also runs in batches that yield to cancellation, so a large number of placements does not freeze the
preview. The IndexedDB adapter writes the workspace, the receipt and all attachments in one strict-durability
transaction; reading back an existing job receipt handles a retry whose commit finished but whose response was lost.
Once the atomic commit has started, the UI disables cancel and waits for the definite result.

### Full Google overwrite and uninstall

"Clear Google, then restore from backup" is a separate explicit mode and does not change the history-keeping semantics
of "Replace current notes".
It is offered only in a signed-in Google workspace that can connect. It first syncs the current data and fully
validates the input, and the preview is bound to the current account and revision.
After the user saves a safety backup of the current data and ticks the clearing confirmation, the backup is merged into
a blank Workspace of the same account, and the complete state, attachments and job marker are written to disk in one
local transaction. Overwritten old drafts remain only in the safety ZIP; drafts from the backup are still local drafts.

Normal sync pauses in the `reset` stage. The reset marker is written first and the current project's Work Fleet
appDataFolder is cleared, keeping the control markers; then the `upload` stage is persisted, and only then are all
known revisions and attachments of the backup uploaded.
This is not a Drive multi-file atomic transaction; an interruption can leave the cloud blank or partial, and after a
restart "Continue overwriting Google" is offered.
Upload retries reuse the existing persisted file IDs and do not clear again. Other devices must stop syncing first; a
device holding old data stops syncing when it meets the marker and asks what to do with its copy.
Ordinary Drive files are not affected; content on other devices that was not synced or not received is not in the
safety backup.

In the MSIX, all local and Google partitions, settings, drafts, attachments, credentials and caches live in the
package's private data area; uninstalling clears them and updates keep them. ZIPs the user exported and the cloud are
not package data.
The separate directories of the old ZIP and Debug builds are not moved or deleted automatically; export with the old
build first, then import into the new MSIX.

### Full local restore and two-way migration

"Clear local data, then restore from backup" is offered only in a local workspace and uses the same format as the
other modes.
It validates first and shows the target and how much will be cleared, then asks for the permanent-replacement
confirmation; it does not require saving the old data or resetting the workspace first.
A plan bound to the original profile/revision is built on a blank workspace and keeps the backup's identities, full
history, drafts, attachments and layout; the target deviceId stays the same and unreachable geometry is rescued. The
workspace, graph, layout and receipt and the whole attachment set
are replaced in one CAS transaction; old content is not left in Deleted, and a backup without attachments also clears
the old bytes.
Cancellation, a stale or wrong profile, a full disk and an aborted transaction keep the original data; when a native
response is lost, the restore completes only after the complete persisted content is confirmed.
Automatic backups first wait until idle and resume afterwards; settings, saved ZIPs, other workspaces and the Google
cloud are not affected.
Google → offline local: export a ZIP manually → switch to Local notes → import, or run a full local restore; nothing is
written back to Google afterwards.
Google → Google or local → Google: in the target Google workspace choose import, merge, the original replace or the
full overwrite.
The related decision is [ADR-038](../decisions/038-portable-local-and-cloud-backup-flows.md).

### Automatic backups

Off by default. When it is enabled, the user chooses an OS-granted location, encryption and the retention count
(default 7, range 1–90).
A backup runs only when data has changed and 24 hours have passed since the last successful backup; repeated triggers
are merged, and failures back off.
An overdue backup catches up once at app start or resume; there is no claim of punctuality while the app is closed or
the phone is suspended.
An encrypted schedule needs a password or key handle in the OS secure storage; when the capability or the grant is
unavailable, it pauses and does not fall back to plain text.
Only after the new file is written and verified are this schedule's own old files pruned according to the durable
inventory. It must not scan a directory by file name to delete other backups, or cross profiles or granted locations;
on failure the existing successful files stay.
Implementation details are in [ADR-014](../decisions/014-durable-automatic-backups.md): a separate per-profile CAS
journal; pending is saved before the file is written, and a restart checks against the expected bytes; a settings
change produces a new policyId, so that success records of an old encryption policy are not reused.
Native hosts must offer safe create-only writes and identity-bound cleanup; a host with create capability but no
cleanup capability keeps everything and says so.
The browser preview currently has both capabilities unavailable and can still export manually. This is an
implementation boundary and does not remove the 1.0 requirement for the five platforms.
Before cleanup the latest successful file is checked again; if it is missing, the old copies are kept first and the
backup is rebuilt. A failure of the journal itself must also show as paused or as an error.

## Acceptance Cases

| ID | Scenario and expectation |
|---|---|
| T01 | Chinese, emoji, Markdown, checklists, unknown formats, attachment bytes and all states round-trip completely |
| T02 | Full history, edit/edit, delete/edit, missing parents and group cycles are kept, without inventing data or choosing a winner |
| T03 | Drafts, multi-generation lineage, attachments and membership baselines are kept; a restore does not commit them automatically |
| T04 | Readable across partitions and devices and after the original Drive data is gone; no credentials or provider information are carried |
| T05 | Import as new maps everything; merge checks identical IDs; replace keeps old and new history and drafts |
| T06 | Transaction abort, quota, a lost response or a restart cause no half or duplicate restore |
| T07 | Stale previews are rejected after local or sync changes; unobserved remote changes can still form new conflicts |
| T08 | Offline, missing parents or an unfinished first sync clearly state the known local scope |
| T09 | Path, ZIP bomb, bad DEFLATE, duplicate key, hash, reference or version errors all write nothing to the target |
| T10 | Cancellation, an account switch, revoked access and a full disk keep the original data and do not misreport success |
| T11 | The same job resumes or shows as completed; only an explicit re-import adds a second copy |
| T12 | No Google needed; standard ZIP tools read the plain format, and the encryption interoperates with independent crypto |
| T13 | Independent salt/nonce; a wrong password, tag or header is rejected; inner metadata is encrypted |
| T14 | Across displays only unreachable positions are rescued; existing cards are not moved when the backup layout was not chosen |
| T15 | Automatic catch-up; failures delete no old files; only its own inventory is pruned; encryption does not fall back to plain text |
| T16 | A full Google overwrite leaves only the backup's history and attachments, with drafts only on the device that ran it; old devices stop syncing when they meet the marker |
| T17 | No safety backup, a wrong account, a stale preview or a failed local save must all prevent cloud clearing from starting; an interrupted clear or upload resumes after a restart |
| T18 | The MSIX private path is not affected by an external old DB; updates keep the package data and uninstalling deletes it, while exported ZIPs stay |
| T19 | All four local/Google migration directions use the same ZIP and keep full history, drafts, attachments and the target profile |
| T20 | A full local restore needs no safety backup; the old graph, drafts and attachments are cleared, other partitions are unchanged, and a transaction failure, staleness or cancellation keeps the original data |
| T21 | A Google export syncs new remote data first; on sync failure it saves nothing by default and backs up a copy only on explicit choice; cancel saves nothing; the success time updates only after a complete sync |

## Dependencies and References

- [PLAN-002](../plans/002-google-drive-notes-mvp.md), [SPEC-003](003-desktop-cards-groups-and-formation.md),
  [SPEC-004](004-revision-graph-and-file-sync.md).
- [ADR-013](../decisions/013-complete-portable-backup.md),
  [container and encryption research](../research/2026-10-04-backup-container-and-encryption.md).
- A consistent Workspace, complete attachments, atomic persistence, and native file grants, secure storage and life
  cycle.
- Native environments, minimum device capacity and OS save confirmation are accepted platform by platform. Current
  status is in [PROGRESS](../../PROGRESS.md); verification evidence is in the git history and [testing](../testing.md).
