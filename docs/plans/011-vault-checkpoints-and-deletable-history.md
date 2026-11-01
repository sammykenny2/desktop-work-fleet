# PLAN-011: Vault checkpoints, deletable history and Trash expiration

## Metadata

| Field | Value |
|---|---|
| Status | Draft; implementation not started or approved |
| Owner | Project maintainer |
| Assigned To | Unassigned |
| Reviewer | To be assigned by the maintainer |
| Date | 2026-11-01 |

## Related Spec

[SPEC-010](../specs/010-vault-checkpoints-and-deletable-history.md), based on proposed
[ADR-062](../decisions/062-vault-checkpoints-and-deletable-history.md).
The [research](../research/2026-11-01-drive-vault-checkpoints-and-deletion.md) separates repository/API evidence
from unverified protocol and performance assumptions.

## Overview

The authorized deliverable is the design package for independent review. The tasks below describe future work;
none is completed by drafting these documents. No runtime, account data, schema number or app version changes in
this documentation task. Maintain execution status in this field and the checkboxes, with evidence in commit
bodies and owning verification documents; no session or release-status log.

Review first, then prove the remote publication/collection model before implementing it. Establish indexed local
transactions and current-state synchronization before enabling destructive operations. Preserve every supported
platform and ADR-061's unsaved-work behavior. The proposed desktop process isolation in ADR-058 is not a dependency.

## Implementation Phases

### Phase 0: Independent review and scope decisions

- [ ] 0.1 Have the maintainer's reviewer evaluate ADR-062 and SPEC-010, especially U versus D/Q authority,
  current/history separation, checkpoint coverage and deletion of every content copy. Record the review outcome
  in the resulting commit body; do not label author consistency checks independent review.
- [ ] 0.2 Resolve the product choices Q03-Q06: purge versus unseen restore/edit, Trash time policy, manual deletion
  scope, complete/known-local backup coverage, bulk completion expectations and capacity strategy.
- [ ] 0.3 Approve a bounded protocol/benchmark experiment scope and isolated test resources for Q01/Q02/Q07.
  The document request does not authorize writes/deletes in a real Google account or use of production data.
- [ ] 0.4 Record approved versus still-proposed decisions in the owning ADR/SPEC and authorize the relevant
  implementation phases. Do not weaken U03/U04 merely because an experiment is difficult.

**Deliverables**: independent findings, explicit scope decisions and authorization for proof work. A favorable
architecture review alone is not a passing implementation or a license to erase old user data.

### Phase 1: Prove publication, causality and capacity before freezing formats

- [ ] 1.1 Specify concrete V1 record shapes, query indexes, candidate/receipt discovery, stream prefixes and
  retirement rules. Preserve a distinct incompatible-layout marker without a schema bump or migration machinery.
- [ ] 1.2 Build a deterministic model of multiple writers, incomplete/reordered pages, stale discovery, partial
  uploads, lost responses, concurrent consolidation and cleanup. Prove that no acknowledged current change is
  omitted and that both incomparable checkpoints remain discoverable (VC03-VC06).
- [ ] 1.3 Prove dotted causal summaries, incarnation changes, outbox reconciliation and baseline comparison without
  old payloads; model per-entity causality separately from stream-prefix coverage (VC08, VC09, VC12).
- [ ] 1.4 Define finite chunk, tail, catalog, writer and work-queue budgets and a progress/overload policy. Exercise
  many historical tombstones/checkpoints and continuous writers, not just a quiet happy path (VC07, VC19, VC26).
- [ ] 1.5 Implement a lazy synthetic provider that can represent H = 10,000 / 100,000 / 1,000,000 without preloading
  history into the measured startup path. Fix current content/W/conflicts, instrument forbidden historical work,
  and agree absolute latency targets on named hardware/network profiles (VC01, VC02; Q07).
