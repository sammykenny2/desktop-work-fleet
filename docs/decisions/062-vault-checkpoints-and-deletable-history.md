# ADR-062: Current-state vault checkpoints and deletable note history

## Status

Proposed, 2026-11-01. The maintainer requested ADR/SPEC/PLAN documents for an independent review before
implementation. The confirmed requirements and unconfirmed choices are separated in
[SPEC-010](../specs/010-vault-checkpoints-and-deletable-history.md); the proposed work is in
[PLAN-011](../plans/011-vault-checkpoints-and-deletable-history.md).

This record authorizes no runtime change, data reset, version bump or release. Existing contracts remain in force
for the implemented runtime. In this document, **vault** means the account's note dataset and synchronization
metadata, not the operating system's credential vault.

## Context

The current graph retains every full revision and needs complete ancestors to project a head. Initial Drive sync
enumerates and downloads history and attachments. Workspace and native persistence also copy/serialize the whole
history during ordinary saves. Removing a history file alone would break graph completeness and existing sync
integrity checks. The evidence and provider limits are recorded in
[the dated research](../research/2026-11-01-drive-vault-checkpoints-and-deletion.md).

The requested direction permits permanent deletion, anticipates automatic removal of whole notes after time in
Trash, and requires ordinary operations to stay efficient as history grows. Automatic per-version retention is
explicitly excluded. There is no requirement to migrate the old test data: a new app must instead offer an explicit,
recoverable reset of the old Work Fleet data in Google Drive.

## Decision

### 1. Incremental synchronization with current-state checkpoints

Propose incremental writes, periodically consolidated into verified current-state checkpoints, with retained
history stored separately. The analogy is incremental backup plus synthetic full; the result is a synchronization
protocol, not a backup chain or a shared database file placed in Drive.

| Plane | Purpose | Loading boundary |
|---|---|---|
| Control | Dataset generation, initialization, current checkpoint discovery, purge barriers and policy | Bounded discovery; entity-specific controls fetched as needed |
| Current state | Full current note/group values, unresolved heads, causal summaries and recent committed changes | Normal bootstrap and incremental synchronization |
| History | Retained versions and paged indexes for each entity | Explicit browsing, restoration or export of that history |
| Attachments | Verified bytes with explicit ownership/references | On demand; referenced bytes uploaded before publishing new content |

A checkpoint is logically complete for its declared coverage. Physically it is an immutable manifest referencing
bounded chunks; unchanged chunks can be reused. It contains current values and every unresolved branch, not all
historical bodies. Incremental records initially carry complete changed-entity values, not a text-patch chain.
History storage may later use independently decodable packs, but deleting one version must not strand surviving
versions behind a missing delta base.

Set finite budgets for tail bytes/records, active checkpoint candidates, catalog pages and catch-up work. Reaching a
budget triggers consolidation or current-state reconciliation, rather than a longer replay chain. If maintenance
cannot progress, keep acknowledged local edits and show pending sync; do not discard data or silently remove the
budget. Time-based scheduling alone cannot enforce the bound.

### 2. Causality is independent of retained history bodies

Use current-state causal summaries to distinguish successors from concurrent edits. The proposed starting point is
an entity-scoped dotted version vector: a writer incarnation, an increasing entity counter, and the causal context
the edit actually observes. Writer incarnation IDs are never reused by cloned/restored installations. Checkpoint
stream coverage is separate from entity causality; a high counter does not excuse a gap in a captured stream.

No device timestamp or arbitrary checkpoint ID chooses a content winner. Ordinary edits preserve the existing
conflict barrier; explicit resolution observes all previewed heads. A late unseen branch remains a conflict.
Missing required current chunks are integrity failures. An intentionally purged historical payload is neither a
missing current dependency nor permission to invent ancestry.

The exact summary encoding and retirement of old writer incarnations need proof in PLAN-011 Phase 0. Metadata can
grow with writers and conflicts; moving an unbounded list of revision IDs into a checkpoint would not solve the
problem.

### 3. Publish before retiring; preserve concurrent writers

Prefer immutable candidate manifests and receipts over overwriting a shared mutable `latest.json`. A candidate
declares the source checkpoints, included stream prefixes and chunk digests. Publish it only after required bytes
are verified. A reader activates the candidate and its local cursor in one transaction.

