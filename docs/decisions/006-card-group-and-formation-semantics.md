# ADR-006: One card per thing, group operations and explicit formation

## Status

Accepted (limited to the product semantics the user has confirmed), 2026-10-04.
Parts that the user authorized to be planned by best practice are marked D in
[SPEC-003](../specs/003-desktop-cards-groups-and-formation.md); feature scope not yet decided is marked Q. This ADR
does not accept a specific framework or sync protocol, and does not mean anything is implemented.

## Context

The user needs cross-device desktop notes for capturing ideas as they come and for seeing the backlog.
At first the idea was one note per development machine containing many things; later this was explicitly changed
to one post-it per thing.
The first version is still not centred on full project management. Groups can reflect what is "mine" on this
device, but they do not only represent machines.
Earlier ideas did not match later clarifications: showing cards by changing their height, limiting cycling by the
physical stack, and automatically regrouping on an ordinary drag across regions.

## Decision

1. Card/Note/Post-it are the same kind of content object with a stable identity; one represents one thing.
   This does not forbid a description or checklist steps for the same thing; the user's text is never split
   automatically.
2. A Group is a logical collection; a Region is a device's formation target area; a Group is not a Device.
3. The product has at most nine groups; the grid is rows × columns, with rows ≤ 3, columns ≤ 4 and
   rows × columns ≤ 9.
   2 rows × 4 columns and 3 rows × 3 columns are allowed; 3 rows × 4 columns is not.
4. A card can be dragged freely into another group's region; an ordinary move does not change its group.
5. Formation is a one-time authorization to tidy positions, for all groups or for one group; for one group it
   recalls that group's cards that were dragged away.
6. Stack shows the first line of each card as a summary; Spread lays them out neatly. Cards normally keep their
   size; there is no accordion.
   When needed, formation may resize cards after consent; without consent cards may extend beyond the group
   region.
7. Cycling only changes the stacking order temporarily: the current group as a whole sits above other groups, and
   the selected card is frontmost within the group.
   Cycling does not recall positions or resize, and does not promise that every summary stays visible; a new
   formation tidies them again.
8. A new card is placed in its own group's region by default; existing cards are not rearranged automatically
   because of an addition or a sync.
9. Formation can undo positions, sizes and the basic stacking order; it does not roll back content or remote
   changes.
10. A shortcut for a specific group starts drag mode, and that group temporarily floats above ordinary apps such
    as an IDE or a browser; ending the operation restores its normal resident layer. An all-groups entry was
    adopted with the user's authorization, for users not familiar with groups.
11. A single click selects and a double click edits; dragging onto a group's receiving label, or holding Shift while
    dragging into a region, changes the group only on release.
    The card action "Move to group" stays; changing the group is not formation.
12. By default cards are read-only and mouse clicks pass through; the local operation lock is separate from source
    permissions and cross-device writes.
13. Windows, macOS and Linux remain required desktop platforms; the goal of publishing our own Apple and Google
    apps remains.
14. 1.0 does not add focus, Pomodoro or review features, and does not copy the reference app's interface or
    architecture.

Explicit answers later the same day accepted "above ordinary apps" and the gestures in point 11; they must not be
listed again as unanswered questions.
The concrete arrangement of one default group for beginners, the all-groups entry and row-first order comes from
the scope the user delegated to design; it is not claimed to be keys or default group names the maintainer
specified word for word.

## Consequences

### Positive

- Quick capture and free placement on the desktop coexist, and the intent to tidy is distinct from the intent to
  regroup.
- Sources, shared membership, per-machine layout and short-lived interaction can evolve separately.
- Single-group and all-group operations share one set of semantics; beginners do not have to create nine groups
  first.

### Negative

- Temporary floating layers, pointer tracking, draft saving and undo must be managed; a single unlock boolean
  cannot handle all of them.
- Limited desktop space cannot unconditionally guarantee that summaries of any number of papers stay visible;
  previews and clear capacity limits are needed.
- Cross-platform native surfaces do not guarantee arbitrary stacking order; the presentation must follow the
  limits in [ADR-007](007-desktop-scene-and-platform-host.md).

### Neutral

- The card body format, attachments, the full backup scope and a per-card layer settings UI are still Q items in
  SPEC-003.
- "At most nine groups" is not a permanent limit on future schemas, and does not require nine machines.
- The Google source and backup proposals still exist, but the old exclusion list was not approved automatically.

## Alternatives Considered

| Option | Outcome |
|---|---|
| One note container per machine holding many independent issues | Replaced by the later one-card-per-thing requirement |
| Expanding a single card's height / accordion for a whole group | Explicitly rejected by the user; not a product mode |
| Regions as hard containers, crossing a region changes the group | Does not meet the free-drag requirement |
| Cycling moves positions, dragging a card away leaves the group's cycle | Replaced by temporary z-order and logical group rules |
| Automatic formation after a new card or a sync | Violates the explicit authorization to rearrange |
| Unlocking the whole desktop as the only entry | Single-group operation added; all groups keep a convenient entry |
| Bringing in a full PM / agent workflow now | Research kept; not required in the first version |

## References

- [SPEC-003: full behaviour and C01-C48](../specs/003-desktop-cards-groups-and-formation.md)
- [How the discussion evolved and where decisions came from](../research/2026-10-04-desktop-card-interaction-design.md)
- [PLAN-003](../plans/003-desktop-interaction-implementation.md)
