# PLAN-012: Efficient idle synchronization

## Metadata

| Field | Value |
|---|---|
| Status | Core, UI and transport implemented; authenticated/all-platform acceptance and independent review pending |
| Owner | Maintainer |
| Reviewer | Independent review pending |
| Related specification | [SPEC-011](../specs/011-efficient-idle-sync.md) |
| Related decision | [ADR-063](../decisions/063-efficient-idle-sync.md) |

## Overview

Implement the specified empty-feed shortcut and local metadata transaction without
changing persisted formats. Improve native connection lifetime and background status
in separately testable slices. Each implementation slice includes its relevant tests
and owning documentation in the same commit. The maintainer approved implementation;
this plan does not authorize a version
bump, release, reset or operations on a real account.

## Implementation phases

### 0. Review and reproducible evidence

- [ ] Obtain review of eligibility/invalidation, the empty-page transaction, audit policy
  and the unchanged write/purge boundaries; resolve findings before claiming acceptance.
- [x] Turn the [baseline procedure](../research/2026-11-03-idle-sync-request-cost.md)
  into deterministic provider-call and local-record counters. Keep HTTP counts distinct
  from bridge/provider counts; identify cold, ordinary idle, audit and changed-data runs.
- [x] Add an opt-in native diagnostic route using the app's own account context and
  Drive transport. Produce aggregate request kinds/counts, bytes, durations and reuse
  metrics, never tokens, raw cursors, account/file IDs, note content or request headers.
  Apple Debug implements this route; it measures native transport separately from the full sync round.
- [ ] Establish an authenticated read-only baseline before optimizing the native path.
  Use a legitimate in-app sign-in, not extraction from a protected app container or a
  connector with a different OAuth application. Missing authorization remains an explicit
  evidence gap, not a passing stub result.

Deliverable: reviewable design and a repeatable measurement route, including real-native
baseline evidence where authorized. Only that evidence can substantiate elapsed-time claims.

### 1. Empty-result local commit

- [x] Add a serialized workspace operation for SPEC-011's cursor/time-only update,
  checking session, binding, cursor, view, pending heads and maintenance epoch.
- [x] Add a narrow WorkspaceRecordStorage write using the existing sync/active rows
  and revision guard. Avoid generic current/draft enumeration and whole-state cloning.
- [x] Test persisted reopen, failure before/after commit, stale storage receipts,
  concurrent unsaved text, a new save and invalidated sessions. Maintenance races are covered in Phase 2.
- [ ] Exercise the unchanged native record transaction on macOS, Windows, Linux,
  Android and iOS; retain separate evidence for JS fixtures and native databases.

Deliverable: bounded metadata persistence with no schema or record-shape changes.

### 2. Bounded idle request path

- [x] Implement runtime validation eligibility, maintenance exclusion and invalidation
  exactly as SPEC-011; warm only after a complete verified reconciliation.
- [x] Make one existing changes request; accept only a valid empty terminal page.
  Replay every other valid page from its original committed cursor through the existing
  guarded path. Preserve existing error, backoff and cursor-recovery behavior.
- [x] Add the five-minute full audit and resume handling. Keep write-time validation
  independent of the idle record; do not expand caching to mutation authorization.
- [x] Remove the unnecessary second pull in a pass with no publication or required
  follow-up reconciliation; retain post-publication observation.
- [x] Add regression coverage for every fallback and concrete scenario in SPEC-011,
  including old compatible full/sparse fixtures, critical removals and legacy reset events.
- [x] Assert the one-request ordinary budget, explicit audit budget and constant local
  work with fixed current data and 0 / 10,000 / 1,000,000 historical fixture revisions.

Deliverable: the fast path with deterministic safety and cost checks. It is not accepted
as real Drive proof until Phase 5.

### 3. Native connection reuse

This slice is independent of the JS shortcut and can be developed after Phase 0;
it does not wait for the large-history fixture work.

- [x] Give Apple Drive traffic an account-context transport lifetime and bounded
  per-task state. Preserve individual cancellation, redirects, timeouts and integrity.
- [x] Test registration/cancellation races, exactly-once completion, parallel bounded
  responses, oversized responses, sign-out/account switch and host shutdown.
- [ ] Use URLSession task metrics to verify reuse on macOS and iOS where the server
  permits it. A test server proves client behavior, not live Google reuse.
