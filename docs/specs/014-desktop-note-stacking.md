# SPEC-014: Desktop notes remember their stacking order

## Metadata

| Field | Value |
|---|---|
| Status | Draft design requested by the maintainer; implementation not started or authorized by this document |
| Owner | Project maintainer |
| Reviewer | Independent review and native-host acceptance pending |
| Decision | [ADR-072](../decisions/072-persistent-desktop-note-stacking.md) |
| Related Plan | [PLAN-015](../plans/015-desktop-note-stacking.md) |

## Summary

The last desktop paper deliberately handled comes to the front of its effective system layer and stays there.
Calling up one group brings that group's eligible papers forward together. Stack, Spread and Reset establish a
predictable order too. These are local layout effects that survive Done and restart, with no separate ordering UI.

## Goals

- Make overlap follow ordinary note interaction, including adjustment and the opt-in quick-move gesture.
- Preserve completed ordering across lifecycle changes without persisting selection or operation scope.
- Keep formation, cycle navigation, Undo and cloud/local coexistence predictable.
- Specify visible results and failure cases for Windows, macOS and the supported Linux backends.

## Non-Goals

- New Bring to front / Send to back actions, ordering preferences, keyboard shortcuts or a layer-management UI.
- Changing resident layers, dragging permission, input fallbacks, the quick-move opt-in or its platform key.
- Syncing visual order, changing shared note revisions, or reordering the main-window board/list or phone screens.
- Implementing ADR-058, publishing a build, or adding migrations for older V1 test formats.

## Authority and changes to earlier contracts

The maintainer's 2026-11-14 request establishes the direction below. Defaults resolve the remaining design details;
they are proposals to evaluate, not claims that the maintainer specified every interaction.

| Kind | Requirement |
|---|---|
| U01 | Ordinary interaction in adjustment or quick move determines note-to-note order; no dedicated ordering button is wanted. |
| U02 | A later handled note should appear nearer the front of its own system layer. |
| U03 | Reset and adjustment's Stack/Spread establish order as well as geometry. |
| U04 | Adjust this group brings the eligible group forward together; the resulting relative order should remain after Done. |
| D01 | Completed relative-order changes also survive renderer/application restart and hide/show. |
| D02 | In Adjust all, selecting or moving a note promotes only that note. Explicit group actions promote a block. |
| D03 | Adjust-mode clicks, cycle steps and quick-edit entry count as deliberate attention; passive reading and child controls do not. |
| D04 | A cancelled drag changes neither saved position nor saved visual order. Attention actions do not clutter layout Undo. |

If accepted, the following specific earlier rules change; unrelated requirements stay in force:

| Existing owner | Proposed replacement |
|---|---|
| ADR-006 decision 7; SPEC-003 U12, interaction table and relative stacking rules | Cycle/selection raises are remembered; active-group/selected-card flags no longer impose permanent sorting overrides. |
| SPEC-003 C14/C17 and all-groups focus behavior | Explicit group entry promotes the block; an individual action in All promotes only the note, with All remaining operable. |
| SPEC-003 formation steps 5–6 and C38 | Single-group formation saves its block raise; all-group formation saves the complete tidy order. |
| SPEC-003 quick-move End and C50/C55/C56 | Drop saves position and visual order together; Cancel restores both; Undo covers both conditionally. |
| SPEC-003 C35 and the desktop handoff's temporary-order statements | Scope, native floating and selection end; completed visual order remains, including after restart. |

This proposal does not reinterpret U18 as permanently floating a group above other applications.

## Functional requirements

### FR01: Define which papers can be compared

Maintain a logical device-wide sequence from back to front, covering all open collections. Only papers actually
projected into the same effective system layer and overlapping output can visually cover one another. The system
layer order remains Wallpaper, Desktop, Top, subject to the host's existing capabilities and reported fallbacks.

A group action includes the group's eligible desktop papers, wherever physically placed. It excludes deleted,
archived, individually hidden, hidden completed, unavailable-profile and off-desktop-group papers. With global
desktop display off, the existing temporary group summon still works, without permanently unhiding any paper.
Unsaved notes that already participate in the working desktop projection follow the same rules.
Source write permission does not forbid a device-local raise or layout move that otherwise meets the existing
input policy; quick editing and membership changes still require their existing content permissions.

