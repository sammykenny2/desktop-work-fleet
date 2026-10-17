# Desktop cards, groups and formation: how the requirements evolved, and the handoff basis

- Compiled: 2026-10-04, Asia/Taipei.
- Basis: this product discussion and the explicit follow-up answers given the same day; the user's intent needs no
  endorsement from external products.
- Nature: preserves how the discussion evolved; the development contract starts at
  [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md).
- Decision: [ADR-006](../decisions/006-card-group-and-formation-semantics.md).
- This round was documentation only; no product code was changed, no Google OAuth was created and the paused goal was
  not resumed.

## 1. Product focus and corrections to the earlier plan

The user records a backlog with desktop notes: what is still unhandled right now, and where to jot an idea down
quickly when it appears.
Several development machines and CLI agents are background context; they do not imply a product that must manage
agent jobs/runs.
The user used lightweight management tools such as Trello and Linear as points of comparison, and did not thereby
accept a full PM model.

The directions of Google accounts, file sources, no local server in the first version and the source/renderer
abstraction remain.
Drive appDataFolder is the research baseline; the existing data format and backup design are still Proposed/Draft.
The earlier cuts around plain text, checklists, attachments, plugins and backup/restore modes were never adequately
confirmed; having been written in a document does not promote them to user decisions.

The reference app has feature experience worth keeping, and parts the user explicitly does not want:

| Kind | Intent this time |
|---|---|
| Desktop display, layering, interaction, text selection, cross-platform experience | Capability inventory and targeted research; not copying its UI or code |
| Focus/Pomodoro timer, reviews | Not added to our own 1.0 |
| Cluttered settings pages and too many tool areas | Not an interface template; design a clean layout of our own |
| Future PM capabilities | Keep researching suitable models/tools; do not force them into the first version |

## 2. What a card is

The earliest idea was at least one note per machine, holding many things to do.
The user then corrected this with the intuition of physical post-its and a board: one note records one thing.
So the old architecture's Note = container of several tasks is not the current 1.0 contract.

"One thing" is how the user organizes content. It does not require the system to split cards with NLP,
and it does not forbid a card from holding a description, steps or a checklist; it must not be misread as "a single
line of text only".
The completion/status UI still has to be confirmed together with the editor scope; it must not quietly return to a
complex six-state execution flow.

## 3. Groups and the local view

The user wants to see cards by "what belongs to me". On machine A, the set related to A can stand out;
on machine B, a different set can stand out. A group is a general logical set, not the machine identity itself.
It may later change to other grouping criteria; repository, Agent, team or Project are not hardcoded as required group
types.

A card belonging to several machines at once is not ruled out, but need not be in the first version.
"Several machines see the same card" and "one card has multiple memberships" are not the same requirement.
The working default is one primary group first, without turning that default into a data format that cannot be
extended.

## 4. From the accordion mock-up to physical paper

Mock-ups were shown of cards that grow taller when expanded one by one or as a whole group. The user pointed out
explicitly: a physical post-it keeps a stable size; what differs is which paper covers which and which parts show on
top.
The following options are therefore void:

- expanding a card into a taller card;
- a whole-group accordion;
- changing the paper size during cycling to show content;
- treating the fixed pixel sizes of the mock-up as a product requirement.

A size exception was added later: when necessary, a formation may ask for/obtain consent to resize cards,
and without consent the cards may extend beyond the group region. This does not bring back the accordion; other
ordinary interactions still do not change paper size.

## 5. A region is an arrangement target, not a container

The user wants cards tidy, and also wants to drag them freely to other regions.
The two coexist through explicit formation:

| Action | Effect on position/membership |
|---|---|
| Ordinary drag of an A card into region B | Changes the local position; the card stays in A |
| Formation of group A | Every participating, displayed A card returns to region A, including cards scattered elsewhere |
| A B card sits in region A | Formation of A does not move B |
| Global formation | Arranges every participating card once, by the current grid/group mapping |
| Free dragging after a formation | Allowed; cards are not continually pulled back |

A stack within a group shows each card's first line; a spread lays out the full papers.
Pressing formation is the user's authorization for automatic placement; there is no need to ask again for each card
moved.
Resizing must still be stated explicitly in that run's options; the position authorization cannot be stretched into
unlimited scaling.

## 6. Final clarification of cycling and z-order

The user proposed: while group A is being operated, the whole of A sits above the other groups; whichever card the
cycling reaches comes to the front of A.
Cards may keep their manual positions. It was later confirmed that formation restores the tidy first-line view;
cycling is not required to show every summary at all times.

