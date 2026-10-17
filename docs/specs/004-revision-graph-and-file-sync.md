# SPEC-004: Immutable revisions and file sync

## Metadata

| Field | Value |
|---|---|
| Status | Approved technical contract; settled under the full 1.0 implementation and detail authorization |
| Owner | Project maintainer |
| Date | 2026-10-04 |

## Summary

Cards and groups each keep complete, immutable revisions together with the identities of their parent revisions.
Offline changes on different devices form branches;
only a new revision that explicitly covers every branch seen can resolve a conflict. Data retention, sync cursors, the
outbox, account isolation and real Google acceptance each have explicit boundaries. Current status is in
[PROGRESS](../../PROGRESS.md); history and verification evidence are in the git history and [testing](../testing.md).

## Goals

- Markdown/checklists, attachment references, group retirement and unknown JSON extension data are kept without loss.
- Out-of-order delivery, duplicates, disconnection, lost responses and crash replay never lead to silent overwrites.
- Layout, drafts and local credentials are not mixed into shared cards; complete backups can reference the same revision
  graph.
- Source-independent rules are shared by Windows, macOS, Linux, iOS and Android.

## Non-Goals

No winner is chosen by modification time, no deletion is inferred from a missing remote file, and history is not
pruned automatically in the first version.
These limits do not cut the editor, platform or complete-backup scope approved in SPEC-003.

## Requirements

### Revision format

```json
{
  "format": "work-fleet-revision",
  "schemaVersion": 1,
  "kind": "card",
  "entityId": "card-id",
  "revisionId": "revision-id",
  "parents": ["previous-revision-id"],
  "value": {
    "id": "card-id",
    "revision": "revision-id",
    "groupId": "group-id",
    "content": {"format": "markdown", "text": "- [ ] Capture an idea", "attachments": []},
    "deleted": false,
    "archived": false,
    "completed": false
  }
}
```

- The envelope accepts only the seven fields above. Unknown formats or schemas are rejected; the cursor must not skip
  them and advance.
- IDs are 1–128 ASCII characters that start with a letter or digit, followed by letters, digits, `.`, `_`, `:` or `-`;
  `__proto__`, `prototype` and `constructor` are rejected. Normal creation uses random UUIDs;
  the initial group and its root revision use the shared account/reset-batch identity of
  [ADR-053](../decisions/053-account-scoped-initial-group.md).
- Revision IDs are unique across the whole graph; value.id/revision must match the envelope.
  kind is card or group; a known parent must point to the same kind and entity.
- parents is a set of IDs without duplicates, sorted in the canonical encoding. Zero parents means a root revision; at
  most 1,024 parents are allowed. Several roots of the same entity also form a conflict and cannot be merged into a
  single value.
- A card must include groupId, content and the deleted/archived/completed booleans.
- A card may carry `createdAt`: the device time at creation, in UTC ISO 8601 with milliseconds
  (`2026-10-06T12:00:00.000Z`). Later revisions carry it unchanged; it only decides the reading order.
  content must include non-empty format and text strings; unknown formats and JSON extension fields are kept as they
  are.
- Attachments are references, not embedded bytes; id and name are required, mediaType and size are optional.
  size, if given, is a non-negative integer ≤25 MiB; formal attachment transfer verifies the bytes with SHA-256.
- A group includes name and deleted; a retired group must have a redirectGroupId different from itself.
  Cross-group redirect cycles are handled by the projection/conflict layer and are not mixed into revision ancestry.

### JSON and capacity

A single JSON document or revision record is at most 8 MiB of UTF-8, with a nesting depth of at most 64 and at most
200,000 value nodes. Duplicate fields (including names that are equal after unescaping), invalid UTF-8 or Unicode
surrogates, a BOM, non-finite numbers and unsafe integers are rejected.
Every object key must be non-empty, and the three dangerous names above are rejected. Non-JSON data such as
prototypes, getters, Map, Date, BigInt, undefined or sparse arrays is not accepted, rather than being silently dropped
by JSON.stringify.