The sequence is independent of focus, selection highlight, group colour, opacity and content timestamps. A note on
Desktop cannot cover a resting Top-layer note after adjustment ends simply because it was handled later.

### FR02: Promote one paper or a stable group block

Promote a paper by removing it from its current position in the sequence and appending it. All other papers keep
their relative order. Promote a group by stable partition: all other papers, then that group's eligible papers in
their previous relative order. Neither action changes coordinates, size, membership or resident layer.

For example, the following sequences run left to right from back to front:

| Operation | Before | After |
|---|---|---|
| Adjust all: handle A1 | A1, B1, A2, B2 | B1, A2, B2, A1 |
| Adjust this group A | A1, B1, A2, B2 | B1, B2, A1, A2 |
| Then select A1 | B1, B2, A1, A2 | B1, B2, A2, A1 |
| Done | B1, B2, A2, A1 | B1, B2, A2, A1, projected back onto resident layers |
| Later quick-move B1 | B1, B2, A2, A1 | B2, A2, A1, B1 |

The examples assume peers on the same resident layer. A group is a block when explicitly raised, not a permanent
container: the last row intentionally interleaves groups again. Already frontmost papers/blocks are no-ops.

### FR03: Exact event and persistence boundaries

| Event | Visible preview | Saved result |
|---|---|---|
| Enter Adjust this group, including its menu/shortcut entry | Whole eligible group floats through the existing overlay | Promote group after preconditions and any required unsaved-text flush succeed; retain on Done. |
| Enter Adjust all | Existing overlay floats its participants | Preserve relative order; do not invent a current group or selected note. |
| Finish an adjust-mode click on a paper or its title | Paper previews in front while pressed | Select and promote that paper once on successful release. |
| Drag in adjustment | Dragged paper stays visible above its scene peers | At drop, promote only the dragged paper and save position in the same layout operation. |
| Key + drag outside adjustment | Existing quick-move/lift behavior after the threshold | At drop, save position and single-paper promotion together, without entering adjustment. |
| Key + press/release below threshold outside adjustment | Existing click behavior | No promotion, move, selection or Undo entry. |
| Cycle Next/Previous | Target paper becomes visible in front | Select and promote only the target; no move or resize. |
| Enter quick edit | Existing temporary Top-layer editor | Promote the edited paper once after entry succeeds; later Save, Cancel or Esc does not undo that attention. |
| Change main-window selection or edit there | Main-window behavior | No desktop promotion. |
| Click a checkbox, link, attachment or toolbar control | Existing control behavior | No incidental promotion or drag. |
| Hover, plain resting-paper click/text selection, key press alone, OS focus | Existing behavior | No promotion. |
| Done, Esc with no active gesture, toggle the same scope off | Return to resident presentation | Keep completed order; exit is not a rollback. |

Starting a gesture is not a durable raise. Crossing the threshold then returning to the original coordinates still
counts as a successful drag on release and can save an order-only move; no change at all creates no Undo entry.
A real move followed by the browser's synthetic click is one action, not a second promotion. Duplicate command
delivery must return the same result without allocating another label or Undo entry.

Switching Group A to Group B raises B once. Switching to All preserves the resulting sequence. A background
reconciliation or an echoed frame must not be mistaken for entering the same scope again. An invalid/empty scope,
failed flush or refused activation makes no durable order change. Sign-out, display recovery or renderer recreation
does not replay the last activation.

### FR04: Temporary presentation has a limited purpose

During a held gesture, the drag preview takes visual precedence inside its effective scene. A quick editor retains
its existing temporary floating/editor presentation. These safeguards disappear when the operation ends; the
acknowledged saved sequence then decides paper overlap. Selection highlight and `activeGroupId` alone must not
keep a formerly selected note/group above a paper handled later, or defeat Stack/Spread/Undo.

Cancel on Esc, pointer cancellation/lost capture, display change, invalidated ownership/layer or another existing
gesture-cancellation condition restores the drag's starting saved order and geometry. Do not overwrite a newer
independent layout command while cancelling: discard the preview and project current authoritative state.
Prior completed group activation or selection remains completed; cancelling a later drag does not cancel it.

### FR05: Stack and Spread establish a complete order for their scope

