# SPEC-011: Efficient idle synchronization

## Metadata

| Field | Value |
|---|---|
| Status | Approved for implementation, 2026-11-03; independent review and native/provider acceptance pending |
| Owner | Maintainer |
| Reviewer | Independent review pending |
| Related decision / plan | [ADR-063](../decisions/063-efficient-idle-sync.md) / [PLAN-012](../plans/012-efficient-idle-sync.md) |

## Summary and goals

Confirm an unchanged Google dataset with one normal Drive request, keep local work
independent of retained history, and stop displaying every background poll as active
synchronization. Preserve the existing safety of changed-data reconciliation and writes.
The proposed contract applies to Windows, macOS, Linux, iOS and Android.

No persisted schema, format discriminator, cloud object, backup change, migration or
reset is part of this work. New-device bootstrap, permanent deletion, conflict handling,
manual history access and incompatible-format recovery retain SPEC-010 semantics.
Polling remains nominally every 20 seconds; push infrastructure and new background
execution privileges are outside scope.

## Requirements and design

### Eligibility and lifetime

The fast path is available only after the existing full path has committed a complete
current view in this runtime, including all shard-control references and purge decisions.
Retain a small in-memory record containing:

- Authenticated account context, sourceId, profileId, runtimeId and sync sessionId.
- Dataset binding identity, descriptor identity/hash, current-view references and cursor.
- Time of the last successful full validation and a maintenance invalidation epoch.

Do not persist this record or infer it solely from a saved cursor. A restart, account or
session replacement, dataset/view replacement, recovery, rejected cursor or uncertain
local commit invalidates it. Refresh it only after a successful guarded full pass or
the empty-page commit below. A matching runtime view avoids re-reading all 17 control
rows on every timer tick; a reloaded or externally changed store must be revalidated.

Pending outbox operations, local heads awaiting remote observation, initialization,
reset, restore, purge or checkpoint maintenance exclude the fast path. Ordinary unsaved
text and layout edits do not exclude it. Completed reset journals do not exclude it.
The application coordinator must invalidate eligibility before admitting cloud maintenance,
not after its first await. Recovered jobs are checked before warming the runtime record.

### One empty-page check

1. Capture the bound context, committed cursor `c0`, view references and maintenance
   epoch. Join an existing sync attempt rather than starting another one.
2. Use the existing native changes API:

   ```text
   GET https://www.googleapis.com/drive/v3/changes
       ?pageToken=<c0>&spaces=appDataFolder&pageSize=100&includeRemoved=true
       &fields=nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,parents,spaces,trashed,size,createdTime,appProperties,sha256Checksum))
   ```

   Retain the current metadata projection and account-bound authorization. Do not set
   `restrictToMyDrive=true`, narrow to a dataset, filter out foreign/legacy events,
   fetch a new start token instead, or convert malformed responses into an empty result.
3. A validated page with zero changes, no `nextPageToken`, and a valid
   `newStartPageToken` is eligible. Google's omitted empty array may normalize to `[]`;
   a present non-array is invalid. The terminal token may equal `c0`.
4. If five minutes have elapsed since the last full validation, run exactly one
   `assertGeneration` before committing this empty result. Use a monotonic elapsed
   clock and invalidate on a host resume after a long or unknown suspension. An audit
   failure commits neither the new cursor nor a success timestamp.
5. Enter the workspace's serialized mutation queue. Recheck account/session, binding,
   cursor, view, maintenance epoch, zero pending count and zero unobserved local heads.
   If any sync-relevant condition changed, discard the response, retain `c0` and schedule
   the appropriate normal pass. Do not acknowledge any operation from this response.
6. Atomically update only the existing `sync.cursor`, `sync.lastSuccessfulSyncAt`,
   workspace revision and active-record revision, using the existing storage revision
   comparison. Persist the existing sync metadata row and active row in one transaction.
   Publish the in-memory state and runtime record only after that transaction succeeds.
   A retryable local failure reuses `c0`; an uncertain commit requires reload/recovery.

This needs a narrow core/storage command, not a call to `receiveDataset` with empty
heads and not an invocation of the generic whole-workspace clone/diff path. It must
preserve the latest unsaved text, layout and other sync fields at queue execution time.
An ordinary edit while the HTTP request is pending is therefore retained; a new save
or purge fails eligibility and follows the guarded path. Existing native/IndexedDB
record transaction shapes and compare-and-swap semantics remain unchanged.

### Fallback and mutation boundaries