Two incomparable candidates remain visible and are merged; a wall-clock or lexicographic choice cannot discard
either. A later candidate may retire only predecessors and deltas it demonstrably covers. New edits outside that
coverage remain discoverable. Deleting a retired transport delta also requires proof that its retained history
representation exists, unless a separately authorized purge covers it.

The physical Drive catalog and atomicity argument are an explicit design gate, not an assumed API capability:
bounded discovery must survive concurrent publication, stale catalog responses, lost acknowledgements and a
publisher dying during cleanup. A proposal that needs a full history scan to repair routine publication fails the
gate. No implementation may substitute last-writer-wins or an unverified lease to get past it.

### 4. Indexed local persistence on every host

Separate current entities/heads, history, unsaved changes, outbox, controls, attachment references and maintenance
journals. An ordinary save atomically updates its affected records and outbox without serializing old history.
The bridge accepts bounded typed transactions and paged reads, not arbitrary SQL or HTTP. Preserve one local
writer, account isolation, CAS, durable acknowledgements and the device-only unsaved changes of ADR-061.

Windows, macOS, Linux, iOS, Android and the browser adapter need the same semantics. This work does not depend on
adopting the proposed desktop process split in ADR-058.

### 5. Deletion is a durable decision followed by physical cleanup

Keep logical Trash separate from permanent purge. A trash episode has its own identity and deadline; restoration
cancels that episode, and a later move to Trash creates another. Live notes do not age out their versions.

A purge first publishes a content-free barrier bound to the vault generation and exact target, then removes
content through a resumable journal. The proposed concurrent rule is terminal purge of a note identity: once the
barrier is committed, a late offline edit/restore cannot resurrect that identity. Unpublished local work is retained
separately for explicit Save as copy. The exact precedence and recovery presentation await review in SPEC-010 Q03.

Cleanup covers history, current chunks and retired checkpoint copies, deltas, caches and unreferenced attachment
bytes. A shared current chunk must be replaced with a verified sanitized chunk before its old file is deleted.
References and in-flight transfers must be fenced so another writer cannot publish a new reference to a retired
chunk. A reader racing with collection reacquires current state; it does not fetch a purged historical body to
repair the miss. Content-bearing cloud files are immutable and eventually deleted as whole files, so a mutable
file's provider-managed revisions do not retain forgotten copies.

Prefer note-scoped ownership for remote attachments in the initial redesign, with hash reuse within that note.
Global cross-note deduplication is deferred unless its reference/collection protocol is proven; the tradeoff is
additional bytes when notes share an attachment. Local deduplication may continue with transactional references.
No online collector guesses that a blob is unused from one device's partial history cache.

Purge barriers contain no text, title or attachment bytes. They are partitioned/indexed and queried for relevant
identities, not downloaded as an ever-growing startup list. Old incarnations cannot be readmitted just because a
barrier was compacted. Logical removal, cloud cleanup and cleanup acknowledged by each device are distinct states;
external backups and disconnected devices cannot be claimed erased remotely.

### 6. Reset incompatible test data, without migration

Keep note/sync/backup JSON schemas at V1 under ADR-051. Distinguish the incompatible layout with an explicit format
or required-capability discriminator, rather than silently treating all V1 data as interchangeable.

Recognize an old layout without decoding all its history and offer an explicit reset bound to the verified account
and application data space. Persist the plan before writes; establish a new generation, isolate the new data, and
clean only the old scope using metadata/IDs. New clients reject old-generation uploads and never relabel an old
outbox as new. Old clients cannot be remotely forced to stop writing with the same OAuth grant; they must be updated
or stopped, and their incompatible writes are not consumed by new clients.

Preserve SPEC-008's prepare/ready integrity and deterministic initial-group identity. The proposed new generation
may become usable after its current-state requirements are verified while old-generation cleanup continues, but
the UI must keep cleanup pending until confirmed. This change to reset completion is reviewed explicitly. A local
incompatible profile remains intact until the user chooses its disposition; no startup migration or automatic
deletion is introduced.

### 7. Backup completeness stays explicit

A current-state checkpoint is not a portable backup. Keep self-contained export, unsaved changes/layout handling,
encryption and validated restore, while adding an explicit manifest of historical coverage. An empty history cache
cannot masquerade as a complete account history. Fetching all retained history for a complete export inherently
costs its bytes and requires revisiting the existing ZIP capacity contract.