- [x] Audit Windows/Linux/Android HTTP client lifetimes; record evidence and fix only
  demonstrated recreation problems without broad unrelated networking changes.

Deliverable: native transport improvements with account isolation and measured lifetime.

### 4. Quiet background checks

- [x] Separate automatic check activity from applying/downloading/uploading data and
  manual refresh. Preserve previous completion time; expose failures/pending work.
- [x] Coalesce timer/online/visibility/host events and handle one resume check. Preserve
  immediate follow-up for newly saved work without back-to-back idle polling loops.
- [x] Reuse existing English and Traditional Chinese status entries; no new text is needed.
- [x] Cover background empty/audit, delayed/error, manual refresh and incoming changes
  in production renderer probes; cover pending-upload follow-up in presenter tests and
  resume invalidation in controller tests. No window activation is added.

Deliverable: status that follows actual work, without using UI changes to mask cost.

### 5. Authenticated acceptance and integration

- [ ] Use the app's native diagnostic route for at least 30 ordinary warm checks per
  available host/network. Separate authentication refresh, retries, audit and cold runs;
  compare request counts and latency with Phase 0.
- [ ] Observe appDataFolder create/update/delete and control-file events with isolated
  test data under the actual app OAuth context. Destructive scenarios use an explicitly
  authorized disposable account/dataset; they never reset the maintainer's live notes.
- [ ] Run two-client save/purge/reset, account switch, offline/resume and interrupted
  local-commit scenarios. Verify D03 purge precedence and protected unsaved text.
- [ ] Complete macOS/Windows/Linux/Android/iOS native checks, separating emulator,
  physical-device, renderer and authenticated-Drive results. An unavailable environment
  stays unverified and prevents an all-platform acceptance claim.
- [ ] Obtain independent review of the implementation. The documented regression suite,
  Apple builds, native component checks and renderer probes run during implementation;
  owning testing/behavior documents distinguish them from unavailable device/provider evidence.

Deliverable: evidence for the SPEC's budgets and safety cases. Only then mark the plan
complete; publication remains a separate authorized task. Rollback is a code rollback
to the existing full path, with no data conversion or reset.

## Files to create or modify during implementation

| Area | Expected files |
|---|---|
| Read path and validation lifetime | `src/sources/dataset-sync.js`, `src/sources/dataset-protocol.js`, relevant dataset tests |
| Metadata-only local commit | `src/core/workspace.js`, `src/storage/workspace-records.js`, `tests/workspace-records.test.js` and workspace tests |
| Provider parsing / HTTP counters | `src/native/google.js`, native Drive handlers, provider/transport tests |
| Apple transport | `src/native/apple/Shared/BoundedHTTP.swift`, `src/native/apple/Shared/FleetDrive.swift` and native probes |
| Status / scheduling | `src/app/main.js`, locale catalogs, renderer probes |
| Evidence and acceptance procedures | `scripts/testing/`, `docs/testing.md`, affected platform READMEs and this plan's checkboxes |

Do not alter JSON
schemas, native DB schemas, package versions or release notes for these slices.

## Testing strategy and risks

Use targeted Node tests for each slice, the native transport/record probes for changed
hosts, and renderer probes for status. Integration uses the documented `npm test`,
Python unittest suite, build/config checks and documentation checks; report skips as skips.

| Risk | Mitigation |
|---|---|
| Empty check skips a control event | Keep the unfiltered appDataFolder feed, replay every nonempty page, audit periodically and retain fresh mutation guards. Verify real control-event behavior before acceptance. |
| Cursor success overwrites a local edit | Serialize and recheck at commit time; merge only sync metadata; retain the store revision guard. |
| Runtime cache survives a reset/account switch | Invalidate before admitting maintenance and reject stale sessions/callbacks. Never persist eligibility. |
| Reused transport shares authorization or loses byte bounds | Request-local headers and buffers; account-context retirement and cancellation/limit tests. |
| Fast fixture mistaken for live performance | Separate semantic counts, native HTTP counts, authentication, network time and device evidence. |
| Unrelated history traffic makes feeds nonempty | Fall back safely; report the changed-path cost. A selective event fast path would require a later reviewed change. |

Created: 2026-11-03.
