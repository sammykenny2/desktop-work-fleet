# ADR-066: Cloud and local notes side by side

## Status

Accepted, 2026-11-04, at the maintainer's request, after a clickable mock. Revises the single open partition of
[ADR-021](021-windows-google-account-and-sync.md), the sidebar and region order of
[ADR-010](010-group-retirement-and-device-settings.md) and the Account page of
[ADR-059](059-settings-pages-and-entry-points.md). Behaviour is in [SPEC-012](../specs/012-cloud-and-local-notes.md);
the order of work is in [PLAN-013](../plans/013-cloud-and-local-notes.md).

## Context

The app opens one partition at a time: `local`, or `google:<sub>` for a signed-in account. Moving between them is a
"switch" that closes the workspace and reloads the page, so a user sees either their local notes or their cloud notes.
This was a deliberate guard against notes reaching the wrong account (ADR-021), not a technical limit: both partitions
already exist side by side on disk.

The maintainer wants both visible at once: the sidebar lists Cloud notes and Local notes, each with its own groups and
its own add button; signed out, only Local notes shows. There is no sync between them, but a note or a group can be
dragged across, with a confirmation. Each may hold nine groups. The maintainer also asked that the implementation not
assume exactly two: later there may be several Google accounts or several local collections.

The same request moves Trash out of the view tabs into the sidebar and asks what search should cover.

## Decision

### 1. One Workspace per profile, opened together

- A profile keeps its own `Workspace`, storage, revision graph, unsaved changes, purge jobs and backups. Sync runs only
  on a profile with an account. `Workspace`, `DatasetSync`, the dataset protocol and the backup format stay per profile.
- Nothing assumes two profiles. The first release offers one Google account plus one local profile; tests run three.
- The renderer adds `CombinedWorkspace` over the open profiles. It merges what the interface reads and routes each write
  to the profile owning that note, group or unsaved change. The interaction controller and the desktop authority keep
  talking to one object, as they do today.
- The host's current profile stays the primary: the signed-in account, otherwise `local`. Sync, recovery and reset code
  keep acting on the primary. Local is opened as well when the primary is an account.

### 2. Hosts route by profile

- The storage, transfer, attachment, backup and data-location methods accept an optional `profile`. A host answers one
  naming another profile from a second session on that profile's own database. Each session keeps its own staged
  transfers, so nothing can commit into the wrong database.
- Google and desktop methods stay with the primary. Signing in or out still reloads the page through the existing close
  and flush path. The user sees a section appear or leave, never a switch; "Use local notes" goes away.

### 3. The desk is per device, not per profile

