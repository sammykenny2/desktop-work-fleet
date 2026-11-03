# ADR-064: Sync talks to Drive outside the desktop action queue

## Status

Accepted, 2026-11-03, at the maintainer's request. Acceptance on a real desktop host against real Drive remains open.
This supplements [ADR-062](062-dataset-checkpoints-and-deletable-history.md) and
[ADR-063](063-efficient-idle-sync.md): no persisted format, Drive request or write guard changes, and no reset is needed.

## Context

On desktop hosts every action that writes or moves anything runs through one queue, `DesktopOwner.perform`, one at a
time. `syncGoogle` ran its whole pass inside that queue, including every Drive request. A running sync therefore held
every button, drag and Adjust until Drive had answered everything. 0.4.5 has the same line, with passes of about 5
provider calls; since 0.5 a save's pass takes about 80 (synthetic provider), so the hold became long enough to see.

0.5.10 let group dialogs open during a sync, which moved the wait to their Save button. Saving a group starts a sync, so
a second group added right after it could be typed but not saved until the first group's sync ended. The maintainer
rejected that behaviour. Two more symptoms had the same cause. A quick edit's text box stayed read-only for the whole
pass, because the flush before it freezes the box until the queue turn ends. And a landing that failed later in its
pass, such as an upload error after the first pull, left the screen unreconciled until a later pass succeeded.

The queue does not protect the data here. Workspace and record storage serialize their own writes, a landing merges local
heads inside its transaction, and phones and tablets have always run passes with no queue at all.

## Decision

1. **Provider requests run outside the queue.** A pass holds no queue turn while it waits for Drive.
2. **What a pass pulled lands inside it.** `DatasetSync.sync` takes a `land` function that runs each local activation of
   pulled data. The app's `landSync` takes one queue turn for the activation and everything that depends on it:
   the controller's reconciliation, placing new papers and the render, so no action sees one without the other. A pass
   with an upload lands twice. If reconciling or placing fails, the error is reported, what landed is still drawn and
   the pass goes on, because the data is stored by then and uploads must still run. The next pass then takes the full
   path instead of a quiet check, so it lands again and retries.
3. **The flush before a pass takes its own turn**, which also ends the freeze of a quick edit's text box.
4. **Sync bookkeeping stays outside.** Acknowledgements, the cursor of an empty check, completion times and journals change
   nothing an action reads from the projection, and they serialize on the Workspace and storage writers.
5. **Nothing holding the queue may wait for a pass**, because the pass waits for the queue to land. A backup export no longer
   holds the queue around its sync. It waits for a running pass and then runs its own, as it effectively did behind the
   queue. The path that waits for a backup inside an action when a host goes to the background runs only on iOS and
   Android, which have no queue.
6. **What relied on waiting behind a pass now waits for it explicitly.** An automatic backup's snapshot used to wait through
   its flush, and any commit of a pass makes a snapshot refuse itself. It now waits for a running pass, outside the queue,
   before its flush.
7. **A pass can fail under any dialog**, so the recovery question it could not ask over one is asked when the dialog closes.
   This replaces the hook the group dialog had for it.
8. **Opening a note does not hold the queue for its attachments.** The list fills in when Drive answers, and only the latest
   render of the list for the note still open may touch it.

Handhelds use the same code without a queue. There, as on the desktop, a pull now reconciles when it lands rather than at
the end of the pass. The maintenance loop's restore pass keeps its own `DatasetSync`, lands directly and reconciles
afterwards, as before.

## Consequences

### Positive

- Saving, moving papers, Adjust and quick edits wait for other local work and a landing's local commit, not for a sync.
  Other desktop actions no longer wait for a sync either.
- Changes from other devices show when they land, before a slow upload ends, and stay shown if that upload then fails.
- A save made during a pass goes up right after it when the pass completes and no dialog is open. Otherwise it waits for
  the next trigger, normally the 20-second timer, unless a dialog or a backoff after a failure still holds syncing.

### Negative

- A new ordering rule (decision 5). Awaiting a pass inside a queue action deadlocks the queue until the pass is stopped.
- A running pass can now land under the main editor or another dialog opened during it. On the desktop only group dialogs
  allowed this before, though handhelds always did. Typed text is untouched, and a version choice refused because the
  versions changed can be made again. New passes still do not start under a dialog other than Settings.
- A note saved here while another device's edit of it is on its way in becomes a visible conflict rather than a refusal,
  as it already would one moment earlier. Both texts are kept.
- A pass can wait for its landing turn behind a long action. It holds nothing meanwhile, and stopping it ends it when
  the turn comes.
- Signing out or changing the data waits for a running pass when an automatic backup is at its flush, because those paths
  wait for the backup before stopping the pass. The wait ends with the pass. Desktop hosts already waited like this behind
  the queue; on handhelds it is new.

### Neutral

- A drop spanning a landing that changed the layout is refused with "The layout changed. Try again.", as before. A landing
  that changes nothing in the layout does not affect a drag. The drag no longer freezes while the pass runs.
- This decision left the number of Drive requests per pass and the time until other devices see a change unchanged.
  [ADR-065](065-reuse-verified-records-to-cut-sync-round-trips.md) reduces them.
- The maintenance loop's purge and restore steps already ran outside the queue and are not changed here.
- No queue turn on the shipped desktop hosts is known to wait on Drive: they open an attachment from a paper through
  their local database. A desktop host without that capability would hold its turn for the read.
- A first dataset failure under a dialog opened over Settings asks its recovery question over Settings when that dialog
  closes, as it asks at once over Settings when no other dialog is open. After that question, nothing asks again on its own.
- A quiet check that committed during an automatic backup's capture made that backup refuse its snapshot and retry later. A
  pass already running no longer did (decision 6). [ADR-065](065-reuse-verified-records-to-cut-sync-round-trips.md) ended this.
- Import, merge and replace previews of a Google workspace still go stale at the next commit of a pass, including a quiet
  check, and are refused when confirmed. Only a cloud replace preview holds syncing. That is existing behaviour and needs
  its own fix.

## Alternatives Considered

### Alternative 1: Land outside the queue and only reconcile inside it at the end of the pass

- **Pros**: No `land` parameter, no deadlock rule. Handhelds worked this way.
- **Cons**: An upload can run for seconds between the first pull landing and the reconciliation, and desktop gestures then
  run against a controller that has not seen the landed data. A pass failing in between never reconciles.
- **Why rejected**: Landing in one turn keeps the guarantee desktop actions already had without auditing each of them.

### Alternative 2: Keep the hold and reduce the requests

- **Pros**: No ordering change.
- **Cons**: Any slow connection still holds every action. 0.4.5's short passes held the queue too.
- **Why rejected**: It shortens the wait without ending it. Reducing requests remains separate work.

### Alternative 3: Move sync into a separate process or worker

- **Pros**: The strongest isolation, in the direction of [ADR-058](058-desktop-presentation-lifecycle-and-core-isolation.md).
- **Cons**: A much larger change on every host, not needed to end this wait.
- **Why rejected**: Disproportionate to the problem.

## References

- [SPEC-011](../specs/011-efficient-idle-sync.md) and [testing](../testing.md)
- `tests/sync-action-queue.test.js`, `tests/google-vault-pause.test.js`, `scripts/testing/group-dialog-sync-probe.mjs`
