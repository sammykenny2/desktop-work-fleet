# ADR-067: Sections may be empty, and any group can be deleted

## Status

Accepted, 2026-11-04, at the maintainer's request. Revises the last-group rule of
[ADR-010](010-group-retirement-and-device-settings.md), the first-use rule of
[SPEC-003](../specs/003-desktop-cards-groups-and-formation.md) and the empty section of
[ADR-066](066-cloud-and-local-notes-side-by-side.md).

## Context

Whether a section held a group depended on how it was opened:

- A signed-out first start made "My notes" at once.
- Local notes beside an account stayed empty, also after local data was reset.
- Cloud notes stayed empty until a note was written with no group anywhere, because creating a group on sign-in costs Drive
  writes on an empty account and needs a shared identity across devices (ADR-053, ADR-062).

Groups could also not be deleted, only merged into another group of their section, and ADR-010 said the last group could not
be removed. Yet the last group could be moved to the other section, so a section could already end up empty. The maintainer
asked for one rule across sections: no section that can be emptied while another cannot, and none that refills itself while
another does not.

## Decision

### One rule for every section

- A section may hold no group. Opening, signing in, resetting local data or deleting the last group never adds one.
- A group appears by itself only for a note that has nowhere to go. In everyday use that means starting a note with no group in
  any section: "My notes" is made in the primary section, the account while signed in and otherwise Local notes. Before an
  account's first sync this waits, with the existing message, because the group's identity depends on the dataset.
- Three rarer cases follow the same reason. A share lands in the primary section because its files are stored there, so keeping
  one with no group there makes "My notes" then, not when the inbox opens, even if the other section has a group. A move
  interrupted by a crash, whose target group has since gone, makes the target again to hold the note. Replacing with a backup that
  holds no group makes "Kept after restore" only if groups here must retire into it.

### What the main window shows with no group

- The existing first-note prompt, in every view and on every host, with the primary section's name as the title.
- The status tabs, the view switch and the capture button are hidden, and "This group" and "All" are disabled. Search and Trash
  stay, because trashed notes outlive their groups. With no group row to choose, the Trash row also leads back out of Trash.

### Deleting a group

- Group settings offer "Delete group" in every section, for the last group too, after a confirmation that says how many notes go
  to Trash and how many have unsaved changes that are lost.
- One transaction trashes the group's notes, drops their unsaved changes and takes the group out of the lists, so a failed
  write changes nothing. Unsaved changes go as they do when a single note is deleted, and only what the question counted goes:
  changes to a note outside Trash in this group, and notes never saved in it. Changes that merely name the group stay, because
  their note may have moved on or be in Trash, and so does the recovery copy of a note deleted forever, which belongs to Versions.
- The group, or a note in it outside Trash, in conflict refuses the delete until the conflict is settled. If what the question
  counted has changed by the time it is answered, nothing is deleted and the page says so.
- The group stays as a record with the `movedAway` mark of ADR-066, because that already means what is needed here: it leaves
  every list, its trashed notes still have a group, and it syncs and backs up. A `deleted` record would have to name a redirect,
  as a merge does, and `resolveGroupId` refuses one without. The name now covers a delete as well as a move.
- Restoring a note from such a group asks for another group of its section. With none left, the group comes back, in the same
  transaction as the note. Choosing an older version of the note in Versions restores it where it was, bringing the group back as
  it does for a group moved away.
- Region, highlight, opacity, colour and any old shortcut bound to the group end with it; nothing passes on, unlike a merge.
- A note another device saved into the group before hearing of the delete brings the group back in sight on every device, as
  with a move. Nothing written elsewhere is lost.
- Merging is unchanged and still needs another group in the section, so its button stays disabled for the last one.

## Consequences

### Positive

- One rule to explain, in every section, signed in or not.
- A signed-out start writes no group nobody asked for, and a signed-in one still writes nothing to Drive.
- Any group can go, with its notes recoverable from Trash.

### Negative

- A new install opens with an empty page, one press further from the first note.
- Pressing the prompt and then closing the editor without writing still leaves the new group, because an unsaved note needs a
  group to belong to.
- A delete has no Undo; the way back is Trash.
- Trashed notes in the deleted group outlive the group's region and colour, so a group brought back gets free ones.

### Neutral

- Existing groups, including a "My notes" made by an earlier version, stay as ordinary groups that can now be deleted. There is
  no format change or migration.
- `Workspace.create` keeps `bootstrapGroup` for tests and the code paths that already passed false; the page passes false for every
  profile.
