# ADR-047: Linux startup does not depend on the keyring password

## Status

Accepted (local note key), 2026-10-15. The policy for Google credentials and backup passwords is superseded by
[ADR-048](048-linux-offline-workspace-and-system-secrets.md), which moves them back to the system vault and pauses the
related features while it is locked; the decision record below is kept as it was. The other Linux contracts stand.

## Context

The user reported that after adding the start at sign-in on the Raspberry Pi, every reboot asked for the keyring
password, the app still did not open after entering it, and stated plainly that this UX is unacceptable. The original
implementation kept the whole workspace's AES-GCM master key in the Secret Service, so even local notes alone first ran
a password lookup that could ask to unlock; Google credentials depended on the keyring too.
A read-only check on the Pi found two unlocked storage keys with the same name, of which only one passed verification
against all existing payloads. This is a concrete risk of decryption failing even after unlocking; the full path by
which this boot picked the wrong key has not been reproduced.

## Decision

- The Linux master key is stored in `storage-key` in the app data directory: 32 random bytes, file 0600, directory 0700,
  both owned by the current user; symlinks, non-regular files and permissions that are too broad are refused. The
  AES-GCM payload/AAD and SQLite transaction formats stay the same.
- The data directory's single-owner lock still applies; the key is written in full to a temporary file, fsynced, then
  published create-only, and the directory is fsynced.
  An existing key is never overwritten. New directories and already migrated data start without querying the storage
  keyring and do not need the Secret Service typelib.
- Only when an older version has a DB but no local key is the original Secret Service `storage-key/v1` read.
  `ALL | LOAD_SECRETS` reads only unlocked items; `UNLOCK`, password lookup, store and clear are never used.
  Several unlocked keys with the same name are each verified, rather than taking the first by query order. Every
  profile's records/attachments/staging/secrets and any existing credentials are first verified read-only, and only
  after that passes is the matching original key saved.
  When the key is locked, missing, wrong or corrupt, the original data and the original keyring stay as they are; no
  new key is created and the old encryption is not bypassed.
- Locked old data shows a one-time migration note: unlock in the system keyring manager and reopen, or restore from a
  portable backup.
  No password dialog is triggered automatically. After migration, the keyring can no longer block local notes.
- Google credentials are stored in a separate SQLite `credentials` table, encrypted with the master key and an
  account/purpose AAD.
  The first time an account is used, unlocked old credentials are read and saved; when locked, or when there is no
  Secret Service, the notes still open in a signed-out state and the user signs in to Google again. New sign-ins,
  refreshes and sign-outs never write the keyring.
  Credentials survive profile switches and workspace resets; sign-out saves an empty revocation marker that stops old
  tokens from being migrated again.
- libsecret moves to an optional runtime dependency / DEB Recommends, for migrating old data; other apps' keyring
  settings are never deleted or changed automatically.

## Consequences

### Positive

- Local notes, desktop presentation and the start at sign-in work directly, with no password dialog because the
  keyring is locked separately.
- Old data keeps its original encrypted bytes and the same key is saved after verification, so the whole DB does not
  need re-encrypting.
- Google credentials are never given to the renderer, portable ZIPs or workspace resets, and old tokens are not reused
  after sign-out.

### Negative

- The master key sits in the same directory as the DB. This is protection by OS account and file permissions, and
  cannot stop someone who can read the whole data directory from decrypting it.
  root, a malicious process of the same account and offline reads of an unencrypted disk can still get the content;
  keyring-level disk protection cannot be claimed.
- Old data still needs the original key; removing the password dialog cannot recover a lost key, and losing the local
  key likewise loses the ability to decrypt.

### Neutral

- The native secure storage policies of Windows/Apple/Android, and explicitly chosen portable password backups, keep
  their existing contracts.
- The original keyring items are kept for recovery and compatibility with older versions; a downgraded build still
  depends on the keyring. No system-wide keyring cleanup is done automatically.

## Alternatives Considered

### Unlock automatically or change the system keyring password

- Needs an extra password or changes a security setting shared with other apps, and cannot give a reliable direct
  start; not adopted.

### Only delay the start at sign-in

- With automatic sign-in the keyring may stay locked, so a delay does not remove the precondition; not adopted.

### Discard the key or rebuild the DB

- Old notes could not be decrypted and data could be lost, which breaks the requirement to keep user data; not
  adopted.

## References

- [ADR-024](024-linux-native-owner-and-storage.md), [ADR-043](043-desktop-window-placement-and-startup-behavior.md).
- [Linux README](../../src/native/linux/README.md), [security boundaries](../security-guidelines.md), [testing](../testing.md).
- [libsecret search_sync](https://gnome.pages.gitlab.gnome.org/libsecret/method.Service.search_sync.html):
  `LOAD_SECRETS` loads only unlocked items, and only `UNLOCK` asks to unlock (consulted 2026-10-15).

---

*Decision made: 2026-10-15*
