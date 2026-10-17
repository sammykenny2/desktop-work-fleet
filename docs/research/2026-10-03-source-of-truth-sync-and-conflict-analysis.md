# Data source, sync and conflict handling research

- Date: 2026-10-03
- Status: comparison of candidate approaches; no backend, database, sync protocol or offline mode has been chosen.
- Primary basis: [backlog requirements](2026-10-03-backlog-first-product-requirements.md).
- The protocol and data suggestions in this document are designs to be validated, not features that exist today.

## 1. What the source of truth must answer

The user allows server or file based, but requires consistency across machines and the phone, editability, and no lost content.

First decide the authoritative source for each kind of data:

| Data | Properties it should have |
|---|---|
| Note content, to-dos and completion state | An authoritative record that every client refers to |
| Unsynced drafts | Stored reliably on the originating device; must not pretend to be synced |
| Display position, size, local highlighting | Can be per-device settings |
| Filters and grouping of shared views | Kept separate from the actual work items |
| Pairing and access rights | Revocable; not replaced by the local UI lock |

Having an authoritative source for a piece of data does not mean the whole system can have only one file. If a third-party task service is used, it must be clear which fields the third party manages and which belong only to this product, so that the two sides do not each keep a modifiable field of the same name.

## 2. Candidate approaches

| Approach | Advantages | Costs and main validation points | Current position |
|---|---|---|---|
| Own lightweight service + database | Can fit notes, quick capture and conflict UX directly | Authentication, sync, backup, deployment and offline handling are all on us | Candidate |
| Self-hosted off-the-shelf task service | Reuses existing data APIs and admin interface | Whether the API semantics fit free-text notes; license and upgrade boundaries | Candidate |
| GitHub Issues/Projects | Links to development work; ready-made views and API | Idea-capture steps, repository ownership, free notes and the phone experience | Workflow validation candidate, not a chosen backend |
| Markdown/JSON files + sync | Portable, easy to back up and use with external tools | Multiple writers, stable IDs, deletion, ordering and conflict resolution | Acceptable, but needs a sync design |
| Obsidian as a personal notes entry point | The user can use an existing notes experience | Not an open-source app that can be repackaged; data integration still needs its own design | Personal tool / interoperability candidate |

GitHub Projects' multiple views and custom fields are supported by the official documentation; whether it suits this user better than our own notes is a product judgement to be tested. [GitHub Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects)

## 3. Research boundaries for Obsidian and Vikunja

Obsidian's software terms of use are not an MIT license that permits arbitrary forks and re-publishing. Using your own Markdown data, interoperating with a personal tool, and copying/adapting Obsidian itself are different kinds of integration. Integration with the software or service requires checking the specific terms; "the data is Markdown" cannot be assumed to cover every right of use. [Obsidian terms](https://obsidian.md/terms)

Obsidian Sync's version history can help recover data, but this does not prove that self-made task IDs, states and cross-file relationships stay consistent automatically. [Obsidian version history](https://help.obsidian.md/Obsidian%2BSync/Version%2Bhistory)

