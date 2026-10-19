# SPEC-003: Desktop cards, groups, formation and interaction contract

> UI terms (2026-10-06): the "everyday" state in this document is called "Locked" in the UI, and "operation scope /
> operate this group" is called "adjust mode / Adjust this group"; the exit button is "Done". Changing text is still
> called "Edit". The resident layers, from back to front, are "Wallpaper layer / Desktop layer / Top layer" (internally
> `wallpaper` / `desktop` / `floating`). Internal code names (`operationScope` and others) are unchanged.

## Metadata

| Field | Value |
|---|---|
| Status | Confirmed requirements plus authorized working defaults; implementation is under way in slices. Current status is in [PROGRESS](../../PROGRESS.md); history and verification evidence are in the git history and [testing](../testing.md) |
| Owner | Project maintainer |
| Reviewer | No independent review yet; this document is not product acceptance evidence |
| Date | 2026-10-04, Asia/Taipei |
| Related Plan | [PLAN-003](../plans/003-desktop-interaction-implementation.md) |
| Decision | [ADR-006](../decisions/006-card-group-and-formation-semantics.md) |

## Summary

The product centres on quickly capturing ideas and seeing what is still unhandled. One note is one thing, organized
in groups. Users place notes freely; only an explicit formation authorizes rearranging positions in bulk.
Normally desktop notes are read-only and click-through. Activating a given group or all groups floats them above
ordinary apps for a while: first in drag mode, then, explicitly, into editing a single card. Group membership, card
position and temporary stacking order are separate data.

This document is the normative entry point for this interaction work. The 2026-10-03 MVP assumptions (plain text only,
a Note as a container of several independent Items, no groups and no formation) cannot override it.
The first delivery only organized the specification; on 2026-10-04 full 1.0 implementation was authorized.
Passing model tests do not mean that the renderer, the native hosts and sync are all accepted. Current status is in
[PROGRESS](../../PROGRESS.md); history and verification evidence are in the git history and [testing](../testing.md).

## Authority and reading rules

- **U (User confirmed)**: the user has explicitly confirmed it. Implementation must follow it, and answered questions
  are not asked again.
- **D (Delegated default)**: an implementable default set after the user authorized planning the remaining details by
  best practice. It does not claim to be the user's verbatim choice. If platform evidence forces a change, explain the
  impact first and update the document.
- **Q (Question)**: still needs a requirements decision. Only features that depend on it pause; other authorized work
  can proceed.
- **E (Evidence)**: facts from an existing implementation or external protocol, kept separate from "the new feature
  has been tested".

Later written answers in this round confirmed: while a group is being operated, it covers ordinary apps such as an IDE
or a browser; single click selects, double click edits, dropping on a label or a Shift-drag moves a card to another
group, and the card menu stays. These two items can no longer be recorded as pending. If the maintainer later changes
the requirement, update this document from the latest explicit instruction.

## Goals and scope

### User boundaries (U)

| ID | Boundary |
|---|---|
| U01 | One card/note/post-it records one thing; it is not a machine list carrying several independent issues |
| U02 | Quick capture and the backlog come first; 1.0 does not force Projects, Scrum, agent execution states or complex workflows |
| U03 | Groups are a general concept; a device may highlight the groups that are "mine", but groups must not be hard-coded as machines |
| U04 | Windows, macOS and Linux are required desktop targets; actual Linux support lists evidence per desktop environment |
| U05 | The own iOS/macOS/Android store targets stay; phone editing must not be reduced to the Drive web page only |
| U06 | The first version uses a Google account plus a file source, with no own local note server; the source/renderer boundary is designed first |
| U07 | Everyday notes are read-only and click-through, and still receive updates from other devices |
| U08 | Cards can be dragged freely across group regions; crossing a region by itself does not mean changing group |
| U09 | Formation can arrange all groups or a single group; a group formation recalls that group's cards that were dragged away |
| U10 | Stack/spread change positions and overlap; no accordion and no expanding content height card by card |
| U11 | A stack formation should expose each card's first-line summary; spread arranges whole, uncovered papers |
| U12 | Cycling only adjusts the stacking order temporarily; the current group is above the other groups, and the selected card is frontmost in its group |
| U13 | Card size is normally stable; formation may adjust it with the user's consent, and without consent cards may extend beyond the group region |
| U14 | A new card's initial position defaults to its own group region; adding or syncing does not rearrange existing cards |
| U15 | Formation can be undone |
| U16 | At most 9 groups; the grid has at most 3 rows and 4 columns and at most 9 blocks in total, so 3 rows × 4 columns is forbidden |
| U17 | A shortcut can activate drag mode for a single group, then enter editing of a single card |
| U18 | The group being operated floats above ordinary app windows for the time being and returns to its original layer afterwards |
| U19 | Single click selects, double click edits; an ordinary drag only moves; only a group label or a Shift + region drop moves a card to another group |
| U20 | The card actions keep a "Move to group" entry |
| U21 | Designed independently from scratch; no reuse of the auxiliary reference application's UI, assets, data contracts or large amounts of code |
| U22 | Focus/Pomodoro and review features are not part of 1.0; the existing PM and architecture research is kept for later use |
| U23 | When editing ends (close, keep draft, Esc, Done, selecting another card, formation, the card leaving the scope, and so on), blank drafts (no text, attachments or other content fields) and unmodified drafts identical to the note's current version are not kept; changed drafts are kept as usual (2026-10-06) |