The formation planner uses a stable arrangement sequence: existing `placement.order`, with profile ID and note ID
as deterministic ties. It does not sort its input by current visual promotion. Stack assigns increasing visual
order along its arranged papers so later/lower papers leave earlier summary strips exposed. Spread uses the same
sequence even if all papers currently fit without overlap; an order must not depend on whether the renderer happens
to detect an overlap today.

Single-group formation puts the arranged group at the front as a block. Other groups' geometry and mutual order
stay unchanged. All-group formation orders blocks by occupied region in row-major order, back to front, and then
the stable arrangement sequence within each block. Empty regions contribute nothing. Any overflow/capacity or
size-consent failure leaves both geometry and order untouched.

The formation saves geometry and order as one user action, clears obsolete selection overrides and keeps only the
existing scope/floating permission. Applying the same inputs gives the same relative result. A later selection or
drag may cover summaries again; no background restacking runs.

### FR06: Reset deliberately discards the previous sequence

Confirmed Reset desktop layout clears the old desktop order with its existing placement/history reset. Rebuild
participating group blocks in the reset grid's row-major order, back to front. Within each group, use note creation
order as defined by the core comparator, then note ID; never network arrival, database iteration or profile load
timing. A label counter reservation is not a reason to reset the counter or reuse an old label.

The existing reset policy still controls resident layers, display switches, regions and undo history. Keep the
user's New notes' desktop size preference and place papers at that selected size, fitted by the existing size rules.
Reset cancels active previews/selection overrides. This feature adds no change to note content or cloud data and
does not make Reset undoable. Repeating Reset on the same content/settings has the same relative result.

### FR07: Lifecycle, new notes and membership changes

- Done, hide/show desktop notes, minimize/restore, lock/unlock, scene reload and application restart keep the last
  acknowledged order. Restart begins with no scope/selection/drag. Closing waits for admitted local layout writes
  through the existing close barrier; an unacknowledged write is not described as saved.
- A first desktop placement appends the new paper to the front, as the existing initial-placement behavior intends.
  Within a batch, sort profile IDs lexicographically, then use the core `compareCards` creation/ID order within each
  profile; allocate one device-wide range. This order is independent of the asynchronous arrival of store results. Existing
  papers keep their mutual order, coordinates and size. A live drag/editor keeps its temporary visibility protection;
  a newly placed paper never takes its selection, capture or keyboard focus.
- Reappearing papers with retained placements keep their saved order. Hide/unhide, complete/uncomplete, remote text
  edits, group rename and ordinary sync do not promote them again. Automatic display rescue changes only unreachable
  geometry, not order.
- A remote membership change or a main-window Move to group keeps an existing paper's visual order. A desktop drag
  that transfers a paper promotes that paper with the transfer, without promoting or summoning the receiving group;
  single-group scope behavior stays as in SPEC-003 C25. Cross-profile moves use their existing new identity and
  journal: retain coordinates through the existing adoption policy, assign the target identity a fresh front label
  as a new placement, and do not promote the whole target group or reuse the source identity's label. Neither the
  source nor target label is published to another device.
- Sign-out/unavailable profiles remove only their visible subsequence. Reopening a profile recovers its acknowledged
  labels, without making its papers frontmost just because that profile opened last. Different accounts remain isolated.
- Purge removes that identity's placement/order and cannot be undone by an ordering journal. Archive/Trash visibility
  uses the existing retention rules; this feature never revives a deleted note.

### FR08: Cycling does not chase its changing visual order

Next/Previous traverse the group's stable arrangement sequence, including papers dragged into other regions. Visual
promotion does not mutate that navigation sequence. A full circuit visits every eligible paper once; reverse is
symmetric. New/removing papers follow the existing stable neighbour policy without changing selection just because
sync arrived. Formation or Reset invalidates/rebuilds any navigation cursor from the new arrangement sequence.

### FR09: Undo restores the operation, preserving later attention

Successful moves, desktop group transfers and formations record their pre-action order alongside the existing
geometry Undo. A move's snapshot is from before its gesture preview, not after a pointer-down raise. A drag saves one
Undo step, including a drag whose only lasting effect is its order. A multi-profile formation is one batch step.