Canonical form: object keys are sorted by UTF-16 code unit, arrays keep their order, and strings and finite numbers use
the ECMAScript JSON encoding (-0 becomes 0). This is this protocol's own format and does not claim a full RFC 8785
implementation. Unknown fields of the body and of the attachment metadata are part of the canonical bytes, so extension
fields cannot be ignored when deciding whether a retry is the same revision.

### Revision graph and conflicts

- Each batch is validated completely before the new graph is published; any collision, cycle or parent identity error
  fails the whole batch.
- The same ID with the same canonical bytes is a replay; the same ID with different bytes is an integrity error.
- A revision with a missing parent, and all of its descendants, are pending; their complete data and the parent IDs
  still to come are kept. A pending revision does not remove an earlier complete head; roots that do not exist must not
  be created and missing parents must not be filled in.
- Only revisions whose ancestors all exist take part in head computation; a head is a known revision with no complete
  successor. An iterative topological walk is used, so long histories do not depend on the recursive call stack.
- Multiple heads show a conflict and keep all content, including delete/edit and group rename/merge.
  The parents of an explicit resolution include all heads seen at the time; a late, unknown branch shows up again as a
  conflict.
- The projection may keep the branch currently being viewed, but must not pretend that it has won; drafts are not
  overwritten by sync. Missing dependencies or cycles in group redirects, and more than nine active groups, keep the
  data and offer an entry to tidy up.

### Local and FileStore transactions

The Workspace keeps append-only revisions. An old local preview migrates into the same graph from its complete outbox;
when history is missing, it refuses to invent root revisions.
Ordinary content commands append the revision and the outbox entry in the same commit; the graph is published only
after its candidate fork validates and persistence completes.
beginSync binds profile/source/session, and the runtime nonce is not written to disk; a restart opens a new session and
keeps the cursor. receiveRevisions checks both the session and the expectedCursor, and atomically saves the revisions,
the projection, the group layout references and the new cursor.
Different sources cannot reuse the same profile; an old session, a wrong profile or a stale cursor writes nothing.

The projection keeps the branch that is still a head for reading; otherwise it prefers an undeleted branch, then picks
stably by ID. Multiple heads still show the conflict explicitly, and ordinary commands cannot overwrite them. The
existing local display order of groups is kept, and new groups are appended.
On every device cards are ordered by `createdAt` from old to new, then by ID; older cards without it, or with an
invalid format, come first, ordered by ID.
A device that receives all cards at once in its first sync therefore shows the same order as the device that created
them (user decision on 2026-10-06: creation time, oldest on top).
The card projection may show a card in the receiving group by following the complete group redirect chain; the
original revision.value.groupId does not change.
Each device's "mine" setting and shortcuts follow the effective redirect; region bookkeeping can adjust, while the
geometry and display policy of existing cards do not change.
Tidying more than nine groups back to nine restores a valid layout in the same transaction. With cycles or missing
dependencies, drafts can still be saved; input must not be lost because a rebase failed.

### Comparison, resolution and history recovery

"Versions and conflicts" offers pending items, history, attachment download, group recovery or choosing another group
for a card, and retrying or cancelling unfinished group transfers.
Adopting a revision and recovering history both check all heads seen in the preview; a stale decision is rejected and
cannot consume a new branch that nobody has seen.
Recovering history creates a new revision with all current heads as parents, keeping later content and drafts.
History is a causal walk from the current revision back to earlier ones; UUIDs or device clocks are not passed off as
modification dates.
A transfer retry commits the membership, the revision, the outbox, the layout undo and the consumption of the original
intent together. A failed save shows no half success, and a retry does not add another intent.

### FileStore coordinator integration

