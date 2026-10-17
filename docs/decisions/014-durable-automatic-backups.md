# ADR-014: Automatic backup job records and native file capabilities

## Status

Accepted, 2026-10-04. It refines SPEC-002 / ADR-013 and does not reduce the automatic/encrypted backup
requirement on the five platforms.
Native hosts and secure storage still need implementation and acceptance; current status is in
[PROGRESS.md](../../PROGRESS.md), and verification evidence is in the git history and
[docs/testing.md](../testing.md).

## Context

The app may exit between writing a backup, reporting success and cleaning up old files. A simple timer or a scan
by file name cannot recognize a job that was saved but whose response never arrived, and may delete files the
user changed or replaced.
If backup state were written back into the Workspace, it would count itself as a content change and trigger
another backup.

## Decision

- Under each profile's single-writer lease there is a separate CAS journal that keeps settings, pending, inventory
  and success/failure.
  It is not in the Workspace, sync or the portable ZIP; passwords go only through the account-bound OS vault, and
  the journal records only an opaque key ID.
- Off by default; once enabled it runs only when there are changes and at least 24 hours have passed since the
  last success, and it catches up once on start, on becoming visible or on resume.
  Triggers are coalesced, and the cancel controller is created while the job is still queued. Errors back off from
  one minute up to one hour; invalid authorization or key pauses it.
- A location maps to a scheduleId; every settings save creates a policyId, so a change of encryption or key needs
  a new backup even if the content did not change.
  A vault key reference cannot change its password in place and keep the same identity. Disabling and changing the
  location keep the existing files.
- The complete ZIP is produced and verified first; the job ID, the chosen location, a fixed UUID file name and the
  SHA/size are persisted, and only then is the host asked to create the file.
  After success, the inventory and lastSuccess are updated; if the ack is lost, the full journal can be read back,
  or after a restart the bytes of the pending file are compared.
  An incomplete file is recorded as unconfirmed and kept, and another job is created; unconfirmed files are never
  overwritten or cleaned up.
- It can be enabled only when a trusted host declares the create-new capability. Creation and cleanup must handle
  races where files are replaced;
  "check that it does not exist / check the hash first, then act on the pathname later" is not treated as an
  atomic guarantee.
  Browser File System Access lacks the guarantees this needs, so the preview's automatic file capability is
  unavailable and manual export stays.
- With an atomic delete-by-identity capability, cleanup only touches the verified inventory of the same
  profile/schedule/location, seven copies by default, 1-90.
  It first confirms that the latest successful file is still complete; if it is missing or changed, old files are
  kept and a new copy is created. If a delete ack is lost, deleting the original file that no longer exists can be
  retried.
  Without the cleanup capability, everything is kept and this is stated; unsafe pathname deletion is never used
  silently.
- When the journal itself is invalid, the broken record is not overwritten, and the UI still publishes a transient
  paused/error state; it resumes only after a successful reread.
  The inventory is limited to 10,000 entries, and exceeding it never deletes other locations or unknown files.

## Consequences

### Positive

The schedule is not triggered over and over by its own records; after a process exit or a lost response, finished
jobs can be checked.
Encryption settings, actual file capabilities and save results are separate, and a failure never falls back to
plaintext or deletes old files.

### Negative

Reliable file and vault adapters must be implemented per platform; the browser preview cannot stand in for
delivering native automatic backup.
Changed locations and unconfirmed files take more space; automatic cleanup does not trade the file identity
guarantee for a tidy folder.

### Neutral

While the app is closed or the OS is suspended, timing is not guaranteed; the resume check catches up. The public
settings in `.env.example` do not store these running jobs, file grants or backup passwords.

## Alternatives Considered

- A daily timer writing the same file name directly: overwrite races and unclear crash state; rejected.
- Scanning a folder and cleaning up by date/prefix: cannot prove ownership; rejected.
- FSA handle + size/hash + removeEntry: on real OPFS, swapping the file midway still overwrote or deleted the new
  file, reproducibly; rejected.
- Keeping the password persistently in the browser: lacks the required OS secure storage; plaintext or ordinary
  IndexedDB are not used as substitutes.

## References

- [SPEC-002](../specs/002-portable-backup-and-restore.md), [ADR-013](013-complete-portable-backup.md)
- [File capability research](../research/2026-10-04-automatic-backup-file-safety.md)
- [Contract](../../contracts/backup.d.ts), [PROGRESS](../../PROGRESS.md)

Decision made: 2026-10-04.