- [ ] 1.6 With separately authorized isolated Google data, check filtered/paginated app-data discovery, concurrent
  publication, checksum/read-back, removal feed traffic and cleanup interruption. Test folder cascade only as an
  optional optimization; do not rely on batch media downloads or an unverified conditional-update primitive.
- [ ] 1.7 Amend the proposed protocol with the evidence, obtain independent review of its safety/progress argument,
  and close Q01/Q02/Q07 before dependent production code. If the candidate cannot meet the bounds, revise the ADR
  rather than adding a silent whole-history rescan fallback.

**Deliverables**: reviewed, concrete codecs/protocol and quantified acceptance budgets. Model tests and provider
probes have separate results; neither substitutes for the other.

### Phase 2: Indexed local state and transaction boundary

- [ ] 2.1 Define bounded typed local reads/transactions for current entities/heads, paged history, unsaved changes,
  outbox, purge controls, attachment references and maintenance journals. Keep account/session/CAS fencing.
- [ ] 2.2 Refactor Workspace/projection/conflict access so current operations never copy the complete history and
  no UI path implicitly materializes it. Preserve group redirects, pending work and SPEC-003 interaction behavior.
- [ ] 2.3 Implement the IndexedDB adapter and native SQLite adapters/bridges for Windows, Apple, Linux and Android.
  A history table hidden behind a whole-workspace JSON API does not satisfy the change.
- [ ] 2.4 Exercise rollback, uncertain acknowledgements, process restart, one-writer ownership, account switching,
  large history and device-local unsaved baselines (VC02, VC09, VC12, VC25).

**Deliverables**: durable record-level persistence on all hosts with measured write amplification; no automatic
opening/conversion/deletion of incompatible old local profiles.

### Phase 3: Current-state sync, checkpoint consolidation and lazy history

- [ ] 3.1 Implement the verified catalog/checkpoint/tail codecs, strict limits and native typed provider operations.
  Keep credentials and resumable URLs out of the renderer, workspace and portable backup.
- [ ] 3.2 Implement filtered bootstrap, atomic staged activation, bounded changes catch-up and safe reconciliation
  for long-offline clients. Preserve pending local work and authoritative deletion checks (VC01, VC03, VC06, VC07).
- [ ] 3.3 Implement replayable upload/history publication and checkpoint consolidation; only retire covered data
  after replacement and required historical representations are durable (VC04, VC05, VC08, VC09).
- [ ] 3.4 Add paged per-entity history and selected-version restoration, with cancellation, stable cursor refresh
  and stale-preview protection. Download attachments on demand and label offline availability truthfully (VC10).
- [ ] 3.5 Prove bounded discovery under candidate crashes, retired writers, stale checkpoints and group redirect
  history; enforce overload/backoff rather than letting the current tail become a second history log (VC19, VC26).

**Deliverables**: current-state sync independent of H, with history round trips and five-platform adapter coverage.
Destructive actions remain disabled until the following phases and their review gates pass.

### Phase 4: Explicit reset of incompatible old data

- [ ] 4.1 Detect legacy/incompatible controls with bounded metadata reads and show the verified target scope. Retain
  unreadable local data until explicit disposition; do not require new-format parsing to offer an old-cloud reset.
- [ ] 4.2 Implement persisted reset stages, a new generation namespace, exact old deletion scope and safe resume.
  Verify no delayed job can delete new data or relabel an old outbox (VC20, VC21).
- [ ] 4.3 Preserve prepare/ready integrity, one shared starter and deliberately empty workspaces. Distinguish current
  readiness, old-data cleanup and a backup restore's final completion (VC22).
- [ ] 4.4 Add localized preview/progress/recovery and the requirement to stop/update old clients. Test fixtures for
  legacy flat files, unknown payloads, conflicting reset plans and old-client writes; use real test data only within
  the Phase 0/1 authorization.

**Deliverables**: reviewed reset flow that needs no migration and never silently clears a signed-in account.

### Phase 5: Purge, attachment collection and future Trash expiration

