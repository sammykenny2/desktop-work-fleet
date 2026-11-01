# ADR-061: Unsaved changes instead of drafts

## Status

Accepted, 2026-11-01, at the maintainer's request.

Supersedes the draft rules of [ADR-009](009-local-renderer-and-persistence.md) (a recovered draft carrying the
original's baseline) and the "Unfinished drafts" list. Replaces SPEC-003 U23's wording and the quick edit's Cancel
(SPEC-003, 2026-10-24) as described below.

## Context

Every edit began a new draft, and "Continue editing" copied a draft under a new ID while keeping the original until
the copy was saved (ADR-009). Both came from the 0.1.0 web prototype, where each browser tab kept its own drafts and
two tabs must not overwrite each other. Since [ADR-018](018-single-owner-desktop-views.md) the main window is the only
writer, so that reason is gone, but the behaviour stayed:

- one note could hold several drafts, with no time to tell them apart;
- a kept draft was invisible: the note showed its saved text, editing it again started from the saved text, and the
  draft was reachable only from "Unfinished drafts" in the sidebar, which had no way to delete it;
- a kept draft silently blocked ticking the note's checklist.

The maintainer asked for the model a text editor uses instead: a note is saved, or it has unsaved changes kept on
this device, shown by a filled dot like VS Code's unsaved-file marker. There is no "draft" concept in the UI.

## Decision

- **One set of unsaved changes per note.** A note is either saved or has unsaved changes kept only on this device.
  Opening a note, in the main window's editor or as a desktop quick edit, continues its unsaved changes. Each editor
  writes under its own edit ID, which replaces the note's earlier set on its first write, so the desktop protocol's
  `draftId` keeps meaning one edit session.
- **What the views show.** Every view shows the notes as this device has them (`Workspace.working`): a note with
  unsaved changes shows them and carries a filled dot, on board papers, list rows, canvas papers and desktop papers'
  title bands. The main window's dot has a tooltip, "Unsaved changes, kept on this device"; desktop papers name it in
  their accessible label only, as the macOS desktop scene receives no hover
  ([macOS platform notes](../../src/native/apple/README.md)).
- **What counts as a change.** Unsaved changes hold nothing when they are blank, the same as the note's current
  revision, or, if the note changed since they began, still the same as what they began from. Such changes show no
  dot and are dropped when an editor closes (SPEC-003 U23).
- **Notes never saved.** A new note with content and no saved revision is a note too: it appears in its group, on the
  board, list and desktop, with the dot and no revision, after the saved notes. It can be opened, ticked and moved
  within its group. It changes group only in its editor; moving it to another group is refused until it is saved.
  Leaving a new note blank keeps nothing; while a quick edit has it open it stays on the desktop, so clearing its text
  does not make it vanish from under the editor.
- **Ending an edit.**
  - Save writes a revision and removes the dot.
  - Close, Esc and every other way an edit ends (selecting another paper, adjust mode, display changes, signing
    out, quitting) keep changed text as unsaved changes.
  - "Discard changes" returns the note to its saved revision, or removes a note that was never saved. The status
    line offers to undo it while the note has no newer unsaved changes. On the desktop it replaces the quick edit's
    Cancel, drawn as a trash can: Cancel undid only the changes since the quick edit began, a third state between
    saved and unsaved.
- **Changes made elsewhere.** Saving is refused when the note's content changed elsewhere since the unsaved changes
  began. The editor then offers "Overwrite", which makes the unsaved changes the next revision of the note as it is
  now (the other revision stays in history), and "Save as a copy". When only flags or the group changed, the save
  applies to the current revision without asking; completing, archiving, deleting, restoring or moving the note on
  this device carries its unsaved changes along. A note deleted elsewhere offers only "Save as a copy".
- **Other commands.**
  - Ticking a checklist step on a note with unsaved changes ticks the unsaved text; the dot stays. Ticking a note
    open in an editor is refused.
  - Deleting a note with unsaved changes asks first and discards them with it; undoing the delete brings both back.
  - Completing or archiving keeps them.
  - A group merge, on this device or synced from another, carries them, and notes never saved, to the receiving
    group.
- **Sync and backups.** Unsaved changes never sync. Portable backups include them. A restore adds a backup's set
  only where the note has none worth keeping here, the set holds something, and it is not a never-saved note's text
  for a note saved since; otherwise this device's state stays and the backup still holds the other set.
  Backups leave out the desktop positions of notes never saved, which take a new place after a restore.
- **Data.** Workspace and backup data stay V1 with no migration (AGENTS.md). A stored entry is
  `{ id, cardId, groupId, baseRevision, content }`; `recoveredFrom` is removed. Internal names (`drafts`,
  `saveDraft`, the desktop `draftId`) keep their names; only the UI and documentation stop calling them drafts.

## Consequences

### Positive

- Typed text stays visible where it was typed, and a dot says it is not saved yet, as in a text editor.
- One place to continue, one set per note, and an explicit choice when the note changed elsewhere.
- No hidden state blocks ticking.

### Negative

- Every view reads a working snapshot built from saved notes and unsaved changes, so code that writes revisions must
  keep reading the saved snapshot.
- Desktop positions of discarded never-saved notes stay in the device layout until it is reset. They are not shown
  and backups leave them out.
- "Overwrite" lets this device's text replace another device's newer text in one step; the replaced revision stays
  in history.
- A tick on a paper with unsaved changes is checked against the note's saved revision, not the unsaved text the paper
  was drawn from. The boxes wait for the next frame, which narrows but does not close that window.

### Neutral

- Data written before this decision can hold several entries for one note. The views show the first one found, and
  the next write replaces them all. No migration handles it.
- Native desktop hosts accept an optional boolean `unsaved` on each frame paper, and a null `revision` for notes
  never saved.

## Alternatives Considered

### Alternative 1: One draft per note, managed from the sidebar list

- **Pros**: Smaller change; keeps the drafts list and its wording.
- **Cons**: Keeps a separate "draft" concept and a separate place to find it.
- **Why rejected**: The maintainer asked for unsaved changes on the note itself, not drafts.

### Alternative 2: Show the saved text with only a dot

- **Pros**: Other devices and this one show the same text.
- **Cons**: Text typed and closed seems to vanish, the confusion that started this decision.
- **Why rejected**: A text editor shows what was typed until it is saved or discarded.

### Alternative 3: Keep Cancel as "undo this quick edit"

- **Pros**: Unchanged quick-edit behaviour.
- **Cons**: Adds a third state, the text as it was when the quick edit began.
- **Why rejected**: The product has only saved and unsaved.

## References

- [ADR-009](009-local-renderer-and-persistence.md), [ADR-018](018-single-owner-desktop-views.md),
  [ADR-011](011-immutable-revision-graph.md), [ADR-013](013-complete-portable-backup.md)
- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md) U23 and the quick edit
- [PLAN-010](../plans/010-unsaved-changes.md)

---

*Decision made: 2026-11-01*
*Decision makers: Project maintainer*
