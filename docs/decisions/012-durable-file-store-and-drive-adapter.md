# ADR-012: Recoverable FileStore and a Drive appDataFolder adapter

## Status

Accepted, 2026-10-04, under the authorization for the complete 1.0 and its technical details; it follows ADR-011,
and adopts and supersedes ADR-004's still-open choice of provider and data space. Native authorization and real
tests on the five platforms are each accepted separately.

## Context

A source may already have received a file while the success response never arrived; if a retry creates a new ID,
duplicate files appear.
Changes from other devices can also arrive during a full scan. The graph, cursor, pending operations and
attachments must be recoverable separately, and a sync failure must never be treated as deleting content.
The Google project and the platforms' OAuth client IDs are not set up yet.

## Decision

- The first provider is Google Drive appDataFolder, and the only Drive scope is drive.appdata;
  no user-visible Drive folder, sharing or note server of our own is added. The five platforms' public IDs are
  configured through `.env.example`.
- FileSync is separate from FileStore. The former holds the Workspace session, outbox, scanning and retry policy;
  the latter is bound to a verified account and only allows creating immutable files, listing and reading. The
  interface is in `contracts/sync.d.ts`.
- Google pre-generates the file ID; the reservation is saved together with the local operation before the upload.
  A retry pins the ID, kind, SHA-256 and size.
  After success, the confirmed file is recorded and the matching outbox entry removed in the same transaction;
  history is not deleted.
  A 409 must be read back and its bytes compared; the HTTP status alone is never taken as success.
- A full scan first keeps the changes start point in memory; data may be written to disk page by page, but the
  completion cursor stays null.
  After the listing is complete and existing files are confirmed not to have vanished, the start point is
  committed and the changes are caught up. An interruption restarts the full scan, and replay is safe.
  Each incremental page saves the data, the file ledger and the cursor atomically; completed earlier pages are not
  rolled back when a later page fails.
- Attachments are addressed by SHA-256; the transfer completes before the revision that references it is sent.
  Downloads are verified and the bytes saved as octet-stream;
  the partition is fixed to session.profileId. A failed transaction may leave unreferenced attachment bytes, but
  never updates the revision or cursor early.
- Remote removal, changed file content or metadata, unknown formats, failed checksums and incomplete listings all
  keep the local data and stop with a report.
  A missing file is never treated as a card tombstone; history is not cleaned up automatically and source data is
  not repaired automatically.
  The Drive changes feed includes the automatically created "App Data" folder itself, with only id, spaces and
  trashed; all five implementations request `mimeType` and skip folders, while other files with missing fields
  still stop the sync (2026-10-06).
  The changes feed also lists `removed` entries for reserved file IDs whose upload never finished; FileSync skips
  them.
- Drive files use the private metadata wfFormat/wfSchema/wfKind/wfSha256, and the body never carries the file
  name.
  A single revision is limited to 8 MiB and an attachment to 25 MiB; if the Google server checksum is missing, a
  successful upload is still read back and compared.
- Non-empty files use 1 MiB resumable chunks, and the server's Range decides which bytes were received. Temporary
  errors back off and then query progress;
  any resumable 4xx clears the session, and the next attempt creates a new session with the same file ID. Empty
  attachments use multipart.
  The upload URL stays only in the memory of the account-bound adapter, never in the Workspace, backups, the
  renderer or logs.
  After a process restart the upload can be resent from the original file ID; keeping the byte offset across
  processes is not promised yet.
  The resumable-upload `Location` that Google really returns (checked 2026-10-06) carries `uploadType` and
  `upload_id`, echoes the request's `fields` parameter and adds Google's own `session_crd`. Validation therefore
  accepts any non-duplicate query parameters with safe values, as long as `uploadType=resumable` and a non-empty
  `upload_id` are present.
  Google may return the `fields` value with literal commas instead of `%2C`; Apple's `URLComponents` keeps them,
  so the Apple transport accepts both forms (2026-10-15).
- The protected HTTP transport pins the Google HTTPS host, rejects redirects, streams responses with a size limit
  and supports abort.
  The Google adapter does not receive tokens; authorization, refresh and OS secure storage are the native
  service's job.
  `AuthorizedDriveRequest` is an interface inside the service; exposing a bridge for arbitrary requests to the
  WebView renderer is forbidden.
- A new account partition first receives the source with bootstrapGroup=false, so that a new device does not add
  another "My notes" by itself.
  First creation for an empty account follows [ADR-053](053-account-scoped-initial-group.md): after a complete
  pull, FileSync uses the group and root revision identities shared by the account / reset batch;
  the user's existing local notes are not removed.

## Consequences

### Positive

Lost responses, restarts, interrupted pages and offline branches can all be replayed; the source has no path to
silently overwrite the text.
Google transport details stay out of the revision graph, and other FileStores can use the same set of failure
tests.
The first real Drive round trip (2026-10-06, Windows) uploaded three revisions and a 1,975,966-byte attachment in
resumable chunks; names, appProperties and Drive's `sha256Checksum` matched, and every file downloaded with the
recorded SHA-256.

### Negative

Immutable history and a reservation per operation add storage and API calls; capacity must be measured, and the
single-file limit is not a total capacity guarantee.
The resumable URI is not kept across processes, so a process restart may resend the first bytes of an unfinished
attachment.
Whether each platform's client ID sees the same account data, production OAuth and the native transports still
need real Google acceptance.

### Neutral

No package or listener is added; the local renderer still does not connect to Google. Fixtures and real IndexedDB
probes are recorded separately.
Drive files are not a complete backup; the automatic / encrypted / import / merge / replace backup scope approved
in SPEC-003 stays.

## Alternatives Considered

- Retrying with a new file ID: easily leaves several copies of the same operation; rejected.
- Treating every 409 as success: may accept a collision or different content; rejected.
- Overwriting a shared large JSON each time: widens contention and breaks immutable branches; rejected.
- Writing tokens or upload URLs into the ordinary Workspace: increases secret exposure through the renderer,
  backups and logs; rejected.

## References

- [SPEC-004](../specs/004-revision-graph-and-file-sync.md)
- [Drive transport research](../research/2026-10-04-drive-file-transport.md)
- [ADR-004](004-google-drive-notes-mvp.md), [ADR-011](011-immutable-revision-graph.md)

Decision made: 2026-10-04. Current status is in [PROGRESS.md](../../PROGRESS.md); execution and test history are
in the git history and [docs/testing.md](../testing.md).