- [ ] 5.1 Implement approved purge barriers, exact target validation, idempotent journals and the terminal-identity
  or alternative rule selected under Q03. Preserve distinct unpublished work for the approved recovery UI.
- [ ] 5.2 Track content locations/references in current and retired chunks, tails, history packs and cached previews.
  Sanitize shared chunks before collection; fence stale publishers/readers and preserve neighboring notes (VC16).
- [ ] 5.3 Implement note-owned attachment lifecycle and local transactional references; exercise concurrent upload,
  restore/export pins, cache eviction and cleanup without global history scans (VC12, VC17).
- [ ] 5.4 Implement only the manual actions approved under Q05, including revision-protection rules, explicit
  confirmations and preview-bound Empty Trash (VC11, VC12, VC18).
- [ ] 5.5 Add Trash episodes/policy/deadline indexes and the approved clock rules. Enable automatic expiration only
  after Q04 is settled; offline or suspended clients do not fabricate an execution time (VC13-VC15).
- [ ] 5.6 Add truthful logical/cloud/device cleanup states, bounded background scheduling, process-death resume,
  local cache/undo invalidation and barrier compaction without resurrection (VC15, VC18, VC19, VC25, VC26).

**Deliverables**: explicit deletion with verified content cleanup; automatic whole-note Trash expiration is a
separate acceptance step. No automatic per-version retention is added.

### Phase 6: Complete backup and purge-aware restore

- [ ] 6.1 Revise the V1 manifest/container under Q06 to declare a pinned capture boundary and exact current/history
  coverage. Keep exports self-contained; handle large history within validated streaming/staging/capacity limits.
- [ ] 6.2 Make complete export retrieve and verify its declared history/attachments; make partial known-local scope
  explicit. Retain encryption, native save receipts and ADR-061 unsaved/layout semantics (VC23).
- [ ] 6.3 Apply purge controls to merge/visible replace/history recovery and preview conflicts. Map explicit recovery
  as new data to new identities; keep local/cloud full replacement an explicit generation-reset operation (VC24).
- [ ] 6.4 Exercise purge during capture/read/restore, stale previews, missing bytes, capacity failure, cancellation,
  account change and process death. Confirm no old history re-enters through backup reservations (VC12, VC23-VC25).
- [ ] 6.5 Verify automatic backup continues with truthful coverage and existing grants/retention/encryption rules;
  do not introduce a new incremental-backup chain merely because sync uses checkpoints.

**Deliverables**: portable backup/restore with honest completeness and no implicit purge bypass.

### Phase 7: Acceptance, documentation and independent implementation review

- [ ] 7.1 Run the shared JS/Python suites and applicable native/browser probes from `docs/testing.md`, plus the new
  VC01-VC26 behavioral/fault/performance coverage. Record platform-specific unverified boundaries explicitly.
- [ ] 7.2 Run fixed-current-data history-scaling checks and separate growth tests for N, W, conflicts, purge records,
  historical group redirects, stale checkpoints and feed backlog. Publish measurements with their environments,
  never only a claim that a million-record generator completed.
- [ ] 7.3 Obtain independent read-only protocol, destructive-operation and implementation review; fix findings with
  targeted regression coverage before enabling destructive commands in builds used with real data.
- [ ] 7.4 Update supersession/status in owning ADRs/SPECs as approved behavior lands, this plan's tasks, architecture,
  testing, native READMEs and both user-guide editions. Update PROGRESS only for changed project-level truth.
- [ ] 7.5 Report implemented/verified/unverified behavior and remaining gates. App versions, installation and release
  dispatch remain separately authorized; no release bookkeeping commits follow publication.

**Deliverables**: reviewed behavior and evidence mapped to SPEC-010, with safe reset guidance and no migration.

## Files to Create/Modify

These are expected integration points, not a claim that new modules already exist.