A new content revision and its outbox entry are in the same transaction; once sending starts, the operation ID and the
bytes do not change.
Revision data, pending items, conflicts and the remote cursor are saved in the same transaction, and success is not
published before the transaction completes. Each account has only one coordinator; signing out or switching sources
cancels the old work and refuses to write late results into another profile.

The first full scan gets the changes start point first, then lists all file pages, and finally catches up on the
changes after that start point. Duplicate responses can be replayed; the completed cursor is updated only after the
last page is saved successfully. When the cursor becomes invalid, a full rescan runs without clearing local revisions.
An unreadable, purged or too-new file stops the corresponding lossy sync and keeps the local content; only a tombstone
inside a revision means deletion.

The Drive appDataFolder adapter uses drive.appdata, and uploads use pre-generated, persisted file IDs.
After a lost success response, the same ID is retried; a 409 must fetch the bytes and compare them, not be taken as
success.
An attachment completes a verifiable transfer before the new revision that references it is uploaded; when a download
lacks an attachment, the text is kept with an explicit waiting state.
Quota and temporary network errors back off and can be retried; revoked access needs a new sign-in and must not be
resent endlessly under new operation IDs.

The concrete transport follows [ADR-012](../decisions/012-durable-file-store-and-drive-adapter.md): a FileDescriptor
contains id/kind/sha256/size; provider file IDs are 1–256 ASCII letters, digits, `_` or `-`, and dangerous object keys
are rejected.
Workspace.sync.files records confirmed descriptors (including the `kind: reset` / `workspace` control files), and
sync.uploads keeps reservations by revision ID or by attachment or control-file hash.
Initialization follows the prepare/ready steps of [SPEC-008](008-workspace-initialization.md) and
[ADR-054](../decisions/054-explicit-workspace-initialization.md):
a new account decides starter or existing after a complete pull; a reset is cleared and initialized by the device that
started it, and the other copies wait for it to finish. For the same source/reset set, starter entities, revisions and
root bytes are identical.
Manual groups created after a starter is chosen do not cancel the required root; a workspace that is deliberately
empty and already ready gets no groups added later.
A new reset ID tells existing devices to stop syncing; replaying a known marker does not notify again and is not saved
as an attachment.
`sync.sourceResetIds` is created in the cursor transaction that completes reading the source; an empty array means the
initial generation before any reset, and a stale cursor does not clear it.
Both incremental and full scans first block new markers outside the established generations; they must not wait until
known files disappear or an upload reservation exists before stopping.
New V1 source files add `sourceResetIds` (sorted, unique marker file IDs) to the transport JSON of the seven-field
revision above; the receiver takes this transport field out first, then strictly validates the original seven-field
revision. The core graph, notes and portable backups do not contain the field, and the original revision bytes and IDs
do not change.
A full scan lists all descriptors first, then reads in reset/workspace/data order; only transports of the same
generation enter the graph, and descriptors of other generations stay in the ledger without deleting cloud files.
A receiver with a pending marker or plan publishes no data; when the receipt arrives, it rescans, validates all
required bytes and attachments, then activates them atomically.
The rescan requirement is saved in the same transaction as the receipt and cursor, so a reopened process still gets the
data skipped while waiting.
An explicit backup restore resends the original revisions under the current source generation, so a same-account full
overwrite and merge/replace keep historical identities and do not lose groups.
Existing V1 files without this field are still received completely, and existing reservations keep their original bytes
and file IDs. Every device needs the update; older versions that receive the unknown field pause and keep their data.
The kind, digest and size of a file ID are immutable and cannot be rewritten by later pages or upload acks.
Each page has at most 1,000 descriptors; the Drive adapter actually requests 100, and a service response is at most
2 MiB of JSON.