- A new device record, the desk, holds what can only have one value on a computer: the group regions (rows, columns,
  area and slots, which may name any profile's groups), shortcuts, the display switches, the main view and group, and the
  group colours. Every open profile holds a copy in its control records, outside backups; the copy that changed last leads,
  and the others catch up when they open. The first start seeds it from the
  primary's layout, so existing shortcuts and settings carry over without a migration job.
- The per-profile layout keeps paper placements, undo history and per-group layer, opacity and highlight, and stays the
  atomic partner of that profile's content (ADR-010). Its `grid.slots` now means only that profile's list order, which
  keeps the existing invariants, validators and backup format.

### 4. Regions are chosen; list order is separate

- Regions no longer have to hold every group: at most nine regions show any chosen groups. A group in no region is not on
  the desktop: its papers are not drawn, not placed and not in scope for adjusting, and it stays in the main window. This
  removes the SPEC-003 rule that a group's content must not be hidden.
- A group new to the desk takes a free region if there is one. A group the user took off the desktop is not put back.
- Dragging a sidebar row changes only that section's order, not regions or shortcuts. Regions change only in Settings.
- Regions naming a signed-out account's groups stay reserved, so signing in restores the desktop.

### 5. One colour table

Colours live on the desk and settle across all groups of all open profiles with the existing `settleGroupColors`. With
nine or fewer groups every group has its own colour, and a moved group keeps its colour without any special rule; past
nine, colours repeat as they already do.

### 6. Moving across profiles

- Two databases cannot share a transaction, so one note moves in steps recorded in a journal in the source profile:
  record the move with a new note id, copy the attachments, create the note in the target in one commit, then trash the
  source note. Start-up finishes any recorded move. Creating the note is idempotent because its id is already chosen, so a
  crash can repeat a step but never leaves half a note or two copies.
- The moved note has a new identity. A verified purge is terminal for an identity (ADR-062), so reusing one could refuse a
  note moved back. It carries the current version only; history stays with the source note.
- The source note goes to its own Trash, marked with where it went (`movedTo`). It can be restored, the move works offline,
  and cloud content leaves Google only when that Trash is emptied. Moves within a profile are unchanged.
- A group moves as a series of such notes behind a blocking progress dialog that can stop between notes. Stopping leaves
  moved notes where they are. Moving the group again continues into the same target group, remembered in the journal.
- Notes with version conflicts or unsaved changes do not move and are listed afterwards.
- When a group has moved completely, its record stays as `movedAway`, out of every active list. A deleted group must name
  a redirect target and a move has none in its own profile, while its trashed notes still need a group to belong to. Its
  region passes to the target group.

### 7. A profile that cannot open does not block the others

A profile that is incompatible, unreadable or shares note or group ids with another open profile is shown as unavailable,
with its recovery options; the others work normally. Ids can repeat only when one backup was restored into two profiles
with its ids kept. Restores into a profile now take new ids when an id is already used by another open profile.

### 8. Trash and search

- Trash leaves the view tabs and becomes a sidebar row below the last section, opening a view of its own. Its tabs filter by
  profile, because emptying each has different reach. Notes are sectioned by group in both views. "This group" and "All"
  are disabled while it is shown.
- Search looks through every open profile and every status, whatever tab is selected, and never through Trash unless Trash
  is shown. Matches in Trash are offered as a link below the results.

## Consequences

### Positive

- Sync, dataset and backup code stay untouched and keep their guarantees per profile.
- Account isolation stays: nothing crosses a profile without an explicit, confirmed action.
- More accounts or local collections later need interface work and native sign-in work, not a redesign.

### Negative

- A move is copy-then-trash: Trash grows by one note per moved note, and cloud content stays until Trash is emptied.
- Versions that know nothing of `movedAway` (0.5.13 and earlier) show a fully moved group as an empty group and count it
  toward nine, until that device updates.
- Dragging a sidebar row no longer rearranges the desktop.
- Moved notes lose their version history in the target, and other devices see the source note in Trash.
- Sync work grows with each signed-in account when more than one is offered.
- Every native host changes, and only Apple can be built on the maintainer's Mac; Windows and Linux rely on CI, Android on
  its own build.

### Neutral

- Per-profile `groupColors`, `shortcuts` and display switches remain in the layout format and in backups, but the desk
  takes precedence. The V1 policy applies: no schema bump.
- A renderer still uses one page and one action queue for all profiles.

## Alternatives Considered

### One Workspace with a per-group "synced" tag

- **Pros**: moves are one atomic transaction.
- **Cons**: dataset rejoin and reset replace a whole generation (`dataset-transition.js`), so sync would need to learn to
  spare local data; every validator and backup path would need the same; a wrong tag publishes private notes.
- **Why rejected**: it weakens the isolation ADR-021 chose, in the code with the highest risk.

### Moving the whole layout to the device

- **Pros**: one place for all layout.
- **Cons**: loses the atomic commit of content and placement (ADR-010) and changes the backup format.
- **Why rejected**: only the values that truly have one value per device need to move.

### Purging the source note after a move

- **Pros**: closest to a true move; nothing left in Trash or on Drive.
- **Cons**: irreversible, needs a connection, loses history, and a group move queues slow cleanup per note.
- **Why rejected**: the maintainer chose Trash for moves across profiles.

### One colour table per profile

- **Pros**: each section always has nine distinct colours.
- **Cons**: the first group of each section is the same yellow on the same desktop; moved groups may change colour.
- **Why rejected**: a shared table is simpler and distinct until there really are more than nine groups.

### Trash tabs per group, or a "Deleting soon" tab

- **Cons**: up to eighteen tabs with repeated names that vanish on restore; nothing expires automatically today (ADR-062),
  so "Deleting soon" would be empty.
- **Why rejected**: a section per group shows the same information. Expiry can add such a tab later.

## References

- [SPEC-012](../specs/012-cloud-and-local-notes.md), [PLAN-013](../plans/013-cloud-and-local-notes.md)
- [ADR-010](010-group-retirement-and-device-settings.md), [ADR-021](021-windows-google-account-and-sync.md),
  [ADR-038](038-portable-local-and-cloud-backup-flows.md), [ADR-059](059-settings-pages-and-entry-points.md),
  [ADR-062](062-dataset-checkpoints-and-deletable-history.md)

---

*Decision made: 2026-11-04*
*Decision makers: maintainer, Claude*
