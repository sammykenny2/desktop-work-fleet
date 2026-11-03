# ADR-065: Reuse verified records to cut sync round trips

## Status

Accepted, 2026-11-04, at the maintainer's request to refine 0.5.x without leaving its architecture or removing version
control. Decisions 3 and 9 changed the same day after a review of what 0.5.12 shipped (see Alternative 6). Acceptance on
real Drive remains open. This supplements [ADR-062](062-dataset-checkpoints-and-deletable-history.md),
[ADR-063](063-efficient-idle-sync.md) and [ADR-064](064-sync-talks-to-drive-outside-the-action-queue.md): no persisted
format changes, no write guard is removed and no reset is needed.

## Context

After ADR-064 a save no longer waits for its sync, but the sync itself stays slow. Measured against the synthetic provider,
charging each request the HTTP round trips the native hosts make, a save took about 100 sequential round trips:

- Every generation proof downloaded the same two immutable records again, in two sequential steps of two requests each.
- Every pull that saw a change downloaded the whole shard again, one file at a time, including files this device had just
  uploaded. Each further edit in a shard therefore added four round trips to every later save, until the next checkpoint.
- A reservation asked for its IDs one request at a time, and an upload asked Drive about IDs allocated moments earlier.
- Retirement read and deleted each input in turn, about two requests for each of 64 or more files, before that save uploaded.

Only macOS and iOS run Drive requests in parallel. Android and Linux run them on one worker, and Windows holds one gate.

Separately, a quiet check commits its cursor and time every 20 seconds. Each commit moved the revision a backup snapshot
compares, so a capture running longer than that refused itself and retried with a growing delay.

## Decision

1. **A session reuses immutable records it verified.** `VerifiedRecords` holds decoded records by their exact descriptor, in
   memory only, up to 32 MiB and evicting the least recently used first. It belongs to one session's `DatasetSync` and is
   not shared with another.
2. **Reuse answers what a record says, never whether it exists.** A descriptor is either fresh from Drive or comes from a
   verified record that a fresh listing led to.
   - A generation proof still makes its five requests about what exists: root, descriptor and ready receipt metadata, and the
     fence and dataset listings. It reuses the bytes when the fresh metadata carries the same digest. This keeps
     ADR-063's rule that a cached result cannot authorize a write: nothing about the generation is cached. Exactly one
     `assertGeneration` per audit and per guard stays true.
   - A pull's capture still lists its shard and purge markers. It reuses the bytes of what the listing returned.
3. **An incremental pull holds its capture listing and its cursor to the feed it just read.** Drive's filtered lists can lag the
   feed, and a verified record has no download left to fail, so the disagreement has to be noticed directly. Once a feed is
   read to its end, a capture must not list a file it removed and must list every receipt and checkpoint it added. A listing that
   does not looks again, up to four times over 350 ms. After that the pass fails with the retryable `dataset-visibility`, nothing
   lands and the cursor stays, so the next pass replays the same events. This needs no extra request while they agree. The
   first pull comes before any upload, so after 30 seconds of holding the pass goes on to its uploads without landing, and still
   fails at the end. The cursor is what remembers: a restart loses nothing, and a device behind its listing never reports success.
4. **A lag is not reported as a failure at first.** The status stays on syncing and the pass runs again when its backoff ends.
   A timer tick during that wait starts nothing, and Sync now still does. After six such waits without a pass completing, the
   lag is reported as an error. A forced pass someone is waiting on, for an export or a restore preview, waits out three lags
   of up to 3.5 seconds in all and then fails, so an export asks its question about backing up only what this device knows.
5. **A checkpoint reads what it captures again:** every listed file and the body of every uncovered receipt. It seals them, so
   a body that vanished must stop it there rather than leave a dangling head in a file other devices trust. Bodies named
   only by an input checkpoint's heads are not read, as before. Attachment bytes and history reads are not reused either.
6. **An upload does not ask about IDs it just allocated.** Only IDs allocated by the same publisher, not yet tried, skip the
   lookup. A job found in the journal may have reached Drive and looks first. A read-back still follows every create.
7. **One request reserves every ID of an operation.**
8. **macOS and iOS read at most four files at a time, and retirement deletes in batches.** Open transfers are capped at eight on
   every host, so reads leave room for the rest of the app, and `transfer-busy` is retried. The other hosts keep reading one at a
   time, because reads queued behind their one worker would only spend their bridge timeout waiting. Every read that started
   ends before its caller continues, so none outlives a pass. An unreadable batch reply falls back to deleting one by one.
9. **A permanent deletion the feed reports counts at once.** A pull reads each reported marker by its exact ID, which needs no
   listing to have caught up, and stores it before anything can hold. The check before every upload already consults that
   record, so an unsent edit of the note stops there and is kept for Save as copy instead of reaching Drive. Later pulls of the
   session apply the marker too, even if the purge listing is still behind.
10. **Workspace tracks a content revision.** Every commit moves it except a quiet check's. A backup's snapshot check compares
    it instead of the revision, and a backup's journal records it as its source. A save or a landing during a capture still
    refuses the capture.

History uses the same reuse for its generation proofs, which also shortens backup captures and the versions page. Reset,
initialization and restore keep reading everything.

## Consequences

Round trips of one pass on the synthetic provider, before and after. Real Drive latency has never been measured, so these
are ratios, not times. macOS and iOS can overlap requests. The other hosts run them one at a time.