### Working defaults (D)

- Provide "operate on all notes". On first use a single default group is enough to work; users are not forced to learn
  groups first.
- Use "rows × columns" and a left-to-right, top-to-bottom initial group layout.
- In v1 each card has one primary group; shared identity and future extension points do not forbid multiple membership.
- A device has only one operation scope at a time (one group or all), and at most one card edited in place on the
  desktop. Drafts in other main-window or phone editors can coexist; desktop mode does not take a cross-device
  exclusive lock.
- Shared content and membership sync; each device's coordinates, sizes and region layout are independent; operation
  focus is not persisted.
- Detailed D rules are in the following sections. D items not listed under Q can be built as written once
  implementation is formally authorized.

### Features not excluded

One card per thing does not forbid explanatory paragraphs, Markdown or checklist steps for the same thing.
This document does not decide on plain text only, and does not exclude attachments, extensions, layout backups,
automatic backups or other restore methods. Their concrete 1.0 scope is in the Q table; they must not be dropped
because an old draft had an exclusion list. Multiple membership across machines is not required for 1.0, but it is
not forbidden forever either.

## Terms and data ownership

| Concept | Meaning and life cycle |
|---|---|
| Card / Note / Post-it | The same product object: stable ID, content and primary group membership; a window ID does not stand in for it |
| Group | A logical collection of cards; its name and stable ID do not depend on which machine is viewing it |
| My group | A device-side local highlight setting; the same group data can be highlighted differently on machines A and B |
| Region | The target area the current device's formation gives a group; not a hard container, clipping area or permission scope |
| Formation | A one-off arrangement command issued by the user, with a chosen scope and stack/spread; not automatic background layout |
| Base order | The stable stacking order of the device layout, separate from the temporarily selected card |
| Active group | The group currently in attention or being operated; all-groups mode can also have an active group |
| Operation scope | None, Group(id) or All; decides which cards can be operated at the moment |
| Selected card | The frontmost card in the current group; selecting is not text editing |
| Editing card | The single card explicitly in text editing; drafts have their own reliable save flow |
| Locked / click-through | A local guard against accidental input; not a permission, a read-only source or a write lock for other devices |

### Boundary between synced and device state (D)

| Shared data | Persisted per device | Transient for the current operation |
|---|---|---|
| Card ID / content / primary group ID | Card position, size, base stacking order | Operation scope, active group, selected card |
| Group ID / name / semantic metadata | Grid, group-to-region mapping, local highlight | Drag start, candidate drop target, highlight |
| Formally defined deletion/conflict data | Display set, resident system layer preference | Pointer capture, keyboard focus |
| Shared appearance fields (if adopted) | Local undo records for formation and dragging | Editor UI state (text drafts are persisted separately) |

The active group, native window handles, OS layer numbers and Google tokens must not be written into shared cards.
If per-device layout backups are synced in future, they stay partitioned by device; A's formation must not change B's
desktop. A card seen by several machines does not have several groups at once, and a group is not a machine.
Local highlighting prefers device-side decoration; card colours on all devices must not be overwritten through sync
because A is "me".

## Group and grid contract

### Group identity and first use (D)

- On first use one default group can be created. It counts toward the 9 groups; there is no free tenth "Ungrouped"
  group.
- Quick add does not force a machine, project, owner or execution state. With a clear target it uses that group;
  without one it uses the visible default group. Which group a device highlights does not change other devices'
  default for new cards.
- Renaming a group or changing its grid position changes neither its stable ID nor the group a shortcut is already
  assigned to.
- Each device lists its groups in its own region order (left to right, top to bottom), then any group no region
  holds. Reordering the sidebar moves groups between the regions they hold, leaving empty regions in place, so region
  keys follow; it moves no paper and syncs nothing. Default regions rebuilt for a new group or a layout reset keep
  that order. While more than nine groups exist the regions cannot hold them all, so the order cannot change until
  groups are merged.
- Each device stores which of the nine palette colours each group wears. A group without a stored colour takes the
  colour of its place in the workspace list when no other group wears it, otherwise the first free colour; a retired
  group frees its colour; choosing a colour another group wears swaps the two. Colours never sync, and reordering
  groups does not repaint them. Past nine groups, colours repeat.
- The sidebar marks this device's "My group" with a star. On desktop computers each group row also shows the layer
  its papers rest on, as a three-plate icon with the layer named in its tooltip; where the desktop cannot offer the
  chosen layer, the icon shows the layer the papers fall back to and the tooltip names both.
- Saving a group's settings with its name unchanged, for example to change only this device's layer, records no group
  revision, so nothing syncs and no other device's edit of that group can conflict with it.
