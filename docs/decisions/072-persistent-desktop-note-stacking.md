# ADR-072: Remember desktop note stacking through ordinary interaction

## Status

Proposed, 2026-11-14. The maintainer requested this design, specification and implementation plan; this document
does not authorize or claim implementation. The requested direction is recorded separately from proposed defaults
in [SPEC-014](../specs/014-desktop-note-stacking.md). Work is ordered in
[PLAN-015](../plans/015-desktop-note-stacking.md).

If accepted, this partially supersedes ADR-006 decision 7 and SPEC-003's temporary relative-order rules, including
the quick-move rule that a completed move leaves the base order unchanged. It preserves the resident-layer,
geometry, input, content and account-isolation contracts. Until then those documents describe existing behavior.

## Context

A user expects the paper they just handled to remain in front of overlapping papers after releasing it or pressing
Done. Calling up one group should similarly leave that group's papers in front of their peers. A dedicated Bring
to front action would make an ordinary physical-paper expectation into extra UI work.

The current implementation has some ordering, rather than none:

- `Placement.order` supplies stable ordering for initial placement, formation and cycling.
- `sceneOrder()` adds temporary active-group, selected-card and dragged-card priorities. Selection and activation
  do not persist a new order; a move saves coordinates without changing the stored order.
- Ending adjustment clears the interaction state, so that relative raise disappears. Quick move also clears its
  temporary raise on release. Formation can save order values but uses temporary group attention as well.
- `CombinedLayout` merges cloud and local placements whose numeric orders were allocated independently. A new
  per-profile maximum is insufficient to put a paper in front of every open collection's papers.

These are observations from the repository, not a trace of a particular installed host. The relevant sources are
`src/interaction/controller.js`, `src/layout/store.js`, `src/layout/formation.js`,
`src/core/combined-workspace.js` and `src/desktop/projection.js`.

## Decision

### 1. One remembered sequence, projected into each effective system layer

Model one device-wide back-to-front sequence of placed notes, with explicit profile ownership. Project that sequence
into each output and effective native layer; the renderer controls paper order inside a scene. A note may move to
the front of its peers without changing its resident Wallpaper, Desktop or Top layer.

Adjustment and quick editing still temporarily float their participants as required by SPEC-003 and ADR-042.
Done removes that temporary presentation and input permission, while retaining completed relative-order changes.
Windows' existing lifted quick-move exception remains an implementation of temporary presentation, not a saved
resident-layer change. Native layer fallback is resolved before comparing visible peers.

### 2. Raise a note for a note action, a block for an explicit group action

Use stable sequence operations, without a new button, preference or shortcut:

- A completed selection in adjust mode, a completed drag, quick edit entry or an explicit cycle step promotes that
  note. In Adjust all, handling one paper does not promote the rest of its group.
- Entering Adjust this group promotes all that group's eligible desktop papers as one block, preserving their
  relative order. A single-group Stack or Spread promotes the arranged group as a block too.
- Entering Adjust all, changing focus, merely hovering, or exiting a scope does not reorder notes.
- A drag previews a raise while held and commits it with the drop. Cancellation leaves its starting order intact.
  A quick-move press below the threshold still does nothing; it is not a hidden Bring to front gesture.
- Stack, Spread, Reset, new placement, Undo and restore follow the explicit rules in SPEC-014. Background text
  updates and renderer/native-window reconstruction never become implicit interaction events.

Groups are not permanently nested stacking containers. A later individual note action can interleave two groups;
the next explicit group action brings that group together at the front again. This permits both simple expectations
without inventing a second permanent group-priority hierarchy.

### 3. Separate visual order from arrangement and navigation order

Keep `placement.order` as the stable arrangement/navigation order. Add optional device-local `placement.zOrder` as
the remembered visual order. Missing values use the deterministic existing order, then profile ID and note ID;
they precede explicitly assigned visual labels. First use therefore needs no bulk rewrite or migration.

Use a 32-character lowercase hexadecimal label for `zOrder`, compared lexicographically. The device desk owns a
`zOrderCounter` high-water mark of the same form. The shared owner reserves an ascending range before a command;
the affected profile commits the labels with that command's geometry, membership and Undo information. Larger
labels are nearer the front. A block receives a consecutive range in its intended internal order. The counter is
not a timestamp, native window level or CSS z-index. Rendered CSS indices remain dense, small integers per frame.

The counter lives with the existing replicated device desk, outside synced note data. It must never be reused after
restart, an ambiguous write, profile reopening or backup adoption. Reconcile the highest durable desk/placement
label before allocation, acknowledge the reservation before publishing, and leave unused reservations as harmless
gaps. A failed or uncertain reservation cannot be followed by an unfenced allocation. Refuse exhaustion or malformed
values; do not wrap, round through JavaScript Number, or silently change a schema without a compatibility decision.
Counter-only receipt changes are bookkeeping, not a new visual layout: validation must not invalidate a valid drag
or formation preview merely because its own range was reserved. Validate the relevant visual state and commit the
intent under the shared command barrier; keep storage receipt versions distinct from visual-state fingerprints.

