# ADR-016: Windows native backup files and keys

## Status

Accepted, 2026-10-04. Implements the Windows backend of SPEC-002 / ADR-014; the other four platforms are accepted
separately.

## Context

Automatic backup needs to recognize the files it created after the app reopens; storing only paths and hashes
cannot prevent replacement by a file with the same name.
Automatic schedules need continuous encryption, but the renderer should not get the password back from the OS
vault.

## Decision

- Windows authorizes a local NTFS location with the native folder picker. The first open rejects filesystem
  reparse points
  and stores the Volume GUID path, the volume / 128-bit file ID and the creation time; reopening checks the folder
  identity again.
  Native identities of folders and files are stored only in C# and never round-trip through a JavaScript number.
- Later child files are opened with the `RootDirectory` of the Windows SDK `NtCreateFile`, relative to the
  directory handle already held.
  Ancestor paths that could be renamed are never resolved again. Creation uses `FILE_CREATE` and never overwrites
  an existing file.
- An automatic job first has a shared journal pending entry; while the new file handle is locked, the native side
  first persists the file identity and then writes.
  After writing it calls `Flush(true)` and checks the full size/SHA on the same handle. A file left by an
  interruption does not pretend to be rolled back;
  after a restart the complete original file can be confirmed, or the unfinished file is kept for inspection.
  If saving the native identity fails after creation, it only checks whether a file with the same name exists and
  lists it as unconfirmed; it never reads or claims its content.
- Cleanup needs a verified journal and native creation records from the same profile, the same schedule and
  location, and can never clean up the latest file.
  It first checks that the latest backup is still complete and holds a handle on it that denies write/delete until
  the cleanup of old files is done; each old file is checked for identity/size/SHA through its own locked handle
  and deleted with `FileDispositionInfo` on that same handle. A lost result can be retried; a replaced or modified
  file is kept.
- Manual export also picks a folder, and the host generates `work-fleet-backup-UUID.zip`; each export creates a
  new file, and a picker grant is used once.
  A lost save response does not unlock replace restore; the user can pick again and create another safety backup.
- schema version 2 adds profile-bound `capabilities`, whose metadata is also encrypted with DPAPI CurrentUser;
  version 1 records, attachments and vault are kept. Passwords still use an immutable vault key ID.
- The shared schedule now calls vault `encrypt` instead of password `read`. The native side uses .NET
  PBKDF2-SHA256 600,000 / AES-256-GCM, a random 16-byte salt / 12-byte nonce and the canonical header as AAD,
  producing the same SPEC-002 ZIP envelope; the shared reader can restore it with the original password. An
  invalid key never falls back to plaintext.
  When DPAPI cannot decrypt or the folder was replaced, the schedule pauses and waits for explicit handling and a
  retry.
- The restricted bridge only adds methods for backup grants, creation, read-back, cleanup, key creation and
  encryption.
  It accepts no renderer paths and offers no vault read; the password is entered only when the user sets it, and
  after native encryption it is never returned.
  Once a native commit starts, the actual result is followed; a normal close first cancels preparation work and
  waits for the schedule journal to finish.

## Consequences

### Positive

Proof of saving, recovery after restart and retention cleanup rest on real file identities; encrypted schedules do
not need to hand the stored password back to the renderer.

### Negative

Only local NTFS (including qualifying removable drives) is allowed for now; network drives, FAT/exFAT and
link/junction locations are rejected.
It is not claimed that all external drives, cloud placeholders or power-loss scenarios pass. Users can move
finished ZIPs themselves;
after a move, the new location is not treated as a managed file of the original schedule.

### Neutral

Native grants, passwords and the schedule journal are not in the portable ZIP; a new device needs the location
picked again and the original password entered.
While directory or file handles are held, the OS may refuse outside renames or writes; failures keep the data and
show a clear retry.
Clearing temporary byte buffers does not guarantee that GC strings or operating system memory are zeroed.

## Alternatives Considered

### Delete after a pathname check

Simple to implement, but the file can be swapped between the hash check and the delete; not adopted.

### Return the vault password to the shared JavaScript

WebCrypto could be reused, but the stored password would be exposed further; native code produces the portable
encrypted result instead.

## References

- [Native file and encryption research](../research/2026-10-04-windows-native-backup-files.md)
- [SPEC-002](../specs/002-portable-backup-and-restore.md), [ADR-014](014-durable-automatic-backups.md)
- [ADR-015](015-windows-native-storage-and-editor-host.md), [Verification commands](../testing.md)