- A group new to a computer starts at the back of that computer's desktop: the Wallpaper layer, or the Desktop layer
  where the desktop offers no Wallpaper layer. This covers groups created on the computer (the first default group,
  the account's starter group and groups the user adds) and groups that sign-in or sync brings to it for the first
  time. Groups the computer already held keep their layer; "Reset desktop layout" puts every group on that back layer.
- Shortcut bindings are a local setting. Ctrl+Shift+1 to Ctrl+Shift+9 are the candidate default combinations and 0
  maps to all; all of them can be changed. A shortcut that failed to register must not be shown as available; a
  combination conflict should not stop the app from starting.
- Every shortcut action has an entry in the main window or a reachable menu. Phones use the same semantic commands and
  do not simulate global desktop keys.

### Valid layouts (U16 + D)

Let rows be the number of rows and columns the number of columns. All of the following must hold:

```text
1 <= rows <= 3
1 <= columns <= 4
rows * columns <= 9
groups to arrange this time <= rows * columns
```

| Rows | Allowed columns | Blocks |
|---|---|---|
| 1 | 1, 2, 3, 4 | 1, 2, 3, 4 |
| 2 | 1, 2, 3, 4 | 2, 4, 6, 8 |
| 3 | 1, 2, 3 | 3, 6, 9 |

2 rows × 4 columns means two rows, one above the other, with four blocks each; 3 rows × 3 columns is valid; 3 rows × 4
columns is not. The UI shows rows/columns text and a small grid preview, not just an easily confused "2×4".
Seven groups can use eight regions and keep an empty one; nine groups cannot use eight regions. An invalid choice keeps
the current layout and does not delete or merge groups. An empty region has no target group; dragging into it neither
moves a card to another group nor creates a group.

Nine groups is a product limit, not a reason to persist IDs as 0 to 8.
If two devices create groups offline and syncing then produces more than nine, all known data must be kept, the user
is told to tidy up, and formations that cannot fit are paused. The tenth group must not be dropped, merged arbitrarily
or have its content hidden.

## Card geometry and preview text

### Paper model (U10, U11, U13)

- Selecting, cycling, a single click, a double click or starting to edit never change a card's paper size.
- Stack and spread arrange fixed papers. They must not become an accordion, stretch one card taller, or switch a
  summary to full-text height.
- Size may be adjusted in a formation with explicit consent; this is an exception the user added later.
- No fixed 140×140 or other pixel size is approved; earlier illustrative sizes are not product specifications.
- Approved by the user on 2026-10-17: papers newly placed on the desktop default to 240×240, like the common 3×3 inch
  square sticky note. Papers that already have a position keep their size and use the new default only after "Reset
  desktop layout". This is a default; it does not forbid a formation from adjusting sizes with consent.
- Approved by the user on 2026-10-17: when a group region, minus a 12px margin on each side, cannot fit 240, new papers
  shrink to the square that just fits, at least 160×160. For example, nine groups in a 3×3 grid on a 1280×775 work area
  get 234×234, and in stack and spread the first paper of each group stays inside its own region.
- Measured on 2026-10-17 with the same long text: a 240×240 desktop paper at 14 px shows 8 lines without attachments
  and 5 with them; the 160×160 minimum shows 2 lines with attachments. On the main window board a 1280-wide window
  gives papers of about 229 px, 4 lines with attachments; at phone width papers are about 174 px, 1 line with
  attachments. The aspect ratio stays as it is until the user decides between square and portrait.
- Mixed paper sizes, measured on 2026-10-17 with 280×220 and 240×240 papers in one group: square papers fit the same
  number or more per group when the work area is wide (1536×816, 2 groups: 9 square against 6 in spread) and slightly
  fewer when it is short (1366×728, 1 group: 10 square against 12 in spread).
- The title band at the top of a paper is the drag handle. The body always starts from the first line, even when the
  title band shows that same line. On 2026-10-17 the user pointed out that the earlier "the body does not repeat the
  title" rule left the body of a one-line note completely blank; that rule was dropped.
- User instruction on 2026-10-17: the body shows as much as fits in the paper. Papers that can scroll do so as in Q07
  and get no "…": the Desktop layer, the Top layer, papers in adjust mode, and operable papers in the main window's
  desktop view. Papers that cannot scroll end with "…" when the text does not fit: the main window board (a click opens
  the editor) and the Wallpaper layer. With attachments, the bottom of the paper keeps one row of thumbnails (62px
  high), left to right. Thumbnails that do not fit are not shown, with no horizontal scrolling, buttons or hover
  reveal; opening is still a double click. The main window board, the main window's desktop view and native desktop
  papers behave the same. Hidden attachments in the strip cannot be reached with Tab (2026-10-17).
- Paper background colours come from one shared nine-colour palette (`src/core/palette.js`), the same in the main
  window and on the desktop; which entry each group wears is a device setting (see "Group identity and first use") and
  never part of shared data. As of 2026-10-17 the shared palette, and new
  papers that shrink to fit a short region, have been checked only in browser and scene probes, not on a native
  desktop.
- Content too long for a card is handled by reading and editing within the stable size, not by automatically stretching
  the whole paper.

### First-line summary (D)

The summary is the first readable, non-empty text paragraph of the content, laid out on one line; users must not be
forced to fill in a separate title first.
If the data also has a title the user set explicitly, it can serve as the summary, but this must not create two
identical copies that have to be edited together.
Approved by the user on 2026-10-17: the editor gets an optional title, stored as `title` in the content. When it is
filled in, the summary uses the title; when it is left empty, it is not written and the summary falls back to the
first line of the body. Search matches both the title and the body.
Line breaks collapse to spaces and overlong text ends with an ellipsis; a blank draft shows a stable placeholder.
Summaries of checklists and other formats keep understandable text; the whole editor format is not decided here.
The summary sits at a fixed position at the top edge of the card and must not be pushed to the middle of the paper by
a centred layout. The strip a stack exposes shows the summary, while the body of a covered card is naturally hidden by
physical overlap.

## Formation command contract

### Commands and scope

| Command | May change | Does not change |
|---|---|---|
| Group stack | Position and base stacking order of the group's displayed cards; size only with permission | Group membership, other groups' cards, text |
| Group spread | Recalls the group's displayed cards and spreads them; size as above | Other groups' manual placement, content |
| Global formation | Arranges all participating cards by the chosen grid and group layout | Card membership, other devices' positions |
| Restore formation | Restores position, size and base stacking order from this layout transaction | Text, remote changes, deleted cards |

The participating set is decided by the display policy (see below). "Recall all" includes the group's cards that were
dragged into other regions; it does not make archived, deleted or explicitly hidden content, or completed cards this
device hides, reappear on the desktop.
A group formation takes its set by logical membership, not by where the cards physically are at the time.
Cards of other groups inside the group region must not be moved along when this group is arranged.

### One-off arrangement (U09)

1. Take this run's scope, the participating cards and the device geometry version, and build a preview/arrangement
   plan.
2. Compute positions, base stacking order and whether sizes must change first; cards do not move during this step.
3. Choosing a formation authorizes repositioning; size is controlled separately by the option in the next section.
4. A successful run is saved as one local layout transaction and creates one undoable operation.
5. A group formation makes that group the current group of attention and clears single-card temporary raises that
   would break a neat stack. Arranging does not open text editing by itself; if desktop operation was not activated,
   cards stay read-only and click-through on their resident system layer.
6. A global formation rebuilds the base stacking order of all participating cards and clears old temporary selection
   and cycling overrides. If a group operation is still in progress, only that scope's floating permission is kept,
   not selection overrides that break the new arrangement.
7. Afterwards there is no background layout guard; users can again drag, cycle or move cards to other groups freely.

The temporary group raise of a single-group formation only changes the relative order of notes. "Floating above
ordinary apps" is still decided by whether an operation scope is active; the two kinds of raise must not be merged
into one switch. If a card is being edited, its draft is reliably saved and editing ends before the formation is
committed; if saving fails, no draft is lost and nothing is rearranged.

### Stack, spread and capacity (U11, U13 + D)

- Stack: offsets papers in a stable order so that each paper's summary strip is not covered by the papers after it.
  For example, each card moves down by the summary strip height along y, and lower papers get successively higher base
  stacking order. With card height h and summary strip height p, a single stack of N cards is at least h + (N-1)×p
  tall. Implementations must use actual sizes and font measurements; these example sizes do not assume that all cards
  are the same size.
- Spread: lays papers out at their original size; participating cards do not overlap when they fit.
- D: first try a neat arrangement without resizing, splitting into several stacks or rows if needed; the existing stable
  order and IDs break ties. No randomness or device clock that makes the same input jump around.
- If scaling is needed, the formation preview explicitly shows "Allow resizing cards", off by default.
  Ticking it authorizes this plan only; it is not remembered as permanent consent, and the user is not asked once per
  moved card.
- Without permission to resize, sizes stay and cards may extend beyond their group region; the region is not a
  clipping container.
- Even with permission, resizing must keep readable text and operable sizes; it must not shrink fonts until the summary
  cannot be seen.
- If overflowing the region would cover another group, the preview points out the overflow; other groups are not
  rearranged behind the user's back.
- "Every card's first line is visible" is the completion condition for a stack formation that fits, not an invariant
  during free dragging or cycling.
- When even the whole visible desktop cannot fit the cards, the app must not claim that all cards are readable. It drops
  no cards, does not silently paginate or clip, and does not send cards to unreachable off-screen positions. It keeps
  the existing layout and raises the capacity problem; the concrete UX for very large capacity is in Q07.

### Undo (U15 + D)

Each formation is one undo unit and saves the participating card IDs, original positions, original sizes, base
stacking order and any needed grid mapping.
Size changes can be undone. Undo does not roll back text, shared membership or other devices' operations, and does not
revive deleted cards. Cards added later are not deleted; cards not in the snapshot stay as they are.
If cards on the same device were dragged after the formation, undo follows the local operation order; it must not
skip the intermediate actions and silently overwrite newer manual positions.
If the display environment has changed, the restored result is made reachable first, and the differences from the old
coordinates are reported afterwards.
If the card set or geometry changed after the formation preview, the preview is recomputed; a stale plan is not
committed.

## Visibility, system layer and input policy

### Independent dimensions

| Dimension | Meaning |
|---|---|
| Desktop display (master) | Whether desktop notes are shown at all; turning it off does not delete content |
| Per-card display set | Which cards take part in this device's desktop presentation |
| Completed cards | Whether this device's desktop presentation includes completed cards; on by default, kept per device, never synced |
| Resident system layer | Candidate capabilities such as Desktop, Wallpaper and resident floating; actual support must be reported per platform |
| Operation scope | Which group, or all, can be dragged temporarily and floats above ordinary apps |
| Read-only text selection | If offered, accepts mouse text selection without changing text; cannot be enabled together with full click-through |
| Single-card editing | Explicit text-editing state, with a local draft and source permission checks |

These dimensions do not require six toggles to sit permanently in one panel.
Keep the right responsibilities and state first, then design a clean settings page.
The full 1.0 UI for several per-card resident layers and read-only selection has not been confirmed item by item (see
Q03); do not assume that it is all removed or copied as is.

### Effective behaviour defaults (D)

- Deleted, archived or explicitly hidden cards, and completed cards while this device hides them, are not pinned back
  onto the desktop by a group shortcut.
- Completed cards stay on the desktop, marked as completed, until this device turns off showing completed cards. Then
  they leave this desktop as archived cards do: no formation, group key or adjust mode includes them, and they keep
  their placement for when they are shown again or marked To do. Turning the setting on or off records no shared
  revision, and resetting the desktop layout turns it back on.
- With desktop display off, explicitly calling up a group works as a temporary operation summon: only that group's
  cards that were eligible for the desktop are shown, and they are hidden again afterwards; the master switch is not
  turned on permanently. If the set is empty, a reachable management entry is offered instead of silently doing nothing.
- Scope=None: read-only by default, not draggable, no clicks, marquee selection or text selection; background sync does
  not steal focus.
- Scope=Group(A): A's participating cards temporarily float above ordinary apps and can be dragged; the effective
  policy of B and the other groups is unchanged.
- Scope=All: all participating cards can be dragged and float temporarily; focusing A only changes the stacking order
  and does not quietly narrow the scope to A.
- Editing(A1): only A1's text area enters editing; the other cards of the group do not become text-editable because of
  it.
- Temporary floating must not permanently rewrite per-card resident layers. On exit, behaviour is derived again from
  the current persisted settings; if the settings changed during the operation, an old snapshot does not overwrite
  them.
- For candidate cards set to resident floating, the layer and whether the text can be changed still stay separate;
  "on top means editable" does not apply.
- OS protected screens, the lock screen and other apps' special floating windows are outside the "above ordinary apps"
  guarantee. Normal apps, full screen, Spaces and similar capabilities are accepted separately; one mode must not
  silently stand in for all of them.

## Interaction state and transitions

The minimal state is operationScope, activeGroupId, selectedCardId, editingCardId and dragSession.
Each has a different role; a single globalUnlocked boolean does not decide display, editing and stacking order
together. activeGroupId can be set by read-only cycling; by itself it does not grant drag or edit permission.

| Event | Precondition | Result |
|---|---|---|
| ActivateGroup(A) | A exists and has presentable content | scope=A, activeGroup=A; selections outside A are cleared; A floats temporarily, without moving or resizing |
| ActivateAll | There is presentable content | scope=All; every group can be operated; no formation runs |
| Pressing the same scope shortcut again | No IME or child dialog is handling it | Safely ends editing and the operation, and restores the resident policy |
| Activating another scope | The current draft can be saved | Ends the old scope, then starts the new one; switches do not accumulate |
| Single click on a card | The card is in scope, no drag | Selects the card and its group and raises them temporarily; does not enter editing |
| Double click on a card | Editable, no drag or child-control gesture | Single-card editing; size unchanged |
| Edit button / keyboard entry | Same as above | The same command as a double click, with no different save semantics |
| Esc (while editing) | Not consumed first by the IME or a menu | Reliably keeps a changed draft locally (per U23), leaves editing, stays in that scope |
| Esc (while dragging) | A dragSession exists | Cancels this drag and group transfer and restores the starting geometry; does not leave the whole scope |
| Esc (scope only) | No inner operation | Ends the scope, keeping the moves and edits the user completed |
| Cycle next/previous | A group was explicitly chosen | All participating cards of the logical group cycle in stable order; only the temporary stacking order changes |
| App restart / sign-out | — | Operation scope, selection and highlight are not restored; persisted drafts and layout remain |

Esc does not discard a changed draft; only drafts with nothing to keep under U23 are removed when editing ends.
Handing editing to another editor (switching between the desktop editor and the main window, or opening the full
editor) is not an end; the draft continues. Chinese IME candidate confirmation, Esc/Enter during composition, and menus
and dialogs are handled by their controls first and must not be taken over by the desktop cycling or exit handlers.
Ordinary editing shortcuts and arrow keys go to the editor first while text is being edited; global left/right keys
must not take the text cursor away.
When saving fails, the editor and the draft stay so that the user can retry. Once the save succeeds locally, editing
can end without waiting for Google sync, but pending sync or conflicts must not be described as synced.
Only changes that affect layout integrity need dragging or editing to end first; not every background text update
takes over the operation.

Known draft edge cases from the 2026-10-06 review, not fixed: if the card changes while it is being edited (marked
complete, archived, moved or synced), an unchanged copy of the draft is kept as an old version; ending an edit through
`#afterTransfer` skips the draft-release hook; with the drafts list open, "Continue editing" fails with "draft not
found" when the desktop has removed that draft. On phones, whether a WebView double tap fires `dblclick` is unconfirmed
(2026-10-06).

### Relative stacking order rules

Within one effective system layer, from back to front: other groups in base stacking order → the active group's other
cards → the selected card.
Implementations can express this as a sort tuple; they must not keep increasing an integer z-index until it overflows,
and must not write the selection into shared data.
When the active group changes, the old group's temporary raise is removed; ending the operation or cycling can restore
the base order. A card being dragged stays visible until the gesture ends; it must not drop a layer while held because
of a group-transfer preview. Group cycling includes the group's cards that were dragged into other regions; their
physical position does not drop them from the cycle.
A highlighted candidate drop target does not thereby become the active group, become editable or take keyboard focus.
If cards have different fixed resident system layers, temporary floating presentation ensures the order inside the
active operated group. The full priority rules across system layers belong to Q03; it must not be claimed that every
OS offers the same window z-order.

## Dragging and group transfer

### Gesture classification (U19 + D)

| Action | Result |
|---|---|
| Ordinary drag to any reachable desktop position | Changes only the local position; the primary group is unchanged |
| Drag onto a drop label that has a group ID | Marks the candidate group; the transfer happens only on release |
| Shift-drag onto a region that has a group | The whole region becomes the drop target; the transfer happens only on release |
| Drag across an empty region or a group's ordinary area without Shift | Still an ordinary move; no guessing that the user wants a transfer |
| Card action "Move to group" | The same transfer command; needs no desktop gesture and does not move the card |

When a drag starts, recognizable and reachable group drop labels appear, not just tiny icons without text.
Only a valid transfer target shows the region highlight and the "Move to B" text; colour is not the only signal.
The highlight means that releasing will change membership; the same effect must not be used for merely passing over.
Group number slots, names and region positions can change, so the candidate target must hold the stable groupId.

### Operation life cycle

1. Pointer down records the cardId, the original groupId/revision, the original geometry, the grab offset and the
   pointerId.
2. Below a reasonable drag threshold it is still a click. The threshold is converted per platform and scale, not copied
   as a pixel value from an old application.
3. Once really dragging, take pointer tracking/capture; update the visual position and the candidate target without
   committing a group change.
4. The target is decided only by the current device's formation regions and drop labels, not by where other cards are
   scattered.
5. Pressing or releasing Shift during the drag switches target detection; every update refreshes the change hint at
   the same time.
6. Pointer up rechecks the last valid target, that the group exists, that the source is writable, and the expected
   revision.
7. An ordinary move commits local geometry. A valid transfer commits the primary group change and the drop position on
   the current device, keeps the content and the card identity, and records undo information; a target in the same
   group needs only a position operation.
8. "Moved to B · Undo" appears only after the local save succeeded safely; remote sync status is shown separately.
9. Release pointer tracking, clear the highlight, and derive operability and layer from the new membership and the
   current scope.

Groups must not be inferred through HTML native cross-app file drag and drop; this is a command inside the product.
The hint layer must not take events from the drag source; empty areas must not keep intercepting the desktop mouse
because of a transparent overlay.
After the movement has passed the drag threshold, mouseup/click/dblclick must not trigger text selection or editing.

### Cancellation, failure and changes mid-drag (D)

- Esc, pointer cancel or lost capture: cancel the uncommitted gesture, restore the starting position and membership,
  and clear the hints.
- Releasing while Shift is still held but with no valid drop region: cancel this transfer drag and restore the
  starting position. To keep an ordinary move, release Shift first so that the UI clearly returns to ordinary move mode.
- Moving off a label after its preview, without Shift: becomes an ordinary move again, and the highlight disappears at
  once.
- The target group is deleted or remapped before the drop: the card must not go to a new group in the same slot; cancel
  and explain.
- The same card is moved to another group by another device: keep both intents per the data conflict contract, do not
  pick a winner by clock, and do not overwrite newer text with the card snapshot taken during the drag.
- The local save fails: show no success and lose no content; cancel the change or leave a retryable state, and the card
  stays reachable.
- When only A can be operated and a card moves from A to B, after the completion hint the card leaves A's operation
  scope and returns to the resident policy; A's other cards stay in operation mode, and B is not summoned
  automatically.
- In All mode the card can still be operated after A→B; the dropped card becomes the selected card and B the active
  group, and the scope does not change.
- Undoing a transfer is a new conditional data operation; if a remote membership change happened since, it must not
  blindly change the card back to A.

## Editing, updates and initial placement

### Editing and dragging (D)

In drag mode the card surface handles moving; in text-editing mode the body area handles the cursor, selection and
input. While editing, moving uses an explicit handle; dragging to select text must not carry the whole card away.
Child controls such as links, buttons, checkboxes and text selection do not bubble the same gesture up into a drag or a
double-click edit. The full policy for quick checklist ticking awaits Q01; exceptions must not let read-only cards
change text. The draft is kept before leaving editing, switching groups, formation, hiding or switching accounts; a
failed local write to disk must be visible.
A locked desktop does not block updates from phones; a source's read-only permission must not be bypassed by
unlocking locally.

### New cards and sync (U14 + D)

- A card added in group A gets its initial position in A's region on the current device, not somewhere in the middle of
  the desktop.
- The same applies to cards added on phones or other devices; positions are assigned only to cards that have no local
  placement yet, and old cards are not rearranged.
- The initial position prefers free space in the group region. Without free space, overlap is allowed and the new card
  is indicated, without shrinking old cards, sending cards out of reach, or letting the new card take over the selected
  or editing card.
- Sync updates only shared data; longer content, a colour change, a card moving to another group or signing in again
  must not trigger a formation.
- A card that already has a local position keeps it when it moves from A to B; the next B formation recalls it into
  B's region.
- New cards that join the set during cycling do not take the selection; they are reachable later by navigating in
  stable order.
- When the selected card is deleted, its stable neighbour takes over; if it has an unsaved draft, the draft is kept as a
  recoverable draft first.
- Unknown groups or dependencies not yet downloaded keep their data and are clearly marked as waiting for sync; a
  missing file does not make the app change groups or delete anything on its own.

### Display changes (D)

Use logical coordinates and device display hints; do not mix the physical pixels, points and DIPs of different
platforms. Unplugging a display or shrinking the work area rescues only unreachable cards and keeps manual positions
that are still reachable; no global formation runs along with it.
Group regions always cover the work area of the current primary display, as when the grid is applied in Settings: they
update at start and on every display change, also when the work area grows; cards do not move because of this.
The browser preview uses its canvas as the work area and updates only after the size settles.
(2026-10-16: regions used to be reset only when the old regions lay completely outside the new work area, so the small
regions left behind when the built-in screen was briefly the primary display at sign-in never grew after the larger
display came back.)
Known issue (2026-10-16): restoring a backup's layout keeps the backup's grid area until the next start or display
change, and the restore uses `workAreas[0]`, which is not always the primary display.
Record the recovery reason. Cross-display drag and drop, mixed DPI and hot-plugging need separate acceptance; a
single-display result cannot be claimed as done.

## Architecture dependencies

The shared core must carry card and group commands, reliable drafts, conditional membership changes and sync; the
per-device LayoutStore/InteractionController carries geometry, formation, undo and operation state.
The renderer receives the common semantic model; platform hosts report their desktop layer, floating layer, input
region and shortcut capabilities. NoteSource and editing data must not be tied to the number of OS windows, and cards
must not each connect to Google on their own.
Concrete module boundaries, candidate composition surfaces and protocol limits are in
[ADR-007](../decisions/007-desktop-scene-and-platform-host.md) and the
[platform research](../research/2026-10-04-desktop-interaction-platform-feasibility.md).

## Acceptance cases

The table below is the acceptance contract to implement, not a list of passed tests. Current status is in
[PROGRESS](../../PROGRESS.md); history and verification evidence are in the git history and [testing](../testing.md).

| ID | Given / When | Required observable result |
|---|---|---|
| C01 | First use creates only one idea | No Project, machine or execution state is needed; it lands in the default group |
| C02 | Set 2 rows × 4 columns | Two rows, one above the other, with four regions each: eight regions |
| C03 | Choose 3 rows × 4 columns / nine groups on eight regions | The invalid layout is explicitly rejected; groups and layout stay unchanged |
| C04 | Seven groups on eight regions | The empty region stays; no eighth group is created |
| C05 | Rename a group and change its formation position | The existing shortcut still points to the same stable group |
| C06 | Ordinary drag of A1 into B's region | The position changes; membership stays A |
| C07 | A1 is in B's region; run A stack | A1 is recalled to A; B's cards do not move |
| C08 | A's region contains B1; run A spread | B1 is not moved along |
| C09 | Switch between stack and spread | Paper sizes are unchanged unless resizing was allowed for that run |
| C10 | Many cards, resizing not allowed | No shrinking; cards may extend past the group region; a capacity failure must not hide cards |
| C11 | Undo after allowing this formation to resize | Original positions, sizes and base stacking order return; text does not roll back |
| C12 | A stack completes and fits | Every card's first line is visible, not hidden by vertically centred text |
| C13 | Cycle to a card at the back after a stack | Card positions and sizes are completely unchanged; parts of some summaries may be covered |
| C14 | Operate A and select A2 | All A cards are above the other groups; A2 is frontmost in A |
| C15 | An A card was dragged far into another region; cycle A | It is still reached by cycling and is not recalled automatically |
| C16 | Activate single-group operation | Only the given group can be dragged and floats above ordinary apps; no formation ran |
| C17 | Activate All, then click A | All groups can still be operated; group A is raised relatively |
| C18 | Single click / double click on a card | The first selects, the second edits; paper size is unchanged |
| C19 | Tiny pointer jitter / release after a real drag | The first can count as a click; the second does not open the editor afterwards |
| C20 | Drag-select text / use the drag handle while editing | Text selection does not move the card; the handle does |
| C21 | Drag onto B's label, then off it | On entering, "Move to B" shows; leaving cancels the candidate, and nothing is written in advance |
| C22 | Shift + drag into B's region and release | That same card changes to B and keeps its drop position; no other card is rearranged |
| C23 | Drag into an empty region without Shift | Ordinary move; no group change and no new group |
| C24 | Shift + drop on an area with no target / Esc | The transfer is cancelled; the starting group and position are restored |
| C25 | Move A1 to B in single-group A mode | Completion hint; A1 returns to the resident policy; A's other cards remain operable; B is not summoned |
| C26 | Move A1 to B in All mode | Still operable; the scope stays All |
| C27 | Transfer from the action menu | The same data command; coordinates are kept; no mouse drag required |
| C28 | After target B was previewed, B is deleted / its position is taken by another group | No transfer to the wrong group; safe cancellation |
| C29 | Remote text edit / group change during a transfer | Text is not overwritten, and neither membership intent is silently dropped |
| C30 | Undoing a transfer when a newer change exists | Handled conditionally; the newer change is not blindly overwritten |
| C31 | A phone adds a card in A | The new card is in A's region, old cards do not move, the editor does not lose focus |
| C32 | A remote device moves a card that has a position to B | The local position stays; only a B formation recalls it |
| C33 | Leaving editing / switching groups while editing, and the disk save fails | Text and draft are kept, the failure is visible, no false report of a successful save |
| C34 | Esc handled during Chinese IME composition or candidate selection | Does not unexpectedly leave the whole operation mode |
| C35 | Ending the floating operation / app restart | Resident layer and click-through return; temporary focus and highlight are not restored |
| C36 | Background sync while typing continuously in another app | No automatic floating, focus change or rearrangement |
| C37 | Device A runs a formation while device B is online | B's local geometry is unchanged |
| C38 | Restack a group while B's cards cover the target region | Only A is arranged; A is raised relatively; B's coordinates are not changed behind the user's back |
| C39 | Remote text updates or deletions before and after undoing a formation | The updates remain; deleted cards are not revived |
| C40 | Operating only A, with other groups and the empty desktop | Not blocked by a full-screen transparent window intercepting input |
| C41 | Shortcut conflict or an unsupported Wayland backend | The app works, with status and an alternative entry; no false claim of successful registration |
| C42 | Arbitrary cycling of several cards in the same layer on labwc | Uses renderer-controlled stacking order; does not rely on an undefined native surface order |
| C43 | Unplug the external display | Only unreachable cards are rescued; no automatic global formation |
| C43b | The primary display's work area grows (for example only the external display remains after a closed laptop's built-in screen turns off) | Group regions cover the new primary display's work area; cards do not move |
| C44 | Concurrent creation produces more than nine groups | Data is kept in full, the user is told to tidy up, the extra groups are not deleted |
| C45 | Cards in local Deleted / hidden cards / completed cards this device hides meet a group summon | They are not permanently switched to desktop display |
| C46 | Change the resident layer of cards in the scope, then exit | The new persisted setting applies; the old snapshot is not written back |
| C47 | The highlight overlaps the dragged card / across renderers | The hint does not take capture; the drop runs the command only once |
| C48 | The file source or the renderer is replaced by a fake adapter | Group, position and interaction semantics hold; no coupling to Google or window handles |