| Case | macOS, iOS | Windows, Android, Linux |
|---|---|---|
| New note, 50 notes | 77 to 36 | 110 to 61 |
| Edit, 50 notes | 72 to 31 | 99 to 52 |
| 60th edit of one note | 307 to 30 | 327 to 52 |
| A save that also consolidates | 473 to 133 | 498 to 393 |
| First save after launch, 30 notes | 142 to 57 | 174 to 129 |
| Receiving one edit | 35 to 12 | 43 to 19 |
| Another device's first sync, 50 notes | 286 to 141 | 302 to 295 |

### Positive

- A save's cost no longer grows with the saves before it: 57 provider calls for a new note and 48 for an edit, down from
  up to 81 and 68, in the budget test's fixture.
- Automatic backups can finish while the app sits idle. An unbroken run of quiet checks no longer causes another backup. A full
  pass, such as after a resume or a failed check, still counts as a change.
- On an incremental pull, a listing behind the feed no longer moves the cursor past what it left out. Before, a device could
  stay on old text or miss a note until the next event in that shard, reporting idle.
- A deletion the feed reports no longer waits for the purge listing. Before, a lagging listing let an offline edit of a deleted
  note upload, after which it counted as published and was not kept for Save as copy when the deletion took effect.

### Negative

- A body lost without a purge marker is noticed later: an ordinary pull answers from memory, and the next checkpoint that
  reads it or another device reports it. Bodies are only deleted after their purge marker, so this needs outside damage.
- A purged note's records can stay in memory until evicted or the session ends. They are not returned for it, because a
  capture's purge listing comes first and a reported marker applies however that listing lags. The workspace held the same text.
- The limit counts file bytes, which came to about 50 MiB of heap when full in the shapes measured. Each signed-in session can
  hold that much on top of the workspace, which holds much of the same text.
- A batch reply that cannot be parsed costs one extra pass through the inputs.
- How long Drive's listings really lag has never been measured. A lag beyond the retries delays that pass by its backoff, and
  a lag right after every upload would add that delay to every save. A lag at the first pull also holds that pass's uploads
  for up to 30 seconds. Real-Drive acceptance has to look for this.
- A device whose listing stays behind receives nothing from other devices until it catches up, however long that takes, and
  reports it after six waits. Nothing frees it automatically, because every way of moving the cursor could skip what the listing
  left out. If Drive could leave a listing behind for good, that device would need a reset to recover.
- A full reconciliation after an expired cursor has no hold, so it can land what a lagging listing shows, as it always could.
- After a restart, a pull relies on the purge listing again for a marker it read before the cursor moved. The check before an
  upload still has the stored record, so only the view can be wrong, and only until that listing catches up.

### Neutral

- Generation proofs stay the largest group, 30 of an edit's 48 calls. Reducing them further means weakening ADR-063's guards,
  which needs its own decision. The floor of this design stays well above 0.4.5's five calls.
- Letting Windows, Android and Linux run requests together is separate work, because their single worker or gate may protect
  shared state that each host would have to audit.
- A consolidating save on those hosts stays near 400 round trips, because a checkpoint reads what it captures again.
- Import, merge and replace previews still go stale at the next commit, including a quiet check's.

## Alternatives Considered

### Alternative 1: Remove generation proofs around uploads

- **Pros**: The largest remaining group of calls.
- **Cons**: ADR-063 section 3 forbids it, and no Drive compare-and-swap replaces it.
- **Why rejected**: Unnecessary for this round. Cheaper proofs keep the protection.

### Alternative 2: Skip the first pull when the feed is empty

- **Pros**: One fewer proof, purge listing and landing per save.
- **Cons**: The first version broke ADR-063's full validation on resume. The corrected one saves about four round trips.
- **Why rejected**: Too little for another shortcut around validation.

### Alternative 3: Trust the create reply and skip the read-back

- **Pros**: Two fewer reads per save.
- **Cons**: SPEC-010 requires a read back before acknowledging, and whether every real create reply carries a digest is
  not verified.
- **Why rejected**: Small gain, and a change to what proves an upload.

### Alternative 4: Upload saves that arrive during a pass within that pass

- **Pros**: About 10% fewer round trips in a burst of saves.
- **Cons**: Reverses ADR-064's rule that what a pass has not read waits for the next one.
- **Why rejected**: Not worth reopening a decision made a day earlier.

### Alternative 5: Stop polling while a backup captures

- **Pros**: No new Workspace field.
- **Cons**: A long capture would hold every device's changes back for its whole length.
- **Why rejected**: A quiet check changes nothing a backup holds, so it need not stop.

### Alternative 6: Reconcile after 30 seconds of holding, with a follow-up five minutes later

- **Pros**: Frees the receiving side as well as uploads. This is what 0.5.12 shipped.
- **Cons**: It lands what the listing shows and moves the cursor past what it left out, knowing the listing is behind. The
  follow-up lived in memory, so a restart lost it. It also dropped a marker the feed had reported, so an offline edit of a deleted
  note uploaded, and its text was gone when the follow-up applied the deletion.
- **Why rejected**: A review reproduced both. Holding the cursor needs no follow-up and no new stored state.

## References

- [SPEC-010](../specs/010-dataset-checkpoints-and-deletable-history.md), [SPEC-011](../specs/011-efficient-idle-sync.md)
- [Idle sync request cost](../research/2026-11-03-idle-sync-request-cost.md)
- `tests/dataset-records.test.js`, `tests/dataset-save-budget.test.js`, `tests/backup-dataset.test.js`, `tests/google-vault-pause.test.js`
