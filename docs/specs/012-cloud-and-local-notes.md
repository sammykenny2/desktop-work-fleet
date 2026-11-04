# SPEC-012: Cloud and local notes side by side

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Approved |
| **Owner** | Project maintainer |
| **Reviewer** | Project maintainer |

## Summary

The sidebar shows Cloud notes and Local notes together, each with its own groups, instead of a switch between them.
Notes and groups can be moved across with a confirmation. Trash becomes a sidebar item with its own view, and search
covers everything except Trash. Decisions and alternatives are in
[ADR-066](../decisions/066-cloud-and-local-notes-side-by-side.md); the work is in
[PLAN-013](../plans/013-cloud-and-local-notes.md).

## Goals

- See and use cloud and local notes at the same time, with no switching.
- Move a note or a group across explicitly, never automatically, with no way to leave a note half moved.
- Choose which groups, at most nine, appear on the desktop.
- Keep each collection's sync, history and backups independent.
- Build on a list of collections, so that more accounts or local collections need no redesign.

## Non-Goals

- Sync between cloud and local.
- More than one Google account or more than one local collection in the interface. The first release has one of each.
- Automatic expiry of Trash, and a "Deleting soon" view.
- Moving version history across collections.
- A shared backup file covering both collections.
- Dropping a group onto another group across collections to merge them. It moves as a new group.

## Terms

- **Collection** (a profile in code): the notes of one account, or the local notes. Interface names: "Cloud notes" and
  "Local notes".
- **Section**: one collection's part of the sidebar.
- **Region**: one cell of the desktop grid, as in SPEC-003.
- **Desk**: this device's settings that have one value per computer (ADR-066).

## Requirements

### Sidebar and accounts

- FR1: The sidebar lists a section per open collection: Cloud notes above Local notes. Each section has a heading with an
  add button and lists its groups. A tooltip on the heading says what the section means.
- FR2: Signed out, only Local notes shows and the account chip offers "Sign in to use cloud notes". Signing in adds the Cloud
  notes section; signing out removes it from the sidebar and desktop and keeps its data on this device, as today.
- FR3: An expired sign-in is not a sign-out: Cloud notes stays usable and the account chip asks to sign in again.
- FR4: Settings no longer offers "Use local notes". Local notes never depends on the account.
- FR5: Each collection may hold nine groups. Adding a tenth is refused with the existing message. A device that receives more
  through sync keeps them and shows the existing notice, per collection.
- FR6: Dragging a group row within its section reorders that section only. It changes no region and no shortcut, so the
  "keys moved" notice is gone. Phones keep the grip and hold gestures.
- FR7: Group pickers list groups by section. An open editor offers only its own collection's groups, since its draft lives
  there: a new note belongs to the section of the group it started from, and moving a saved note across uses FR12.

### Desktop regions

- FR8: The grid keeps its limits: at most 3 rows, 4 columns and 9 regions. Any region may hold any group of any open
  collection, or be empty. There may be fewer regions than groups.
- FR9: A group in no region is off the desktop: its papers are not drawn and not in scope of adjusting or arranging, and it
  stays in the main window. Its row shows a dimmed layer mark with a tooltip. A paper keeps its position while its group is
  off the desktop and returns there. A paper never placed is placed when its group gets a region.
- FR10: A group new to this device takes the first free region, and the grid grows for it as far as nine regions; past that
  it stays off the desktop and a status line says so. A group the user took off the desktop stays off until the user places it.
- FR11: Settings > Desktop notes > Group regions offers every group per region, grouped by section, and lists the groups off
  the desktop. While signed out, regions holding cloud groups stay reserved, and the layout map marks them.

### Moving notes and groups across

- FR12: Dropping a note on a group in another section, or choosing such a group in the note's "Move to group", opens a
  confirmation naming both ends and saying what happens: moving to Local notes means other devices no longer see it; moving
  to Cloud notes means it syncs to other devices; the original goes to its section's Trash; only the current version moves.
- FR13: Dropping a group on another section, or choosing "Move to Local notes" or "Move to Cloud notes" in group settings,
  opens a confirmation with the number of notes by status, then a blocking progress dialog showing the current note, a count
  and Stop. Stop finishes the current note and ends the move.
- FR14: A move creates the note in the target, then trashes the original. Each note either moves completely or not at all. A
  move interrupted by a crash finishes on the next start, without duplicating the note. Status, content, attachments, desktop
  position and creation time move with it. A move into a collection that is not open waits until it opens; a note that
  changes before its copy exists stays where it is, and one that changes after keeps both, and says so. A note with unsaved
  changes, or whose copy was trashed or purged meanwhile, keeps its original too, and a move under way says so. A move that was
  refused has nothing left to finish later. If its own trash write already landed, the journal restores that exact revision
  before clearing; a failed or unacknowledged write retains recovery for the next start. A later user choice or permanent
  deletion of the original is never reversed.
- FR15: Notes with a version conflict or unsaved changes do not move; the result lists how many stayed. A note with an
  attachment that is not on this device and cannot be fetched stays and is reported the same way. A single such note is
  refused with the reason before anything changes.
