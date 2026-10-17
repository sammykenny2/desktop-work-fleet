# ADR-011: Immutable revision graph and a strict JSON contract

## Status

Accepted, 2026-10-04, under the maintainer's authorization for the complete 1.0 implementation and its technical
details.
It accepts the source-independent format and the revision graph rules; the current state of implementation and
integration is in [PROGRESS.md](../../PROGRESS.md), with history and verification evidence in the git history and
[docs/testing.md](../testing.md). Nothing here implies that Google or five-platform acceptance has passed.
It fills in ADR-004's revision candidate; its native OAuth and provider integration still need real evidence.

## Context

Drive file listings can be out of order, duplicated or missing dependencies; two offline devices cannot keep both
inputs by relying on clocks or a single overwritable file.
The existing local outbox already records the full value and parent, but no strict wire format, remote integrity
or pending behaviour is defined yet.
Backups need to keep branches, deletions, groups, attachments and unknown extension fields, not just export the
projected text.

## Decision

- Adopt the schema 1 envelope of [SPEC-004](../specs/004-revision-graph-and-file-sync.md).
  A revision is one immutable full value of a card or group; the parent set expresses causality, and updatedAt is
  never used to pick a winner.
- A replay is accepted only if the canonical bytes of the same revision are identical; otherwise that batch stops.
  An unknown envelope schema is rejected; value extensions are kept.
- Strict JSON rejects duplicate fields, invalid Unicode, unsafe numbers and non-JSON data; fixed limits are 8 MiB,
  64 levels and 200,000 value nodes. parents has at most 1,024 entries; beyond the limits the original data is
  kept and reported, never silently truncated.
- Iterative topological analysis first checks every known parent and cycle; only nodes with complete ancestry take
  part in heads.
  A missing parent and all its descendants stay pending; no root revision is guessed and old heads are not hidden.
- An explicit resolution of multiple heads creates a new revision that includes every head seen; a late branch can
  still become a conflict.
  All revisions are kept; the first version does not run remote garbage collection itself.
- The Workspace commits revisions, the outbox, the projection, the cursor and the required device references in
  the same transaction;
  a session is bound to the profile, the source and a runtime nonce that is never written to disk, so a restart
  must set up a new session.
  An existing complete outbox can be migrated into the revision graph; if history is missing the data is kept and
  the migration stops, with no invented root revision.
- The projection follows group redirects without changing the original wire value; it keeps the local entity order
  and all existing geometry.
  Multiple heads block ordinary content overwrites; only an explicit adoption or a history restore creates a new
  revision that includes all current heads.
  Group cycles keep the data and are resolved by restoring a group or explicitly choosing a target again; saving
  drafts is not blocked by cycles.
- The wire carries no device layout, OAuth credentials or drafts. Public OAuth and build settings go through
  `.env.example`,
  and the build writes only an allowlist to `build/config/public.json`; real credentials are kept in native secure
  storage.

## Consequences

### Positive

Replay and out-of-order results can be verified, and old content and unknown formats are not lost through parsing
or automatic decisions.
Pure ES modules let the five platforms share the same rules, and backups can keep the full causal information.

### Negative

Full history adds storage and scanning cost and needs later capacity measurements; 8 MiB is a per-record limit,
not a capacity promise for all data.
Multiple heads and group redirects still need a usable UI and recovery flow; revision graph tests alone do not
make the user-facing delivery complete.

### Neutral

No third-party runtime dependency is added and the prototype Python server is not changed.
Google public IDs and native acceptance environments are not set up yet, so the rules and failure validation that
do not depend on them are done first.

## Alternatives Considered

- Last writer wins: simple to implement, but wrong clocks and concurrent offline edits would eat content;
  rejected.
- A single editable notes.json: widens contention to the whole account and cannot serve as a multi-machine
  atomicity guarantee.
- Treating a missing parent as a root: the order in which files are scanned could change results and conflicts;
  rejected.
- Trusting the data straight after JSON.parse: duplicate fields are already dropped and unsafe integers already
  rounded, so the loss cannot be detected.

## References

- [SPEC-004](../specs/004-revision-graph-and-file-sync.md)
- [ADR-004](004-google-drive-notes-mvp.md)
- [ADR-009](009-local-renderer-and-persistence.md)
- [PLAN-002](../plans/002-google-drive-notes-mvp.md)