| Result or condition | Required behavior |
|---|---|
| Any nonempty page, even an irrelevant or legacy event | Discard the prefetch and run the existing guarded pull from `c0`; no cursor advance from the prefetch. The extra discovery request belongs to the changed-path cost. |
| Empty page with `nextPageToken` | Same fallback; an empty intermediate page is not caught up. |
| Malformed page, both/no terminal tokens, cyclic pagination | Preserve cursor and content; expose the existing stable error and invalidate eligibility. |
| Provider rejects the cursor | Existing bounded current-state reconciliation; never skip to "now" or load all history to repair the cursor. |
| Network/authentication/rate-limit error | Preserve cursor and work; existing error/backoff handling. No tight retries or reset prompt for a network failure. |
| Critical deletion, foreign generation or reset fence in the feed | Existing generation/recovery handling; do not convert missing files into note deletion authority. |
| Actual uploads or cloud maintenance | Keep fresh generation, purge and publication checks; the runtime record authorizes none of these writes. |

Replaying `c0` is intentionally simpler than introducing a second partial-page activation
protocol. Retain existing event/byte/page limits and atomic current/purge/cursor activation.
Skip a normal pass's final pull only if no publication occurred and no result reconciliation
requires it; bounded unfinished work schedules another pass. After any publication,
observe its result before removing local-head protection or claiming completion.

A pass with work proves the generation before its pull's first provider request, and
again before activating what the pull read. A proof lasts only until the next provider
request of that pass and never reaches a later pass. The start of a pull and the barrier
opening an operation can reuse one, because nothing has been read or written since; the
pull still proves before activating, and a note's opening barrier still lists its purges.
A remote write cannot reuse a proof from before its preceding read. A read precedes every
folder, attachment, body and receipt creation and ends the previous proof, so each has its
own; the exception is a creation directly after a parent folder made on sparse first use,
which follows only that folder's read-back. A checkpoint is proved after capturing its
inputs. A receipt is proved again after creation before it is acknowledged, including when
an uncertain receipt turns out to be covered already.

An empty check cannot lock Drive. A remote write immediately after its returned cursor
is found by a later poll. Feed visibility has no claimed hard deadline; the five-minute
audit is a defensive cross-check, not permission to weaken write-time guards.

### Scheduler and user-visible status

- Coalesce timer, online, visibility and native host-tick triggers into one attempt per
  account context. A missed timer alone does not queue an immediate second empty check.
  New local work during a check does request a follow-up. Resume schedules one check,
  not one for every missed interval; existing retry/backoff rules still apply.
- A routine background check or audit retains the last completed display with its last
  successful-check time. It does not flash "Syncing" or steal focus. Settings exposes
  when that successful check occurred; elapsed time is not evidence of freshness.
- Show activity immediately for manual refresh, first reconciliation, queued uploads,
  incoming changes and user-started maintenance. A manual refresh can use the same
  eligible one-request check; it does not force a full audit before its deadline.
- Show failures and pending work regardless of whether the request began quietly.
  Failed, incomplete or abandoned attempts do not update the success time. Unsaved
  edits keep their existing unsaved indicator; a successful cloud check does not save them.

### Native connection lifetime

For Apple Drive requests, an account context owns a reusable ephemeral URLSession.
Each task has its own byte limit, response buffer, cancellation and exactly-once
completion state. Authorization stays on each request, never in mutable session-wide
headers. Retain redirect rejection, allowed endpoint construction, streaming byte caps,
timeouts, response validation and content hashes. Task completion releases task state
without invalidating the session. Sign-out, account replacement and host shutdown
cancel/retire the context and prevent late callbacks from reaching a replacement account.

Test cancellation both before registration and during transfer, oversized/chunked
responses, redirects, concurrent completions and account replacement. Connection reuse
is observed through native task metrics; it is not guaranteed when the server or network
closes a connection. Other hosts require their own transport audit; changing a shared
HTTP helper must not alter unrelated authentication, avatar or update traffic accidentally.

## Concrete scenarios

```mermaid
sequenceDiagram
    participant App
    participant Drive
    participant Store as Local record store
    App->>Drive: changes.list(c0, appDataFolder, includeRemoved)
    Drive-->>App: empty, terminal cursor c1
    opt Five-minute audit due
        App->>Drive: one existing full generation validation
        Drive-->>App: matching generation
    end
    App->>Store: guarded atomic sync metadata + active revision
    Store-->>App: committed
    Note over App: retain notes/view; show last successful check
```

| Scenario | Example and expected result |
|---|---|
| Empty account | Dataset `dA`, ready receipt `ready-A.json`, complete view at `c10`. Drive returns an empty terminal `c11`: one request, metadata-only local commit, no folder or JSON-body reads. |
| Another device saves | `change-note7-r4.json` appears after `c11`. Prefetch is nonempty; replay from `c11` through guarded reconciliation and apply the new head with its cursor atomically. A save after an empty response belongs to a later poll. |
| Reset or permanent deletion | Feed contains `reset-B.json`, deletion of `ready-A.json`, or `purge-note7.json`. Take fallback before advancing. Preserve local edits; a terminal purge still defeats an unsynchronized restore, with distinct text available as a new note. |
| Edit or account switch during HTTP | Typing preserves the newest draft during the metadata commit. Saving queues an operation and prevents empty-path success. Switching from account A to B rejects A's late response and cancels its transport context. |
| Restart or delayed cursor persistence | Opening a saved `c11` without a runtime validation record uses the full path. Failure before local commit replays `c11`; failure with uncertain commit requires reload. Never substitute a newly fetched start token. |