Purge barriers apply to ordinary merge/replace and history restoration. Explicit recovery as new data maps to new
identities and previews the reintroduction; backups never reinstate the old identity automatically. No new automatic
incremental-backup product is introduced by the synthetic-full analogy. The coverage defaults, capacity and bulk
operation performance exception remain review questions in SPEC-010 Q06.

### Intended relationship to existing decisions

This table is a proposed replacement scope, not a declaration that the old runtime has changed.

| Existing contract | Proposed change | Retained boundary |
|---|---|---|
| ADR-011 / SPEC-004 | Remove mandatory permanent payload retention and complete-ancestry startup | Strict validation, replay integrity and explicit conflicts |
| ADR-012 / SPEC-004 | Filtered current discovery, bounded catch-up, checkpoint publication and authorized collection | Account-bound native transport, retries, checksums and durable reservations |
| ADR-013 / SPEC-002 / ADR-038 | Explicit history coverage and purge-aware restore; review large export format | Portable self-contained recovery, local/Google interchange, encryption and preview |
| ADR-053 / ADR-054 / SPEC-008 | Generation-scoped bootstrap with current readiness separate from old-data cleanup | Deterministic initial group, resumable journal and integrity before activation |
| ADR-009 / ADR-015 / native storage contracts | Record-level local transactions and paged history | One writer, protected storage and restricted bridge |
| ADR-051 / SPEC-007 | No schema bump or migration; explicit incompatible-format reset | Pre-store V1 policy and no silent destruction |
| ADR-061 | Preserve unsaved work when a remote permanent purge prevents saving to its old identity | Device-only unsaved changes and explicit Save as copy |

## Consequences

### Positive

- Startup, ordinary save and current search can be independent of retained-history volume.
- Historical content can be removed without breaking current-state causality.
- Trash expiration is a whole-note lifecycle rule, separate from history storage optimization.

### Negative

- Checkpoint publication, bounded discovery and collection add a distributed protocol that needs independent proof.
- Local storage and all native adapters change; this is not a renderer-only or Drive-only feature.
- Snapshots duplicate some content temporarily, so a correct purge must find and eliminate those copies too.
- Full-history export and physical cleanup still cost their data volume. Exact-deadline cleanup is unavailable
  when no client can run; offline copies and user-owned backups remain separate deletion boundaries.

### Neutral

- No new server, listener, runtime dependency, app release or change to desktop interaction is selected here.
- Logical full checkpoints can reuse chunks; consolidating the sync tail does not delete retained user history.
- Performance budgets and provider behavior are unverified; approval of these documents is not an acceptance result.

## Alternatives Considered

| Alternative | Benefit | Reason not selected as the main model |
|---|---|---|
| Keep all revisions on the startup path and add a delete button | Small surface change | Leaves history-dependent I/O and breaks complete ancestry when payloads disappear |
| Traditional unbounded incremental chain | Small individual writes | New devices and old offline clients eventually replay the entire chain |
| Differential since the last full snapshot | Few inputs to restore a point | Repeatedly transfers already-changed entities and grows until another full snapshot |
| Rewrite one complete account JSON on each save | Simple read path | Account-wide write contention and repeated serialization; no safe multi-writer overwrite |
| Per-note full objects only | Simple ownership and purge | Many content GETs at bootstrap; evaluate as a baseline, not a guaranteed fast final layout |
| Automatically expire individual note versions | Limits history growth | Explicitly excluded by the maintainer; performance must work while live history grows |
| Use Drive's file revisions as note history | Less application indexing | Provider retention and revision behavior do not implement our conflicts, purge or portable history |

## References

- [SPEC-010](../specs/010-vault-checkpoints-and-deletable-history.md),
  [PLAN-011](../plans/011-vault-checkpoints-and-deletable-history.md)
- [Evidence and API limits](../research/2026-11-01-drive-vault-checkpoints-and-deletion.md)
- [SPEC-004](../specs/004-revision-graph-and-file-sync.md),
  [SPEC-002](../specs/002-portable-backup-and-restore.md),
  [SPEC-008](../specs/008-workspace-initialization.md)
- [ADR-051](051-schema-evolution-and-atomic-migrations.md),
  [ADR-061](061-unsaved-changes-instead-of-drafts.md)

Proposal date: 2026-11-01. Decision and implementation approval are pending maintainer review.