Vikunja can be a task service candidate; its main repo lists most content as AGPL-3.0-or-later and the desktop content as GPL-3.0-or-later. Integrating with the API, modifying the server, copying the frontend and redistributing the desktop app are different modes of adoption and need separate evaluation. [Vikunja license notes](https://github.com/go-vikunja/vikunja#license)

This session did not install, fork or deploy these services or create accounts on them, and reached no conclusion on commercial use or redistribution licensing for the whole product.

## 4. Proposed minimum data capabilities

A candidate data contract should be able to express:

- Stable IDs: still the same item after renaming, changing machines or moving notes.
- Revisions: an update request can state which version of the data it is based on.
- Delete/restore semantics: an offline device must not accidentally bring deleted data back to life.
- Create operation identifiers: a network retry does not create two copies of the same work.
- Completion state and content can be updated separately, so a whole snapshot does not overwrite other people's changes.
- Schema version and an import/export method.

These are a candidate baseline for data reliability; they do not mean event sourcing or CRDTs must be adopted right away.

## 5. Update design for the server approach

Conditional updates can use a revision or HTTP ETag/If-Match. HTTP If-Match can prevent applying a stale write when the data has already changed; the actual field-conflict judgement is still the service design's responsibility. [RFC 9110 §13.1.1](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match)

Proposed behaviour:

1. The client reads version 12.
2. It submits the edit with a version-12 condition.
3. If the server is already at version 13, it reports a conflict and the current content.
4. Keep the user's draft and let the user compare, save as a copy or re-apply.
5. Do not mark the content as synced until it succeeds.

Different items can be written independently; whether different fields of the same item can merge automatically needs explicit rules and tests. Do not hide conflicts by judging "last writer wins" from device time.

A real-time notification only means a new version is available to read; it does not mean persistence succeeded. After reconnecting, missed data must be recoverable, not dependent on a one-off event.

## 6. Extra work for the file-based approach

These need separate handling:

- Power loss during a local file write: a temporary file in the same directory, flush/sync, atomic replace and backup.
- Several writers on the same machine: suitable serialization or locking.
- Each device changing its own copy: version comparison and conflict retention in the sync layer.
- An external editor stepping in: recognize format errors, old data and unknown fields.
- Multi-file operations: moving, renaming, index updates and deletion cannot rely on a single file lock.

Atomic replace protects only a single file replacement; it does not resolve multi-machine races by itself. A successful Git merge does not mean the task semantics are correct either; for example, two completion markers in different formats might both be kept.

One file per item narrows the text-conflict scope but raises the cost of managing list ordering, indexes and relationships. Storing the whole backlog in one file is more intuitive, but lets unrelated items conflict with each other.

Using a live SQLite file directly as a database shared/synced across machines is not recommended. SQLite's official documentation describes the locking and reliability problems of network file systems; if this project uses SQLite, the candidate that is easier to validate is that each service or client holds its own local database and syncs through an application protocol. [SQLite over a network](https://www.sqlite.org/useovernet.html)

## 7. The offline experience is not decided

Two minimum approaches can be compared:

- Offline reading + reliable drafts: the user submits after the connection returns.
- Offline editing + a pending operation queue: a fuller experience, but retries, ordering, dependent operations and conflicts must be handled.

Both should keep the last successful content, the last sync time and an unsynced indicator. The user's "nothing may go wrong" should be turned into verifiable failure behaviour; never having a conflict cannot be promised.

## 8. Local server and QR pairing

If a local server is chosen, QR pairing is the user's preference. Candidate flow:

1. A signed-in admin entry point generates a short-lived, single-use pairing invitation.
2. The QR code carries the server identity/location and the invitation data, never a permanent admin key.
3. The phone confirms the connection target and, after the exchange, receives a revocable device credential.
4. A settings page can list and revoke devices.
5. An expired or already-used invitation gives a prompt that lets the user try again.

A QR code does not create a reachable path outside the local network. A VPN, a controlled public endpoint or another connection approach must be chosen separately; LAN discovery, TLS trust and iOS local network privacy also need validation in platform prototypes. These are open design issues, not an assumption that scanning the code always connects.

Even when all devices are your own, read and write permissions should still be distinguished; a desktop that only displays can use narrower permissions. This should be kept separate from the accident-prevention "unlock" mode.

## 9. Cases that must be tested before selection

| Scenario | Acceptable result |
|---|---|
| A and B edit the same item at the same time | No silent overwrite; the draft and conflicting content can be retrieved |
| A create request succeeds, but the response is lost and the request is retried | No duplicate is created |
| After a deletion, an old device comes back online | Nothing is accidentally brought back to life |
| Moving and editing content at the same time | Both the home and the text stay traceable; nothing becomes an orphan |
| A local save fails | A clear failure; existing data and drafts are kept |
| Server paused, machine asleep or clocks out of sync | No fake success, and the device clock never decides which data is correct |
| Restoring from a backup | The behaviour of revisions, device caches and re-sync can be explained |
| A pairing credential is revoked | Later reads and writes are actually refused |

None of the cases above has been run. Build a small spike from these cases before choosing a service-based or file-based source.