Names above are illustrative, not lookup keys. Production discovery continues to use
the existing file IDs, parents and appProperties.

## Acceptance and measurement

| Case | Required result |
|---|---|
| Eligible empty check, no due audit, valid token, no retry | Exactly one `changes.list` HTTP request; no other Drive request, cloud write, history/body fetch, shard load, current projection or draft traversal. One local record transaction, at most two payload rows plus the existing store revision bookkeeping. |
| Eligible empty check with due audit | One feed request plus one `assertGeneration`; single-page current implementation budget is 6 HTTP requests once the session has verified the descriptor and ready receipt (ADR-065), or 7 if root-parent verification needs a listing. Pagination/retry/auth refresh are itemized separately, not hidden as the ordinary budget. |
| Steady idle, 20-second cadence | At most one due audit per five-minute period after warm-up. Fifteen eligible rounds use 15 feed requests plus one audit, not 15 full passes. |
| Retained history grows | Hold current state fixed and test 0, 10,000 and 1,000,000 retained versions. Empty-check request count, payload rows and local work do not grow with history. Large-history tests are fixtures, not a million writes to the maintainer's Drive. |
| Current state grows | Check empty and representative large current workspaces within existing capacity limits. The empty path does not clone/serialize note bodies or iterate current revisions/drafts. |
| One ordinary save, fixture with one existing note and every shard folder present | Seven generation proofs and at most 57 provider calls for a new note; six and at most 48 for an edit (ADR-065). Each further queued new note adds four proofs. The count does not grow with earlier saves in this session; files this session has not verified add their own reads. These are provider calls, not HTTP requests or a latency target. |
| Foreign fence or lost ready receipt at any request of a save, with every shard folder present and below the consolidation threshold | Every write has its own proof and, for a note, a purge check. At most one write follows the fault. The pass stops with `dataset-changed` unless the fault arrives after its last proof, and an operation is acknowledged only after a later proof saw its receipt. |
| Dataset root lost at any request of an edit | As above, except that the loss can first surface as retryable `dataset-visibility` or `source-file-missing`. The next pass reports `dataset-changed`. |
| Purge of the edited note at any request of its save | The pass completes, at most one further write happens, and the note does not return after the next pass. |
| Capture listing behind a feed read to its end, on an incremental pull | Up to four looks over 350 ms. If still behind, the pass fails with retryable `dataset-visibility`, the cursor and view stay, and the next pass replays the same events. The status stays on syncing for up to six such waits. After 30 seconds of holding, the pass goes on to its uploads without landing and still fails at the end. |
| Purge marker in the feed, purge listing behind | The marker is read by its exact ID and stored at once, so nothing of an unsent edit reaches Drive and no checkpoint carries the note. When a pull lands, the note leaves the view and the edit is kept for Save as copy. Cleanup waits for the listing and does not report the dataset changed. |
| Authenticated timing | Record at least 30 ordinary warm checks per tested host/network, plus due audits separately: median/p95 wall time, auth time, native HTTP time, bridge/local commit time, request/byte counts and connection reuse. |

Performance target: p95 application overhead outside authentication and the one HTTP
request is at most 100 ms on the named reference devices. On a network where that
request completes within 900 ms and no authentication refresh is needed, target an
empty round within one second. Report the actual distribution; neither this specification
nor Google's API promises a universal one-second response. Cold startup and nonempty
feeds have separate results and must not be mixed into or omitted from the report.

Deterministic regression coverage must include every fallback row above, atomic commit
failure, concurrent edit/save/purge/account switch, audit expiry/failure, unchanged
terminal tokens, repeated scheduler triggers and both full/sparse existing dataset fixtures.
Verify native record transactions on all five hosts and renderer status behavior separately.
Real Drive checks must observe creation, update and deletion events, including control
records, through the same appDataFolder OAuth application and native transport as the app.

## Dependencies and review questions

Depends on the existing native record API, account-bound Google transport and SPEC-010.
Review the proposed five-minute audit default and the conservative nonempty-page replay
before approval. Authenticated event visibility, real timing and Apple connection reuse
remain evidence gates; they are not claims established by the fixture baseline.

## References

- [Baseline, primary-source checks and evidence limits](../research/2026-11-03-idle-sync-request-cost.md).
- [SPEC-010](010-dataset-checkpoints-and-deletable-history.md), especially atomic activation,
  account isolation, purge precedence and recovery.

Created: 2026-11-03.