This bounded label avoids rewriting unrelated profiles just to raise one note. Its physical representation is an
implementation default of this proposal, not a new user-facing concept. This compatible optional-field addition retains V1 with prior-layout/backup tests under ADR-073.

Cycling reads the stable arrangement sequence, not the changing visual labels. Persisting a cycle step therefore
cannot change which paper Next or Previous visits next. Formation explicitly establishes a new tidy visual order
from that stable sequence, rather than inheriting a selection override that could hide summary strips.

### 4. Preserve local transaction and isolation boundaries

Keep each note's label beside its placement in its owning profile. A completed drag saves position and visual order
in the same existing profile transaction; a group transfer also keeps membership and outbox atomic. A group belongs
to one profile, so a group raise needs no content write or cross-database transaction. Reserving counter values is
not itself a visible ordering change or a successful layout operation.

Global formation and Reset span profiles today. Their implementation must retain the existing batch semantics,
fence interaction/publication while applying, and make interrupted completion recoverable. PLAN-015 requires a
bounded local layout-operation journal and fault tests before claiming all-profile completion. This does not create
a new whole-application transaction framework or authorize changing the proposed ADR-058 lifecycle architecture.

No label is a Google revision, pending upload, account permission or edit timestamp. Ordinary sync never transfers
the sequence to another device. Portable layout backups preserve the exported profile's relative order without
including other profiles' identities or the desk counter. Explicit layout adoption rebases that order into this
device's sequence; it does not replace unrelated profiles' order. SPEC-002's existing layout-choice rules still apply.

### 5. Keep Undo useful

Drag and formation Undo restore the order they changed along with their existing geometry effects. Click selection,
group activation, cycling and quick-edit entry are attention actions and do not add standalone Undo entries. Their
later order changes are protected by per-note before/after label checks when an older geometry action is undone.
Undo never re-promotes a still-selected note merely because it retains a selection highlight. Reset retains its
existing confirmation and clearing of layout history; this proposal does not add Reset Undo.

## Consequences

### Positive

- Ordinary interaction decides visible overlap without another control or a permanent group hierarchy.
- Done, hide/show, renderer recovery and application restart preserve completed work.
- Cloud and local papers share one order while their content, storage and backups remain isolated.
- Arrangement, cycle navigation and relative visual order each have a clear purpose.

### Negative

- Attention actions now write small local layout changes; they need deduplication, failure feedback and close-time
  flushing. Pointer moves and render refreshes must not cause writes.
- Counter reservation, conditional Undo and interruption across profiles need failure tests, not only CSS tests.
- A lower resident layer cannot cover a higher one after adjustment ends. The visible result must be accepted per
  host, including native fallback and the Windows lifted-drag path.

### Neutral

- Existing note positions, sizes, group membership, resident layers and sync semantics are preserved by a raise.
- Main-window board/list ordering and phone UI are outside this desktop presentation feature.
- The proposal adds no dependency, service, OS permission, release action or automatic data deletion.

## Alternatives Considered

| Alternative | Benefit | Reason not chosen |
|---|---|---|
| Dedicated Bring to front / Send to back controls | Explicit arbitrary ordering | Extra UI for the interaction the maintainer wants to express by handling a paper |
| Keep every raise temporary | No new persistence | Releasing a drag or Done unexpectedly hides the paper again |
| Persist only at Done | One session commit | Quick moves have no Done; crashes lose completed interaction and scope changes become ambiguous |
| Always raise the active group for every note click | Matches today's temporary comparator | In Adjust all, touching one note would also cover unrelated work with all its siblings |
| Reuse `placement.order` for every raise | Fewer fields | Existing formation and cycle order would move after each selection, making navigation unstable |
| Wall-clock timestamps or independent per-profile counters | Small implementation | Clock changes and profile collisions fail the device-wide ordering contract |
| Store every paper's order only on the desk | One total-order record | Separates a move from its atomic profile placement/Undo and complicates isolated backups |
| Raise native windows individually | Uses host APIs | The shared renderer already owns the papers; native surface order is not the cross-platform paper contract |

## References

- [SPEC-014](../specs/014-desktop-note-stacking.md), [PLAN-015](../plans/015-desktop-note-stacking.md).
- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md),
  [ADR-006](006-card-group-and-formation-semantics.md), [ADR-007](007-desktop-scene-and-platform-host.md).
- [ADR-008](008-portable-interaction-core.md), [ADR-042](042-adjust-overlay-on-every-desktop-host.md),
  [ADR-073](073-alpha-data-compatibility-and-migrations.md), [ADR-066](066-cloud-and-local-notes-side-by-side.md).

---

*Proposed: 2026-11-14*