## Open questions

The follow-up implementation conversation on 2026-10-04 settled the scope below, replacing the original unanswered Q
boundaries. The maintainer explicitly approved the full feature list and authorized settling the other details by best
practice; U01 to U22 need not be asked again.
Concrete local implementation decisions are in [ADR-008](../decisions/008-portable-interaction-core.md).

| ID | Original question | Decision in this round and required boundaries |
|---|---|---|
| Q01 | Editor content capabilities | Includes Markdown, checklists, attachments, complete/archive; one card per thing does not become a multi-issue container |
| Q02 | Backup/restore scope | Includes groups and per-device layout, automatic and encrypted backups, and import/merge/replace restores; revise the SPEC-002 format and safe preview |
| Q03 | Display, layers and text selection | Includes per-card display and resident layers and a read-only selection setting; capabilities must be reported per actual platform, and the everyday default stays click-through |
| Q04 | Platforms and distribution | This round includes Windows/macOS/Linux and native iOS/Android apps plus store submission preparation; minimum versions and backends are settled by implementation evidence |
| Q05 | Production runtime and sync | Technology choice is authorized; first adopt the ADR-008 shared core, while hosts and protocols must still be recorded and implemented; the prototype server is not released as 1.0 |
| Q06 | Group deletion and merging | Explicitly choose the destination group and preview the affected cards; no implicit card deletion, and concurrent conflicts create no orphans |
| Q07 | Capacity and long content | Reading and editing inside the paper can scroll, and the main window can search the full content; when desktop capacity is short, keep the existing layout and prompt the user to adjust the arrangement or manage the display set, without hiding cards |