A full scan finishes enumerating descriptors first. The data ledger commits batch by batch while the cursor stays null,
revisions are staged until the complete scan commits, and pending initialization is kept separately as incoming.
Only when everything is done is the pre-scan start point committed, and then changes are followed; completing
initialization also needs ready and a check of the actual requirements.
A failed local ack still keeps the reservation and outbox; they are cleared only after a read-back check on restart, and
the complete revision history is always kept.
A verified attachment may already be on disk while its metadata commit fails; this leaves only unreferenced bytes and
does not count as a successful sync.
Concurrent sync calls on one coordinator merge into the same job; stop aborts and session checks reject late responses.
Backoff is exponential from 1 second up to a 60-second cap, with jitter, and honours the service's Retry-After; force
skips only the wait, never the integrity validation.

Non-empty Drive files are sent in 1 MiB chunks, checking Range instead of guessing the received length. Every
resumable 4xx reopens the session and still uses the original file ID.
When Google's server checksum is missing, the bytes are read back; the private upload URL lives only in adapter memory.
A process restart may resend the start of an attachment; keeping the byte offset across processes is not claimed.
Native HTTP must limit the response size while streaming and refuse redirects; the renderer cannot obtain tokens or an
arbitrary HTTP bridge.
Signing in to an existing account creates an empty profile that pulls the source first; devices must not each add
their own starter group.

## Design Overview

`src/sources/json.js` provides strict parsing and canonical encoding, and `revisions.js` provides revision validation
and the pure revision graph.
The Workspace handles atomic saving, projection, drafts and explicit resolutions; the FileStore coordinator handles
paging, cursors and retries.
`src/sources/file-sync.js` implements the coordination and `google-drive.js` the REST format and resumable uploads;
the native account-bound AuthorizedDriveRequest and OAuth authorization are integrated by the hosts.
The renderer never gets Google tokens; the native hosts' authorization and credential storage are separate from the
public configuration.
`.env.example` and `npm run config:check` are the entry point for public configuration; accounts and production signing
are set up by the maintainer.

## Acceptance Cases

| ID | Requirement |
|---|---|
| S01 | Chinese, emoji, checklists, attachments and unknown JSON fields round-trip through the canonical encoding |
| S02 | Duplicate and escaped same-name fields, invalid UTF-8, invalid numbers and exceeded capacity are rejected, without truncation |
| S03 | Offline branches from two devices, out of order and replayed, give the same head set |
| S04 | delete/edit keeps both; after an explicit resolution, a late third branch still shows a conflict |
| S05 | An unknown parent and its descendants are pending; until it arrives they do not swallow the complete old head |
| S06 | The same revision with different bytes, a cross-entity parent and a cycle each reject the whole batch |
| S07 | 12,000 changes fed in reverse order cause no recursion overflow; callers cannot rewrite graph internals |
| S08 | A Workspace save failure keeps the old projection, drafts, outbox and cursor |
| S09 | Cross-device group rename, retirement and cycles, and a tenth group, all have a reachable recovery entry |
| S10 | Lost responses, 409 verification, full-scan and changes paging, and crash replay cause no duplicates or omissions |
| S11 | Late responses from old sessions, revoked access and account switches do not mix data or credentials |
| S12 | Integration acceptance with real Google, client IDs for the five platforms and each platform's credential environment |

## Dependencies

[SPEC-003](003-desktop-cards-groups-and-formation.md), [ADR-008](../decisions/008-portable-interaction-core.md),
[ADR-011](../decisions/011-immutable-revision-graph.md), [PLAN-002](../plans/002-google-drive-notes-mvp.md).
The strict format and the revision graph add no runtime package or service.

## Open Questions

The public Google project and client IDs, production signing and the platform environments are not set up yet; the
user has asked for configuration through `.env.example`.
This is an external integration dependency and does not reopen the approved five-platform, complete 1.0 scope.

## References

- [Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Pre-generated file IDs](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds)
- [Uploads and retries](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [changes paging and cursors](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)

Created: 2026-10-04. The acceptance cases are requirements and do not mean that all of them have passed. Current status
is in [PROGRESS](../../PROGRESS.md); verification evidence is in the git history and [testing](../testing.md).