Attention-only raises (click, group entry, cycle, quick-edit entry) do not consume Undo. For each affected note,
Undo restores that operation's previous label only if the current label still equals the label the operation wrote.
If a later attention action assigned a newer label, keep it while undoing the eligible geometry effects. Other papers'
relative order is never replaced by a full-scene snapshot. Undo itself does not promote the affected or selected note.
Deleted/purged notes remain absent; newer membership/text is handled by the existing conditional-Undo rules.

For example: move A to the front, click B, then Undo restores A's old position/order while B stays in front. Move A,
then click C and A again, then Undo restores A's old position while keeping A's newer attention order. A group raised
on adjustment entry remains raised when a subsequent Stack is undone back to its pre-Stack state.

### FR10: Storage, failure and backup

Use ADR-072's device-owned labels and counter, not CSS state, clocks or synced note fields. An existing V1 layout
without labels renders deterministically without a migration or bulk rewrite. A new label and all other effects
of a single-profile command are published only after its atomic write succeeds. Ordering alone creates no shared
revision, pending upload or content-history entry. Use the shared owner's serialized command path for all scenes.
Counter reservation alone must not invalidate its command's drag/formation version. Visual-state validation and
durable receipt validation remain distinct, while a genuine intervening visual change still refuses a stale plan.

If allocation or layout persistence fails, discard the preview, keep/reload the authoritative acknowledged layout
and show the existing local-save error feedback. Do not report success, silently claim persistence, discard note
text, or treat the Google sync state as an ordering-save result. An ambiguous write is reconciled before new labels
or a conflicting operation can be admitted. A duplicate/replayed command cannot apply twice.

Across-profile formation/Reset must fence interactive publication, journal their exact affected owners/identities,
and resume idempotently after interruption before reporting completion. Refuse a stale plan if membership, placement
or saved visual order changed after preview; content-only changes keep the existing formation eligibility policy.
No stale journal may overwrite a later completed command or resurrect a purged identity.
Preflight all participating owners before beginning. If an owner becomes unavailable after partial application,
report the batch as incomplete and retain its recovery intent; never report all-profile success. Suspend only
dependent layout work, not unrelated healthy profiles' note capture/editing/sync. On recovery, apply remaining
steps only while their expected state still holds; otherwise keep the newer state and require a fresh arrangement
intent instead of replaying the old batch over it. Partial application/recovery must remain inspectable for Undo.

Backups include only the exported profile's placement labels. With backup layout adoption explicitly chosen,
preserve the backup's internal visual order and assign it a fresh consecutive range at the front of this device's
sequence; unrelated profiles keep their mutual order. Import with the current device layout retained preserves
existing labels and assigns new placements normally. Never import another device's high-water mark or cross-profile
IDs; read the maximum imported label for reservation safety before any rebasing write. Account resets still follow
the existing content reset/restore rules, not an implicit desktop Reset.

## Non-functional requirements

- **Input correctness:** overlap hit testing, native input regions and renderer paint order agree. An obscured paper
  cannot receive a gesture meant for the top paper, and hint/toolbar surfaces do not steal drag capture.
- **Bounded work:** persist once per completed attention command/gesture, not per pointer frame, polling pass or
  content render. Promoting one note writes its placement and the bounded desk reservation, without rewriting every
  paper's content. Native surface identities are not recreated just to reorder DOM papers.
- **Isolation:** route by owner and identity; scene commands do not supply arbitrary counters or foreign profile
  writes. No new network call or scope is needed.
- **Platform accuracy:** keep real native layers, fallback, opacity and lifted-drag behavior. A model/browser result
  alone cannot establish native visual order or Windows/Linux/macOS acceptance.
- **Accessibility:** existing keyboard selection/cycling gets the same saved result; focus restoration alone never
  counts as selection. No new pointer-only control or user-visible jargon is introduced.

## Acceptance cases

All sequences below are back to front; native cases use overlapping test papers so the result is observable.