## 2026-10-17 addendum: note formatting and attachments

The user approved six heading levels in CSS, code colouring, attachment thumbnails and opening attachments in the
default app on double click, and explicitly excluded toggling checklist items directly on the desktop.
Attachments on the Desktop and Top layers can be operated, while the Wallpaper layer stays click-through; attachment
actions do not trigger note dragging or text editing.
Only the main workspace can ask the native side to handle an attachment, based on the current attachment references;
what opens is a read-only copy, and external changes are not saved back automatically.
When the system preview fails, a file icon shows; an attachment not yet downloaded keeps a hint; remote images are not
loaded. Content, sync and backup stay at V1.
Concrete platforms, caching and the colouring budget are in [ADR-052](../decisions/052-rich-papers-and-native-attachments.md).
Current status is in [PROGRESS](../../PROGRESS.md); verification evidence is in the git history and
[testing](../testing.md).

## References

- [Source of the 2026-10-04 discussion and decisions](../research/2026-10-04-desktop-card-interaction-design.md)
- [Platform evidence and unverified scope](../research/2026-10-04-desktop-interaction-platform-feasibility.md)
- [Implementation order](../plans/003-desktop-interaction-implementation.md)
- [Handoff entry point and rules for obtaining the auxiliary reference](../handoff/2026-10-04-desktop-interaction-handoff.md)
