# ADR-013: Complete portable backup and an encrypted container

## Status

Accepted, 2026-10-04. Decided under the approved SPEC-003 Q01-Q07; it supersedes ADR-005's scope and format
candidates.
Accepting the design does not mean restore, automatic backup or the native file flows are delivered; current
status is in [PROGRESS.md](../../PROGRESS.md), and verification evidence is in the git history and
[docs/testing.md](../testing.md).

## Context

Shared data already uses an immutable graph. Backing up only the current text would lose conflicts, draft
baselines, attachments and group references.
Backups must be readable across accounts, and the values declared in a ZIP, its paths and password files must not
become a way to cause unbounded allocation or writes to arbitrary targets.
The user has approved complete backup, three restore modes and five platforms, and delegated the technical and
capacity decisions.

## Decision

- The public v1 ZIP keeps all known revisions, drafts, local preferences, the device layout and SHA-256-addressed
  attachments.
  It contains no credentials, profile, provider or old outbox envelopes; pending entries are kept as they are and
  marked known-local-data.
- `src/backup` does not depend on the source; it captures one Workspace snapshot, and the reader produces a
  defensively copied BackupDocument.
  verify/preview never write to the target; restore is bound to the profile, revision and receipt and commits
  atomically.
- fflate 0.8.3 (MIT) writes the ZIP; the reader checks local/central ranges, paths, sizes and CRC;
  decompression uses the standard DecompressionStream deflate-raw and rejects incomplete or trailing compressed
  streams.
- The outer ZIP holds only a header + ciphertext; PBKDF2-HMAC-SHA256 with 600,000 iterations, a random 16-byte salt,
  AES-256-GCM, a random 12-byte nonce, a 128-bit tag and the canonical header as AAD.
  WebCrypto keys are not extractable; no home-made cipher, ZipCrypto or plaintext settings are used to keep the
  password.
- 20,000 entries / 128 MiB expanded / 136 MiB plain ZIP / 25 MiB per attachment; JSON follows SPEC-004.
  Checks use the actual bytes; exceeding a limit or a missing attachment fails outright, never omitting data while
  claiming completeness.
- Import as new maps IDs; merge checks immutable identities; replace appends revisions that observe all heads,
  keeping history and drafts,
  and extra cards go to Deleted. Before replacing, a safety backup is saved; Drive revision files are never deleted
  directly.
- The RestorePlan is bound to the previewed revision; workspace, attachments, drafts, layout, outbox and receipt go
  in the same local CAS transaction.
  Browser File System Access first gets a handle, then confirms with write/close/SHA read-back; a plain download
  cannot unlock replace.
  A draft with the same name and different content gets a new ID and continues the lineage; ambiguous membership
  edges pause automatic continuation without deleting history.
- Automatic backup is off by default and runs only after 24 hours with changes, catching up on resume; it keeps
  seven copies by default and prunes only its own inventory.
  Encrypted schedules depend on OS secure storage; when authorization or the key cannot be obtained, they stop
  instead of falling back to plaintext.

## Consequences

### Positive

All known data can be verified on a round trip, and card extensions are not cut down; sources and renderers do not
need to know about ZIP or passwords.
The same strict reader verifies exports and restores, and a checksum is never taken as authorization of trusted
content.

### Negative

Full history and attachments increase memory and file size; this version is not an unlimited-capacity streaming
database.
WebCrypto AEAD needs the full payload, and the native KDF cannot be interrupted; a lost password cannot be
recovered.
The format does not use the password interface of ordinary ZIP tools; native files, secure storage and minimum
device capacity need separate acceptance.

### Neutral

Node >=22 supports deflate-raw; each WebView still needs a capability check and real tests.
Backup encryption does not mean Drive or the local database is end-to-end or at-rest encrypted.
Data never received cannot be included; keeping pending entries is more faithful to completeness than inventing
ancestors.

## Alternatives Considered

- Copying the DB or Drive as they are: binds to the provider, may carry credentials, and cannot replace a public
  portable format.
- Head-only / plaintext-only: does not meet the complete scope and loses lineage and attachments; rejected.
- The fflate Inflate reader: failure probes found it accepts some invalid DEFLATE, so the native strict stream is
  used instead.
- Argon2id: has advantages for general password hashing; this version chose PBKDF2 for WebCrypto portability, to
  avoid adding a WASM crypto dependency.
  It does not claim that PBKDF2 is better than Argon2id or that the product has FIPS certification.

## References

- [SPEC-002](../specs/002-portable-backup-and-restore.md)
- [Research and official sources](../research/2026-10-04-backup-container-and-encryption.md)
- [ADR-011](011-immutable-revision-graph.md), [ADR-012](012-durable-file-store-and-drive-adapter.md)

Decision made: 2026-10-04.