| Area | Planned work |
|---|---|
| `contracts/sync.d.ts`, `contracts/native.d.ts`, `contracts/backup.d.ts` | Concrete V1 control/current/history records, bounded storage operations and coverage |
| `src/core/workspace.js`, `src/sources/revisions.js`, `src/sources/projection.js` | Current causality and indexed atomic mutations independent of historical bodies |
| `src/sources/file-sync.js`, `google-drive.js`, `files.js`, `source-reset.js`, `workspace-initialization.js` | Filtered discovery, candidate publication/collection, generation reset and purge controls |
| `src/storage/native.js`, `src/storage/indexed-db.js` | Paged reads, typed transactions and explicit incompatible-profile handling |
| Windows `LocalDatabase.cs` / bridge / `NativeGoogle.cs`; Apple `FleetDatabase.swift` / `FleetDrive.swift`; Linux `database.py` / `google.py`; Android `FleetDatabase.java` / `GoogleFiles.java` | Native persistence, transport validation and interruption behavior |
| `src/backup/`, `src/app/backup.js`, `src/app/automatic-backup.js`, `src/app/conflicts.js` | Coverage, purge-aware restore, paged history and localized progress |
| `src/i18n/locales/en/`, `src/i18n/locales/zh-TW/` and native tables | English-first product text with locale parity |
| `tests/`, `tests/native/`, `scripts/testing/` | Deterministic protocol faults, isolated provider/native tests and measured work budgets |

## Technical Decisions

ADR-062 proposes incremental sync with consolidated current checkpoints and separate retained history. Consolidating
the transport tail does not prune note versions. Immutable content, verified coverage, indexed deletion controls
and native atomicity remain essential even when old payloads are deletable. Physical catalog/reference mechanics
are gated by Q01; naming a checkpoint format is not proof of a distributed commit protocol.

## Testing Strategy

- **This documentation task**: `python3 scripts/testing/check_docs.py`, `git diff --check`, link/ID consistency and
  scope checks. No new runtime or provider test result is claimed.
- **After approval**: deterministic adapters inject every commit, upload, receipt, catalog retirement and cleanup
  interruption. Instrument forbidden work, rather than relying only on elapsed time in tiny fixtures.
- **Persistence**: real IndexedDB and each native database/bridge exercise durable acks, rollback and reopened
  journals. Model persistence alone cannot prove disk durability.
- **Provider**: use specifically authorized isolated Work Fleet test data; ordinary accounts are not load-test or
  reset targets. Record Drive behavior separately from fake HTTP/changes-feed tests.
- **User flows**: exercise new-device login, long-offline reconciliation, conflicts, history restore, Trash episode
  cancellation, permanently deleted identity recovery and complete/partial export on each supported platform.

## Risks and Mitigations

| Risk | Impact | Mitigation / gate |
|---|---|---|
| "Current" catalog secretly grows with history | Startup slows again | Q01/Q07; measure candidate/listing counts and retired-object growth |
| Concurrent compaction hides a branch or drops history | Data loss | Exact coverage model, crash permutations and independent Phase 1 review |
| Purge deletes a shared chunk or leaves an old copy | Unrelated loss or incomplete deletion | Content/reference accounting, sanitized replacements and stale-publication fencing |
| Incorrect clock or unseen restore competes with expiry | Unexpected permanent loss | Q03/Q04, online revalidation and explicit unpublished-work recovery |
| A local cache becomes an allegedly complete backup | Undisclosed missing history | Q06 coverage manifests, hydration and round-trip validation |
| New-generation reset uses an old broad deletion loop | New data erased | Frozen exact scope, persisted stages and supersession tests |
| Per-record storage is implemented on only one host | Cross-platform behavioral divergence | Shared contract fixtures plus every native adapter before acceptance |
| Bulk jobs starve edits or never reach a bound | Slow UI or unbounded backlog | Work budgets, foreground priority, overload status and measured VC26 |

Created: 2026-11-01. All implementation tasks remain pending review and authorization.
