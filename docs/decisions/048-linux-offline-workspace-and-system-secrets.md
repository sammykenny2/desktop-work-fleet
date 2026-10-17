# ADR-048: Linux keeps offline notes and system secrets apart

## Status

Accepted, 2026-10-15. Supersedes ADR-047's policy for Google credentials and backup passwords; keeps its local note
key and the migration of old workspaces.
Amended the same day: the user reported that on 0.2.4, pressing "Sync now" still could not lift the pause, so an
explicit, manually triggered system unlock was added; the background policy is unchanged.

## Context

The user required that startup never force a keyring or user password, and also pointed out that Linux should not
weaken the protection of Google tokens and backup passwords for that reason.
ADR-047 put the workspace master key in the same directory, which removed the startup dependency, but it also let
anyone holding the whole data directory decrypt the sign-in tokens and automatic backup passwords.
Offline work and the sensitive operations that may pause need to be separated. This authorization covers fixing the
code only, not a version bump, install or release.

## Decision

- Notes, drafts, history, attachments, content waiting to sync and non-secret backup metadata keep using AES-GCM with
  the 0700 data directory and the 0600 `storage-key`.
  New data and data whose master key has been migrated open directly; OS account and file permissions remain the
  protection boundary for local content.
- Google access/refresh tokens, account sign-in data and saved automatic backup passwords move to the Secret Service's
  persistent default collection.
  Google credentials are isolated per account; a backup password's vault ID includes the profile and key ID. SQLite
  `secret_refs` keeps only identity, enabled/revoked and cleanup state.
  New secrets are never stored in SQLite, backup ZIPs, the renderer or the local key file, and never fall back to local
  storage when the vault fails.
- The lazy libsecret import stays; local notes do not need it, while Google, saved backup passwords and old data
  migration need a working Secret Service.
  Only an existing, unlocked persistent default collection is accepted; session collections are refused, no collection
  is created, and the keyring password is never changed.
- The collection's Locked property is first read live over D-Bus, and `ALL` is searched only in an unlocked collection;
  the global SearchItems and `UNLOCK` are not used.
  Canonical reads search only the persistent default; new values come through GetSecret / libsecret session decoding,
  not the proxy's stale lock or secret cache.
  Old cross-collection credentials are migrated in only when the default has none and is usable; they can never
  overwrite existing default credentials.
  Storing uses the session encoding negotiated by libsecret and calls `CreateItem` directly; deleting calls Item
  `Delete` directly. When a read, write or delete meets a prompt object, it reports a pause and does not call
  `Prompt.Prompt` automatically. This avoids convenience store/clear APIs that unlock or prompt automatically.
- Building the Google source does not read the vault; the page opens offline content first. `google.status` returns a
  pausable state instead of failing to open the workspace.
  The vault is checked again before every use of a token; if it becomes locked later, a cached token cannot keep being
  used.
  The UI shows "Sync paused" and points to Sync now; periodic and startup retries never ask to unlock.
  Linux declares the `vaultUnlock` capability; only when the user presses "Sync now" is the fixed `google.unlockVault`
  called, and after confirming vault-locked it calls D-Bus `Service.Unlock`/`Prompt.Prompt`, unlocking only the
  persistent default collection.
  The system handles password entry and the app never receives the password; after unlocking, the original credentials
  are read again and the original account resumes syncing, with no new OAuth.
  When already unlocked there is no repeated Prompt; other problems such as a missing service never ask for an
  unrelated password. Cancel or a 90-second timeout returns to the paused state and keeps the retry available;
  the deadline starts when the host receives the request and covers queuing, the preliminary queries, the Prompt and
  reading the credentials back, and an expired request never opens a late dialog.
  Closing or switching accounts cancels pending operations, and the UI discards results from an old source. Waiting
  for Completed has a time limit, Dismiss does not block returning, and nothing relies on the provider still sending
  Completed after a cancel. Interactive operations run on the network worker and never hold the notes DB or bridge
  lock while waiting for the Prompt.
  The forced-refresh state after an HTTP 401 is not overwritten by re-reading the vault.
- A vault failure during an encrypted backup reports `backup-vault-unavailable`; the existing schedule pause keeps the
  pending work and the last successful backup, and never switches to plaintext.
  Google and vault-related backup operations use the network worker and do not hold the DB or storage bridge lock while
  waiting for the vault.
  After the Secret Service owner changes, a new proxy/session bound to the new owner is created, so later retries can
  recover.
- ADR-047's local credential/backup-key exist only for upgrade migration and cannot serve as a runtime fallback while
  the vault is locked.
  Migration is tried in the background after the page is ready, and again whenever the related secrets are used. The
  vault write and read-back complete first; only then are the local copies removed in a transaction and a reference
  saved.
  `secure_delete`, WAL checkpoint/truncate and VACUUM clean old ciphertext out of the current DB/WAL; a failed cleanup
  leaves a retry marker.
  While the vault is unavailable or the save is unconfirmed, the old copies are kept so sign-ins and backup passwords
  are not lost; during this transition the weaker ADR-047 protection still applies.
- Sign-out first saves a persistent revoked reference and cleans the old local copies; deleting from the vault is best
  effort. Old tokens cannot be imported again after unlocking, restarting or clearing notes.
  ADR-021's policy of signing out only this device stays, and the whole project grant is not revoked with Google.
  Clearing a workspace revokes only that profile's backup password references; Google credentials and other profiles
  are kept.
- SQLite `user_version=2` stops an older schema-1 build from opening the data after a downgrade and storing secrets
  locally again; the product version was not changed in this change.

## Consequences

### Positive

- Everyday notes and the start at sign-in are not blocked by a system vault password dialog; a manual sync has a direct
  way to unlock and resume syncing.
- After migration, copying only the app data directory does not give access to Google tokens or saved backup passwords.
- Duplicate collections, a temporary vault, service restarts and interrupted migrations all have keep-on-failure and
  retry behavior.

### Negative

- The Linux local note key still sits in the same directory as the data; its offline confidentiality is weaker than a
  design where the OS vault protects the master key.
- Automatic sign-in may leave the keyring locked, so zero password entry and unconditional automatic sync/encrypted
  backup cannot both be promised.
  The user can press "Sync now" to unlock through the system dialog, or set up system secure storage that unlocks
  automatically.
- Cleaning the current SQLite file is not a physical secure erase of the storage device, snapshots or old backups;
  malicious programs of the same account, root and memory reads are outside the protection boundary.
- After the default alias is pointed at another persistent collection, recorded secrets may be temporarily not found;
  restore the original default, or sign in again / set the backup password again.

### Neutral

- The Windows/macOS native secure storage implementations are unchanged. The shared UI shows a vault pause only when
  the host explicitly returns paused.
- When an old workspace's master key has not been migrated and the original vault is locked, a one-time unlock is still
  needed to get the original data; no substitute key is created.

## Alternatives Considered

### Keep everything local, continuing ADR-047

- No vault dependency, but the whole data directory can decrypt the sign-in tokens and backup passwords; the user asked
  for a fix, so not adopted.

### Move everything back to the system vault

- The workspace master key would depend on unlocking too, bringing back the startup behavior where even writing notes
  is blocked; not adopted.

## References

- [ADR-047](047-linux-local-key-without-keyring-prompts.md), [ADR-021](021-windows-google-account-and-sync.md).
- [Secret Service behavior research](../research/2026-10-15-linux-secret-service-without-prompts.md).
- [Security boundaries](../security-guidelines.md), [testing](../testing.md), [Linux README](../../src/native/linux/README.md).

---

*Decision made: 2026-10-15*
