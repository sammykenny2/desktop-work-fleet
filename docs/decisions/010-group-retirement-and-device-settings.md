# ADR-010: Group merge and stable device settings

## Status

Accepted (local merge command and settings), 2026-10-04.
Revised 2026-10-06: number shortcuts are now bound to desktop regions and step through the group's layers; see
the shortcut items under Decision.
Merge cycles and dependency handling in the remote revision graph belong to the sync slice; this record does not
claim they are done.

## Context

SPEC-003 Q06 approved that deleting or merging a group must choose a target group and show a preview, and must
never imply deleting cards.
After a group changes, existing drafts, deleted cards, shortcuts and each machine's grid still need valid targets.
Changing only group.deleted leaves data without a reachable entry; unconditionally resetting draft versions can
overwrite other changes.

## Decision

- The same "merge or remove group" flow handles empty groups and groups with data; the target must be another
  group that still exists.
  The last group cannot be removed. The preview counts active, completed, archived and Deleted cards and drafts.
- The preview fingerprint pins the versions of the source and target groups, every affected card version and the
  drafts; it is checked again at the Workspace's atomic commit point, and if anything changed a new preview is
  required instead of accepting the new scope automatically.
- Every card only changes its primary group and revision; content, attachments and the completed / archived /
  deleted state are kept in full.
  The old group leaves a tombstone with redirectGroupId, and a late local quick capture follows to the valid
  target group.
  A missing dependency or a redirect cycle reports a clear error; it never guesses a group or deletes data.
- A draft's groupId and the baseRevision of a known membership-only change are updated together, including the
  recovery lineage.
  The local membershipRebases only records the membership-only revision edges that a merge produced; a late
  autosave follows these edges at the serialized save point and stops at a body update, keeping the original
  version conflict.
  This map is local coordination data, not portable content or an authorization for sync across accounts.
- Groups, cards, drafts, the outbox and layout settings are committed in the same transaction. If saving fails,
  all three keep their original values;
  the shared data transaction must run even when the group has no region yet and no geometry changed.
- All card geometry is kept; the source group's region becomes empty; the device's "mine" group (`myGroupId`) and
  shortcuts from older versions bound to the group move to the target group; shortcuts bound to a region stay with
  that region.
  Old related group-change undo entries become invalid and are removed; other geometry undo entries are kept.
  A merge is not a layout undo, and the layout Undo does not recreate the group; the confirmation explains this
  first.
- Group regions can be swapped while group IDs stay stable; number shortcuts follow the region. Queued old
  settings and new-card placements check the group set again at the atomic save point, so a retired group is
  never written back into the grid or local preferences.
- Shortcuts point to explicit actions: all groups, Quick capture, the display toggle, or regions 1-9 (left to
  right, top to bottom); several bindings may point to the same action.
  A region key acts on the group currently in that region; keys for empty regions are not sent to the native host
  for registration, and the native host still receives group IDs.
  Settings from older versions bound to group IDs can still be read; when the workspace opens or a restore runs,
  they are changed to the region where that group sits, and regions without a key get their default number, once.
  Duplicate canonical keys, invalid modifiers and vanished groups are rejected.
- The layer belongs to the group: each computer's layout records in `groupLayers` whether each group is on the
  wallpaper layer, the desktop layer or the top layer; a group with no record is on the desktop layer.
  A group new to this computer is recorded on the wallpaper layer, in the same transaction that adds it, where the
  desktop offers that layer; elsewhere it gets no record. New means created on this computer (the first default
  group, the account's starter group or a group the user adds) or received from a sync source without having been
  held before (a retired group counts as held). Groups it already holds are not changed, except that resetting the
  desktop layout records every active group on that same back layer, or clears every record where the desktop
  offers no wallpaper layer.
  The desktop app's group settings can show and change the layer; phones and the browser preview have no desktop
  layers and do not show this option.
  Note details no longer have a per-note resident layer or "Select text while locked".
  Notes on the desktop layer and the top layer allow selecting text and clicking links while locked (mouse clicks
  do not pass through); the wallpaper layer always passes clicks through.
  A layer stored on each note by older versions is changed, when the workspace opens or a restore runs, to the
  lowest layer among each group's shown notes, and the per-note field is removed; old backups can still be
  restored.
- On the desktop app, a region key steps the group through its layers: wallpaper layer → desktop layer → top
  layer → Adjust mode, and one more press goes back to the wallpaper layer; a host without a wallpaper layer
  starts from the desktop layer.
  The first three steps write the group's layer; Adjust mode is an interaction scope and is not written.
- After each region key or all-groups key takes effect, the frame data carries a `notice` (group name, current
  step, number of steps and the group's region), which the top-layer scene shows in the centre of the region for
  about 1.5 seconds; the native host only uses it to keep the top-layer scene shown even when it has no notes, and
  never adds it to the input region.
  The layer is written before switching to Adjust mode, so on leaving Adjust mode the notes land directly on the
  new layer.
  The all-groups key keeps its original meaning: all groups enter Adjust mode, and pressing again returns each to
  its own layer, without changing any group's layer.
  When notes are hidden while locked, or there is no native desktop (browser preview), a region key only toggles
  Adjust mode for that group.
  The preview receives shortcuts only in the current browser window; the native host must report separately
  whether global registration succeeded.
- A scope shortcut during inline editing can save the draft first and then switch or exit; the
  CompositionEvent lifecycle, child dialogs and Ctrl/Meta select all, copy, cut, paste, undo and redo go to the
  editor first.
  After a card is selected or the group is switched successfully, the sidebar's current group and cycling / group
  formation use the same target.

## Consequences

### Positive

- A merge keeps all content and desktop placement, and unfinished drafts can still be committed safely.
- Number keys match the regions visible on the desktop, so a new group needs no extra setup; a failed setting
  leaves no partial change.

### Negative

- Tombstones and the membership revision map add storage; there is no automatic GC for now.
- After a merge the original group cannot be rebuilt with layout undo; create a new group and move the cards
  explicitly.
- Concurrent merges on other devices can create cycles; the sync slice must keep conflicts and dependencies and
  cannot skip this acceptance.
- After regions are swapped, number keys follow the region; the region arrangement is stored per computer, so the
  same number key can map to different groups on different computers.
- Notes in the same group cannot be placed on different layers; to separate them, split them into different
  groups.
- Notes on the desktop layer no longer pass mouse clicks through and block the desktop icons beneath them; to pass
  clicks through, move the group to the wallpaper layer.

### Neutral

- The completed state does not remove a card from the desktop automatically; the desktop marks it with the
  completed style, and the list's To do filter excludes completed cards.
  Only archiving, deleting or explicitly hiding takes a card out of the desktop set.

## Alternatives Considered

- Deleting the group and all its cards directly: violates the approved requirement never to imply deleting cards,
  so it was not adopted.
- Merging unconditionally with the full current data after the preview: new data the user has not seen would be
  changed, so it was not adopted.
- Always moving drafts to the latest revision: could overwrite body conflicts, so drafts only follow provable
  membership-only edges.

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [ADR-008](008-portable-interaction-core.md)
- [ADR-009](009-local-renderer-and-persistence.md)

*Decision made: 2026-10-04*