- FR16: Notes in Trash stay where they are when their group moves.
- FR17: A stopped or partial move leaves both groups in place. Moving the group again continues into the same target group.
- FR18: When a group has moved completely it leaves its section. The target group takes its region, layer, opacity, highlight
  and colour. Until then the target uses a free region if there is one and never grows the grid; a group off the desktop
  stays off. A note that another device put in the group before it heard of the move, or one still being written, brings the
  group back, so that the note stays in sight.
- FR19: A group cannot move into a collection that already holds nine groups: the app says so before anything changes. Moving
  a single note to an existing group is unaffected.
- FR20: Moves within a collection stay as in SPEC-003, with Undo and no Trash. A move across has no Undo; the original in
  Trash is the way back.
- FR21: Phones have no note drag, so "Move to group" and group settings offer the same moves. So does the keyboard.

### Colours

- FR22: Each device has one colour table across all open collections, settled as in SPEC-003: a group keeps its colour, a new
  group takes the first free one, and past nine groups colours repeat. Choosing a colour another group wears swaps the two,
  across collections too.

### Trash

- FR23: Trash is a row below the last section, with an icon and the number of notes in it. It has no settings, cannot be
  dragged and is not a drop target. Selecting it does not change the group that capture files into.
- FR24: The view shows the title "Trash", the note count, Empty Trash and the note and list views. There is no layout map and
  no capture button. "This group" and "All" are disabled.
- FR25: Its tabs are All, Cloud notes and Local notes; with one collection there are no tabs. Empty Trash acts on the current
  tab. With both, the confirmation states the reach of each: cloud needs a connection and applies to every device of that
  account; local affects only this device.
- FR26: Notes are sectioned by group in the note and list views: a section heading has the colour dot, group name and count,
  and the collection name under the All tab. Sections follow sidebar order; groups no longer listed come last. Within a
  section the most recently trashed note is first.
- FR27: A note moved across says where it went. Restoring a note whose group has moved away or been deleted asks for a target
  group in the same collection; if the collection has no group, the group comes back (ADR-067).
- FR28: Delete forever stays per note. The button is readable on every paper colour.
- FR29: The status tabs become To do, Completed and Archived.

### Search

- FR30: Search covers all groups of all open collections and every status, whatever tab is selected, and shows each result's
  collection, group and status. The status tabs are hidden while searching.
- FR31: Search does not include Trash. If notes in Trash match, a link below the results offers to show them.
- FR32: While Trash is shown, search covers only the current Trash tab, keeps its sections and says so in the placeholder.

### Failure and data

- FR33: A collection that cannot open shows as unavailable in its section with its recovery options. The other works normally.
  When it is the signed-in account's own, the recovery page comes first and also offers to sign out, which opens Local notes.
- FR34: Two collections sharing note or group ids, including notes never saved, count as FR33 for the second one. Such ids can
  also arrive later, by a sync from another device; ordinary actions pause and the page reopens after its current text is
  saved, so that nothing is written to the wrong collection. If saving fails, the page and editor stay open with a retry and
  selectable text; it never reloads past that failure. Ambiguous note or group routing is refused even before reopening. A restore never
  creates such a pair: a backup sharing nothing with its target came from elsewhere, so its notes and groups take new ids. Only a
  cloud collection's own synced backup may be new to its target and keep its ids. Restoring from the same source again merges
  into the notes the earlier restore made, and each source counts on its own: merges and replacements of a source lead, or failing
  those its last import with a note still alive, including an unsaved new note but excluding detached recovery text. Replacing all of a collection's local data starts this record over, so a source
  restored before that counts as new.
- FR35: Backups stay per collection and keep their format. Manual export asks which collection; automatic backups run for each;
  a restore asks for its target. The desk is not part of a backup.
- FR36: "Reset all data" names the collection it resets. A reset of Local notes does not touch cloud notes, and the reverse.
- FR37: Versions and conflicts shows one collection at a time, chosen at the top of the page.

### Non-Functional Requirements

- NFR1: No sync, dataset or backup format changes, and no schema bump (V1 policy).
- NFR2: A collection's data never reaches another collection or account except through FR12 and FR13.
- NFR3: A group move stays responsive: sync may land between notes, and each note is its own commit.
- NFR4: Every interface string exists in `en` and `zh-TW`.

## Design Overview

See ADR-066. In short: one `Workspace` per collection; `CombinedWorkspace` merges reads and routes writes; hosts route storage
requests by profile; a desk record holds per-computer settings; a journal drives moves across.

## Supersedes

When the matching phase of PLAN-013 lands:

- SPEC-003: "the tenth group must not have its content hidden", "the list, regions and keys keep one order", and nine groups
  per workspace become per collection.
- ADR-021: one open partition, and "Use local notes".
- SPEC-003 C03 and C44 are rewritten for FR8 and FR5.

## Dependencies

- ADR-062 purge rules, ADR-061 unsaved changes, ADR-010 merge rules.

## Open Questions

None. Decided with the maintainer on 2026-11-04, after a clickable mock.

## References

- [ADR-066](../decisions/066-cloud-and-local-notes-side-by-side.md)
- [SPEC-003](003-desktop-cards-groups-and-formation.md)
