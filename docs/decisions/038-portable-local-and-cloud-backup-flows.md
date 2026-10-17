# ADR-038: Portable backup and complete restore flows for local notes and Google

## Status

Accepted, 2026-10-12. The maintainer asked for compatible local and Google backup formats that can migrate in both directions,
and authorized handling it according to best practice.
This decision supplements ADR-013/037; the original three restore modes and the safety backup requirement of the full Google
overwrite are unchanged.

## Context

Local notes and Google already share the `work-fleet-backup` v1 ZIP, but a manual Google export saved only the copy known
locally, without syncing first.
The original local "replace" kept the old history and drafts; resetting first and importing afterwards took two operations,
and a failed import could leave an empty workspace.
When the user wants to wipe the old local content directly, exporting the old data should not be a mandatory step.

## Decision

- Keep using the same public v1 format and the optional encryption envelope, without adding account, provider or credential data.
  Local to local, Google to Google, local to Google and Google to local all use the same validation and restore core.
- A manual Google export first flushes drafts and syncs; the last successful sync time is recorded only after a complete
  pull/push/pull with an empty outbox.
  When sync fails, sign-in is unavailable or content is still waiting to sync, nothing is saved by default; the user can
  explicitly choose "Back up only what this device knows".
  Cancelling saves nothing, and a failure does not update the success time; the format still marks `known-local-data` and does
  not claim that content other devices have not uploaded was received.
- The backup page and the restore preview show the source and target workspace, the backup time, the last successful sync time,
  and the numbers of changes waiting to sync, drafts, conflicts and versions still arriving.
  Manual safety backups and automatic backups still cover a consistent local snapshot and do not quietly add a network
  dependency.
- A new mode, "Clear this device, then restore from the backup", is offered only for the local workspace. It first validates
  the ZIP, previews how much will be cleared, and then asks for the permanent replacement confirmation to be ticked.
  Backing up the old content is optional; the mode needs no prior reset and no successfully saved safety backup, and it also
  works in environments that support only downloads.
- The plan is prepared on an empty workspace with the same profile and the target deviceId; it keeps the backup's complete
  identity, history, state, drafts and attachments, applies the backup's layout and rescues unreachable positions.
  The plan is bound to the current revision; one CAS transaction replaces the workspace, the receipt and the attachment set.
  Old notes, history, drafts and unreferenced attachments are all removed and do not stay in Deleted; a backup without
  attachments must also clear the old attachments.
- The Workspace graph and the LayoutStore are replaced only after the persistent transaction succeeds; cancellation, an expired
  preview, a wrong profile or a failed transaction keeps the original data.
  A lost native response is confirmed by reading back the complete persisted bytes; a retry with the same receipt does not
  restore again. Google partitions and the journal forbid full attachment replacement.
- Before a complete local restore, automatic backups stop and the app waits until they are idle; the schedule resumes after
  completion or failure.
  Automatic backup settings and previously exported ZIPs, the data in Google and other account partitions, the sign-in state and
  the share inbox are not part of this operation.
  Restoring from Google to local notes uses "Switch to Local notes" before the restore; later local edits stay offline and are
  not written back to the source Google account.

## Consequences

### Positive

- The same ZIP can be downloaded, kept offline and restored across sources; wiping the old local data is one complete step that
  can fail without losing anything.
- A cloud export does not silently label an unsynced copy as the latest cloud backup, and the user can still rescue the known
  data while offline.

### Negative

- After a complete local restore is confirmed without an old backup, the old content cannot be recovered from the app.
- Google is not an atomic snapshot across many files; changes and drafts that other devices have not uploaded still cannot be
  included.
- A manual Google export has to wait for sync; safety backups and automatic backups may still contain only the currently known
  copy.

### Neutral

- The MSIX update and uninstall policy and the published 0.1.2 artifacts do not change, and there is no version bump or
  Actions dispatch.
- The shared format and flows can be verified synthetically; Apple and Android native compilation and real Google round trips
  need separately listed real-device evidence.

## Alternatives Considered

### Reset first, then import

Fewer steps, but clearing and restoring are separate, so after a failure the old data is already gone; one transaction is used
instead.

### Require a backup before every clear

It would add one more way to recover, but the local atomic replace keeps the original data on failure, and the maintainer
explicitly does not need to keep the old data, so the backup is optional for local notes.
The full Google overwrite involves several devices and non-atomic remote deletion, so it keeps the original safety backup rule.

## References

- [SPEC-002](../specs/002-portable-backup-and-restore.md), [PLAN-005](../plans/005-msix-data-and-cloud-overwrite.md)
- [ADR-013](013-complete-portable-backup.md), [ADR-037](037-msix-data-lifetime-and-google-backup-overwrite.md)
- [Google usage flow](../google-setup.md), [Testing boundaries](../testing.md)

---

*Decision made: 2026-10-12*
*Decision makers: Project maintainer*
