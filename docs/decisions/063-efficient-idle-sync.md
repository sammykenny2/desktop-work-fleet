# ADR-063: Efficient idle synchronization without a format change

## Status

Accepted direction, 2026-11-03. The maintainer authorized implementation after the
ADR/SPEC/PLAN proposal. Independent review and real-provider acceptance remain open.
This proposal supplements ADR-062; it does not replace its publication, checkpoint,
purge or explicit legacy-reset protocol. Publication requires separate authorization.

## Context

An empty, already synchronized workspace still spends much of its polling interval
showing "Syncing". The [investigation](../research/2026-11-03-idle-sync-request-cost.md)
separates a reproducible provider-call baseline from native HTTP amplification and
unmeasured real-account latency. The cost comes from repeated generation validation,
two pulls even without uploads, repeated local projection work, and Apple's per-request
URLSession lifetime. It is not evidence that another data layout is necessary.

The existing dataset has an account-scoped changes cursor, verified current-view
references, immutable control records, and atomic local record transactions. Those
are sufficient for a cheaper unchanged check. A shorter poll cannot substitute for
correct deletion, account isolation or preservation of unsaved work.

## Decision

### 1. Keep every persisted format unchanged

Keep the existing V1 schemas, dataset format identifier, file kinds, appProperties,
local record shapes, maintenance journals and backup contract. Add no cloud sentinel,
heartbeat, manifest or persisted cache certificate. Existing compatible full and sparse
datasets remain usable; this work requires neither migration nor reset. The older
incompatible-format recovery path remains governed by SPEC-010.

### 2. Give unchanged checks their own bounded path

After a complete validated reconciliation in the current runtime, retain an in-memory
validation record bound to the account, source, profile, sync session, dataset, current
view and committed cursor. This record authorizes only a read-only check.

When there is no pending publication, unobserved local head or cloud maintenance,
read the existing appDataFolder changes feed once. Only a valid terminal page with
zero changes can take the shortcut. Commit its cursor and successful-check time
through a narrow local transaction, retaining all note, draft, outbox and view data.
The ordinary empty path does not load shard bodies or rebuild the workspace graph.

Every nonempty or nonterminal response returns to the existing guarded reconciliation
from the original committed cursor. This deliberately keeps event interpretation,
checkpoint merging and purge application out of the first optimization. Do not filter
events to the current dataset before deciding that a page is empty.

The [SPEC](../specs/011-efficient-idle-sync.md) defines admission, races, local commit,
query parameters and concrete examples. No new Drive transaction or CAS is assumed.

### 3. Retain explicit validation boundaries

Run the existing full path on a new runtime, account/session change, incomplete view,
recovery or rejected cursor. In an otherwise eligible idle session, perform one full
generation audit when five minutes have elapsed since the last successful full
validation; combine it with that round's empty-feed check. An audit failure invalidates
the shortcut and preserves the last committed cursor and local work.

The five-minute interval is a proposed defensive default, not a deletion lease or
permission to write using cached checks. Actual publication, purge, checkpoint retirement
and reset retain their fresh guards and SPEC-010 safety rules. An empty feed reports
what Drive returned through its cursor; it cannot guarantee that another device will
not write immediately afterwards, or impose a visibility deadline on Drive.

Remove the unconditional second pull only when the pass performed no publication
and has no reconciliation work requiring it. A pass that published data still verifies
its observed result. Do not remove before/after guards around actual remote mutations.

### 4. Reuse native connections without sharing account authority

On macOS and iOS, keep a Drive transport session for an authenticated account context,
with separate bounded response state for each task. Retire that context on sign-out
or account replacement; cancel a single request without invalidating unrelated tasks.
Keep per-request authorization, redirect rejection, byte limits, cancellation, timeout
and integrity checks. Audit Windows, Linux and Android independently; change their
transport lifetime only where measurements or code establish the same problem.

### 5. Make background status reflect useful work

An automatic empty check keeps the previous completed state and its timestamp visible.
Actual incoming changes, queued uploads, initialization, manual refresh and recovery
show activity. Failures remain visible. Coalesce timer, visibility and host-tick triggers;
do not run overlapping checks or replay every missed timer after sleep. Keep the
existing nominal 20-second polling cadence in this scope.

## Consequences

- Ordinary eligible idle checks need one Drive request and a constant-size local
  metadata transaction. History size does not affect this path.
- First use, changed feeds and audits have separate, explicit budgets. This is not
  a claim that all synchronization completes in one request or one second.
- Runtime validation and transport lifetimes need careful invalidation and race tests.
  They are discarded on restart, so compatibility does not depend on new stored fields.
- A real authenticated native measurement is required before accepting the performance
  result. Fixture counts cannot establish Drive latency, control-event visibility or
  connection reuse on a physical device.

## Alternatives considered

| Alternative | Reason not selected |
|---|---|
| Another schema, mutable "latest" pointer or heartbeat file | The existing feed supplies the needed signal; another mutable authority introduces coordination and compatibility work. |
| Only hide the spinner or lengthen the poll interval | Leaves unnecessary network and local work, or delays remote edits. |
| Keep five full validations but parallelize more requests | Retains request volume and repeated native connection setup. |
| Cache generation checks for writes as well | A cached read result cannot authorize publication after a reset or permanent deletion. |
| Add Drive push notifications now | Requires a reachable HTTPS receiver and still needs change-feed reads; a new server is outside the product boundary. |

## References

- [SPEC-011](../specs/011-efficient-idle-sync.md), [PLAN-012](../plans/012-efficient-idle-sync.md).
- [ADR-062](062-dataset-checkpoints-and-deletable-history.md),
  [SPEC-010](../specs/010-dataset-checkpoints-and-deletable-history.md).
- [Request-cost investigation and primary sources](../research/2026-11-03-idle-sync-request-cost.md).