Ideas superseded by this include: moving papers during cycling, leaving group cycling once a card is dragged apart,
or fixed coordinates combined with arbitrary reordering while still promising that every first line is always visible.

Two kinds of layering must be kept apart:

- Relative card order: the current group above other groups, the selected card above the rest of its group.
- Operating-system layer: once an operation starts, the chosen group temporarily floats above ordinary apps, and
  returns to its resident layer when it ends.

The last point was open; in this round the user explicitly chose: float temporarily above ordinary apps, restore at
the end.
This does not require covering the lock screen, protected system UI or every kind of special floating window.

## 7. Operating modes and gestures

The user pointed out that the reference app's desktop display/global operation/read-only text selection, plus per-card
display/layering, are different dimensions.
A single whole-desktop unlock switch cannot replace all of these capabilities.
The new approach starts dragging for a chosen group, then selects a single card to edit; the other groups stay as they
are.

The user left it to our judgment whether to offer an all-groups entry; considering new users, the plan keeps one.
There is only one operating scope at a time; the active group in All mode is only the focus of attention and does not
narrow the operable set.
Shortcut numbers point to groups stably; a first-time user can use a single group without being made to understand a
nine-group layout.

Defaults explicitly confirmed the same day:

- A single click selects and raises the card; only a double click enters text editing.
- An ordinary drag only moves the card.
- Dragging onto a group's drop label, or dragging into a group's region with Shift held, changes the group on release.
- The card actions still offer "Move to group".

The highlight during a drag must mean a valid group-change target, paired with the group name/"Move to B" text.
Merely passing over a region must not light up in the same state and make the user think the membership has changed.
D boundaries such as cancel, lost capture, failed saves and concurrent remote group changes are written in SPEC-003
and must not be implemented by guessing.

## 8. Group count and arrangement syntax

The user specified at most nine groups, n×m with n≤3 and m≤4, explicitly excluding 3×4.
The example 2×4 is two rows, one above the other, of four blocks each; 3×3 is allowed.
The user has no preference between rows first or columns first, so the working default is rows×columns, with a
pictured preview.

Checking only the two single-side limits must not accidentally allow twelve regions.
Fewer groups than cells may leave cells empty; groups beyond the grid capacity are not merged/deleted automatically.
A group can hold many cards; nine groups is not a limit of nine cards.

## 9. Boundaries the user delegated to our planning

The user explicitly answered the size exception, new cards landing in their own region and formation being undoable,
and authorized planning the remaining details by best practice. The items below are therefore recorded as D, without
claiming each one is the user's own words:

- per-machine geometry kept separate, focus transient;
- reliable drafts, layered Esc handling, group-change undo and conditional saves;
- new cards do not rearrange old cards or take editor focus;
- a card with an existing position keeps that position after a remote group change, and is recalled only by the next
  formation;
- a disconnected display rescues only unreachable cards;
- hidden/deleted content is not permanently pinned back to the desktop by group shortcuts;
- creating more than nine groups concurrently keeps the data instead of discarding it;
- reliable local saving and cloud sync are reported separately.

These rules let agents develop; asking about each item again must not block authorized work.
If a real platform conflict appears or the product scope needs to grow, bring the concrete impact to the user for a
decision.

## 10. Platforms and the weight of the evidence

This review supports an implementation path on Windows, public AppKit and the currently recorded labwc/Wayland.
That does not mean the new group change/highlight/group cycling has been tested on three platforms, nor that every
Linux supports the same desktop layers.
The undefined order of surfaces within a layer affects the renderer choice; see the
[platform research](2026-10-04-desktop-interaction-platform-feasibility.md).

The user asked to get the design right first, rather than making a repeat of the exploratory Mac probe the next step.
Regression after the real feature is implemented must still list evidence on the actual platforms and packaging;
existing evidence must not be passed off as the new feature passing.

## 11. How the auxiliary reference material is handed over

This repo does not record the name, remote URL or absolute machine path of that reference checkout.
It is called the "auxiliary desktop-interaction reference project"; when deeper reading is needed, ask the maintainer
for its current location.
Comparisons are limited to behavior, native platform limits and past failure causes; its UI, data format and
architecture are not ported.
This repo's user decisions take precedence over the external project's features and AGENTS.
How to obtain it, the license check and the scope of work that may continue are in the
[handoff document](../handoff/2026-10-04-desktop-interaction-handoff.md).

## 12. Requirements still to decide

Editor content capabilities, the complete backup strategy, per-card layering/read-only text selection UI, the order of
platform releases, group deletion and very-large-capacity UX still have Qs; see the Open questions in SPEC-003.
They cannot in turn overturn the free placement, explicit formation or group-change gestures confirmed today.