| ID | Scenario | Required result |
|---|---|---|
| Z01 | Adjust all with A1, B1, A2, B2; click A1 then B1 | A2, B2, A1, B1; Done and restart retain it. Neither click raises siblings. |
| Z02 | Adjust only A in an interleaved sequence | A's eligible papers form the front block, retaining internal order; displaced A papers participate; unrelated geometry is unchanged. |
| Z03 | Enter A, then B, then All, then Done | B's block remains in front of A; All/Done do not sort by the most recently active flag. |
| Z04 | Real drag or quick move of a rear paper; release over another | Paper stays in front after drop, Done and restart; coordinates/order are one operation; synthetic click creates no second write. |
| Z05 | Quick-move key press below threshold, ordinary resting click, text selection, checkbox/link/attachment, hover or focus | No incidental ordering change. Quick edit deliberately raises its one note only after successful entry. |
| Z06 | Cancel a real drag, lose capture, change display or invalidate its layer | No saved move/raise; pre-existing completed attention and newer authoritative commands survive. |
| Z07 | Cross threshold, return to start, release | Order-only move is saved/undoable if needed; already-front no-op creates no extra history. |
| Z08 | Group A Stack/Spread overlaps B's region | A forms a front block in tidy arrangement order; B's positions and mutual order stay; Done retains the result. |
| Z09 | All Stack/Spread with cloud/local groups, empty regions and overflow | Row-major group blocks with stable member order; repeating inputs is stable; capacity/stale-plan failures save nothing. |
| Z10 | Reset after arbitrary raises with mixed paper sizes/preferences | Old order/history disappear; deterministic reset order and selected new-paper size apply; existing reset layer/display policy remains. |
| Z11 | Cycle both directions through at least four interleaved papers | Every eligible note is visited once per circuit; promotions do not skip/repeat candidates; positions/sizes do not change. |
| Z12 | Undo move/formation immediately, and after newer attention raises | Restore eligible position/size/order; keep later labels as specified in FR09; no selected-card override defeats the result. |
| Z13 | Undo a formation spanning profiles, interrupt/restart during apply/Undo | One recoverable batch; no false all-profile success or replay over a newer operation. |
| Z14 | A Desktop note is handled after a Top note, with Wallpaper peers too | On Done each returns to its resident layer; only peers in the same effective layer compete by saved order. |
| Z15 | Two requested layers fall back into one actual scene | Saved order compares them there; reported fallback, click-through and input ownership stay accurate. |
| Z16 | Hide/show, lock/unlock, native scene replacement and owner restart | Last acknowledged sequence retained; no replayed promotion, focus theft or persisted adjust scope. |
| Z17 | New cloud/local notes arrive together during selection/drag/edit | Deterministic device-wide insertion; old peers keep mutual order/geometry; active input/editor is not taken over. |
| Z18 | Hide/unhide, archive/restore, remote membership/text changes, or display rescue | Existing placement order remains; only explicitly handled transfers promote their dragged note. |
| Z19 | Sign out/in, switch account, fail opening one profile, move between profiles | Correct visible subsequence and owner routing; no profile-load-order raise or cross-account label write. |
| Z20 | Export/restore one profile with and without layout adoption | Internal relative order is retained/rebased per FR10; unrelated profile order remains; no foreign IDs/counter in the backup. |
| Z21 | First open of a V1 layout without labels; duplicate old numeric orders across profiles | Deterministic fallback; no bulk rewrite/data discard; first explicit action works across collections. |
| Z22 | Reservation/layout failure, uncertain acknowledgment, duplicate delivery, counter boundary or corrupted label | No wrapped/reused label, false saved result or duplicate Undo; reconcile durable state before proceeding. |
| Z23 | Purge or newer ownership change while a formation/reset recovery journal exists | Recovery respects terminal identity and conditional ownership; no resurrection or stale overwrite. |
| Z24 | Overlap on native Windows/macOS/Linux; drag across displays and DPI changes | Paint/hit-test order agree, layers/opacity/capture stay correct, no remnants; unsupported/unrun combinations are reported separately. |

## Dependencies and open questions

The behavioral defaults and ADR-072's representation await maintainer evaluation; this design request does not start
implementation. No external reference checkout, OAuth change, new permission or release is needed to implement it.
Native availability determines which Z24 environments can actually be accepted. PLAN-015's persistence/fault proof is
a prerequisite for integration, especially counter replication and interrupted multi-profile layout operations.

## References

- [SPEC-003](003-desktop-cards-groups-and-formation.md), [SPEC-002](002-portable-backup-and-restore.md),
  [SPEC-012](012-cloud-and-local-notes.md).
- [ADR-072](../decisions/072-persistent-desktop-note-stacking.md),
  [PLAN-015](../plans/015-desktop-note-stacking.md).

---

*Created: 2026-11-14*
