# PLAN-003: Implementation Handoff for Cards, Groups and Cross-Platform Desktop Interaction

## Metadata

| Field | Value |
|---|---|
| Status | In Progress; slice status as of 2026-10-17 is in the Progress log |
| Owner | Project maintainer |
| Assigned To | Unassigned |
| Reviewer | An independent review is arranged at implementation delivery; this round had none |
| Date | 2026-10-04 |

## Related Spec

[SPEC-003](../specs/003-desktop-cards-groups-and-formation.md) is the authority for behaviour and the C01–C57 acceptance cases.
[ADR-006](../decisions/006-card-group-and-formation-semantics.md) accepts the product semantics the user confirmed;
[ADR-007](../decisions/007-desktop-scene-and-platform-host.md) is still a presentation architecture proposal.
[ADR-008](../decisions/008-portable-interaction-core.md) accepts the shared semantic core; later conversations approved the full editor / backup / per-card settings scope, native apps on five platforms and store preparation.
The status of the 1.0 execution slices is kept in this plan's Progress log and updated in the same commit as the work;
the current project status is in [PROGRESS](../../PROGRESS.md).

## Overview

2026-10-05 Windows wallpaper layer addition: following [ADR-030](../decisions/030-windows-explorer-wallpaper-layer.md),
separate the Explorer icon host and wallpaper host and build three-layer scenes, update pass-through and capability reporting,
then verify with shared policy tests, real attachment / pixel probes and the main-window layer switching flow before repackaging.
Verification evidence is in the git history and [testing](../testing.md).

On the same day, [ADR-031](../decisions/031-macos-and-linux-wallpaper-scenes.md) added the macOS below-icons scene and
the Linux BACKGROUND layer, building on the Pi / labwc results already reviewed, and fixed GTK pass-through, size requests and redraws.
Native tests are recorded separately for Windows, an isolated Linux compositor and the scope that still needs the Mac SDK, with no combined pass claim.

First complete one card per thing, groups / per-machine layout, formation and interaction commands,
then make the same behaviour pass the real integration with each platform host and Google sync.
The plan must not be reduced to "do plain-text CRUD first and add groups / desktop interaction later".
Likewise, technical uncertainty is no reason to implement a full server / PM model first or start another Mac exploration project.

This plan adds the interaction, group and platform work to [PLAN-002](002-google-drive-notes-mvp.md);
Google OAuth / conflicts / backup still need their own formal contracts, and the old scope cuts no longer apply automatically.

## Implementation phases

### Phase 1: Requirements handoff and contracts; first remove ambiguities that would change the data model

Read the handoff documents, SPEC-003, ADR-006 / 007 and the platform research.
U and D can be developed as documented; ask about a Q only before starting work that depends on it.
Do not ask again about the topmost layer and gestures the user already accepted, and do not turn authorization to organize documents into store submission or changes to the user's desktop settings.

Deliverables:

- Typed contracts for Card, Group, SourceRef, DeviceLayout, FormationPlan and InteractionState.
- The boundary between "one card per thing" and checklist sub-steps; do not build a note container for several issues first.
- Commands and error types for MoveCardToGroup, MoveCard, ApplyFormation, UndoLayout, ActivateScope, CycleCard and
  BeginEdit / EndEdit.
- The source / version / reference strategy for shared group metadata, and lossless handling of more than nine concurrent groups.
- A clear distinction between content revision, device layout revision and the current drag/session ID.
- A comparison of formal runtime / renderer/host candidates: store, licenses, controllable stacking order, input region, reliable local saving.

Exit: at least every SPEC-003 invariant maps to a model or command;
do not assemble the logic only from native window APIs that cannot be tested apart from the platform.
If an external implementation is needed for reference, first ask the maintainer for its location as the handoff rules say; do not search the whole disk.

### Phase 2: Local core, formation and a reproducible interaction model

First build shared fixtures with an in-memory/fake source and isolated data; do not touch a real Google account.

Deliverables:

- Stable group IDs, a single primary group, the nine-group limit and full grid validation.
- Ordinary dragging that does not change membership; Group / All scope separate from the active group.
- A comparator of stable base order + temporary z-order; cycling does not change geometry.
- FormationPlanner: immutable input, no direct writes to native windows, output of positions, base stacking order, resize requests, overflow.
- Separate consent for position and size, atomic local layout transactions and undo.
- Initial cards only place themselves; remote content and group changes do not trigger background formation.
- Input state cleanup, double-click / drag thresholds, Esc / IME boundaries and a safe exit for drafts.

Exit: the simulatable parts of C01–C15, C17, C21–C30, C31–C39 and C44 have reproducible expected results.
This completes the logic tests, not native layering or pass-through.

### Phase 3: Shared interaction scene and a usable editor interface

Deliverables:

- A clean normal view / operating view; handles, drop labels and states appear only during operation or dragging.
- Group labels and Shift region drop targets, candidate hints with colour plus text, feedback for cancel / done / undo.
- The same MoveCardToGroup command for card actions; the normal app / phone entry does not depend on desktop geometry.
- Single click selects a card, double click edits, plus reachable keyboard / menu entries; the text area and drag handle do not compete for the same event.
- Device-local highlighting, group counts, grid preview and capacity hints.
- Recoverable UI for draft write failures, read-only sources and sync conflicts.

Exit: verify C06–C13, C18–C30 and C33–C34 with an operable view;
keep render screenshots / operation records and mark the difference between the normal app / browser and the real desktop host.
Do not rebuild the rejected accordion, and do not move settings pages over from external projects.
New capabilities of the content editor follow the Q01 confirmation; a complete plain-text product does not replace an undecided content contract.

### Phase 4: Formal vertical slices on the three target desktop hosts

Windows, macOS and Linux each connect the same semantic fixtures; they may go in batches by available machines, but no platform target is dropped.
The Mac already has public-API host experience, so the old exploratory probe does not need to be redone first.

| Platform work | Delivered evidence |
|---|---|
| Windows host | Normal layer / chosen group floats up / restored on exit, drag and drop, hints that do not block the desktop, DPI and capture cleanup |
| macOS host | Public API + Sandbox, above normal apps, drag to change group / edit, return to the original layer and focus |
| labwc / Wayland host | layer-shell capability, renderer-managed stacking within one layer, input region / configure / redraw, alternative shortcut entry |
| Common to all platforms | Real desktop evidence for C16, C35, C36, C40–C43 and C46–C47 |

Evidence must record the OS/build, compositor (Linux), CPU, number of displays / scaling, backend / packaging and test method.
Distinguish pass, fail, not-run and unsupported item by item; a successful API call is not a pass of the user's screen.
When multiple displays need extra equipment, record them as untested; finish the shared single-display behaviour first and do not pretend completion without the equipment.
Do not change TCC, global shortcuts, compositor settings or restart the user's desktop session without permission.

Exit: the full path normal → group operation → cycling → change group → edit → back to pass-through,
and the cancel / save failure / focus loss behaviour, can be reproduced in the environments claimed as supported.
Do not claim that all GNOME / X11 / other Wayland desktops support the same native presentation path.

### Phase 5: Google, multiple clients and backup integration

Implement according to PLAN-002's source and sync contracts; do not make the prototype Python server a permanent 1.0 dependency.
Groups and card content must sync; per-machine layout and interaction scope do not leak to other machines.

Deliverables:

- The same cardId and groupId on two clients with different DeviceLayouts; formation on A does not move B's layout.
- Remote additions land in the local group region without rearranging old cards; a remote group change for a card that already has a position does not recall it automatically.
- Conflict preservation and retry deduplication when a group change runs concurrently with a text edit / deletion / group deletion.
- Device sign-out / account switching clears temporary operations and isolates drafts, layout and background responses.
- The backup schema revision includes groups / references and the confirmed content capabilities; after Q02 is confirmed, decide the layout and restore modes.
  The old SPEC-002 draft without groupId / group data must not be frozen as is.

Exit: the real-integration parts of C29–C39, C44 and C48 have evidence;
a mock/fake source is not passed off as successful Google access with cross-platform client IDs.

### Phase 6: Release and handoff material

- Deliver Windows/macOS/Linux at the confirmed version cadence, keeping the Apple / Google first-party app targets.
- This round also delivers native iOS / Android apps and store submission preparation, reusing the shared data commands; desktop gestures do not replace the phone UX.
- List licenses / transitive dependencies, signing and store configuration for the actual packages; do not infer from the original repo's MIT that all dependencies can be used directly.
- The final operating documentation must match the shortcut registration results, the Linux backend and the available layers.
- Keep the evidence mapping for C01–C57 and the known limits; update the slice status in this plan, and PROGRESS when project-level status changes.
- Store approval, real cross-device sync and native desktop behaviour each have their own bar and do not substitute for one another.

## Files to create or modify

These are suggested logical locations; actual file names / languages follow the runtime decision, and no claim is made that these modules exist:

| Logical scope | Deliverables |
|---|---|
| contracts/cards, groups, layout, interaction | typed schema, commands, capabilities, fixture |
| src/core | shared card/group, drafts, conditional transfer, outbox |
| src/layout | formation planner, device layout store, undo |
| src/interaction | scope/focus, gesture lifecycle, selection/edit policy |
| src/renderers | common scene, card/editor presentation, target highlights |
| src/platforms | Win/macOS/Linux host, keyboard / pointer / monitor adapters |
| src/sources | Drive/file source, group metadata, future source interface |
| tests | semantic / fault / renderer / native integration acceptance |
| docs | Decisions, user operation, evidence, licenses and release status |

The directory examples are no reason to create many empty classes / bridges first or to let each card start its own sync.
The existing prototype and reports stay; a source migration needs an explicit conversion plan and must not erase its known Windows restore issue.

## Testing strategy

| Layer | Behaviour that must really be verified |
|---|---|
| Model / commands | Grid boundaries, membership unchanged by moves, temporary z does not pollute base, data and layout do not leak across machines |
| Planner | All participating cards kept, size authorization, summaries visible when they fit, stable recomputation, undo |
| Faults / concurrency | Draft failure, cancel, interrupted capture, deleted target, concurrent group changes for the same card, lost response to a group change |
| Interaction view | click/drag/dblclick, Shift switching, label targets, text selection and IME, consistent highlight state |
| Native host | Actual layering, desktop pass-through, focus and re-layering, scaling and display recovery |
| Source | Real Google, multi-account isolation, different client IDs, backup round trip |

Do not rerun the full product probe suite for a documentation change; this round only checks document links, UTF-8/LF, the diff and semantic consistency.
For formal behaviour changes, choose the matching regressions; do not replace user outcomes with tests that mirror implementation details.

## Risks and mitigations

| Risk | Must handle |
|---|---|
| A Q is silently narrowed to the old MVP | Decide explicitly before implementing the related capability; do not ask again about confirmed U |
| Native window z-order is not portable | Controllable scene / composited surface; do not rely on the undefined same-layer order on Wayland |
| A surface that is too large blocks the desktop | Input region / split-surface strategy and real desktop acceptance |
| Highlight and actual commit disagree | The same target resolver, revalidation on pointer-up, stable groupId |
| A group change overwrites the remote body | Minimal command + revision guard, keeping both sides' intent |
| Formation quietly moves other machines / groups | Scope snapshot and per-machine transactions, C07 / C08 / C37 |
| Size changes use a permanent consent covertly | Preview option for this run and undo; keep the size when not allowed |
| Location of the original reference unknown | Ask the maintainer, keep working on this repo's contracts and tests, no whole-disk search |

## Progress log

2026-10-04: detailed handoff plan created.

1.0 execution slices, status as of 2026-10-17:

| Slice | Scope | Status |
|---|---|---|
| 1 | Shared Card/Group, formation, layout/undo, interaction, atomic commands | Done; independent review findings fixed and rechecked |
| 2 | Formal local storage, shared renderer, Markdown/checklists/attachments, complete/archive, full settings | Shared UI and IndexedDB done; Windows SQLite/DPAPI, macOS Keychain/SQLite and Linux SQLite with the local key are in daily use; Android and iOS storage start on devices, with no full device acceptance |
| 3 | Drive revision graph, OAuth, outbox, conflicts, account isolation | Done in shared code and all five hosts; Windows real sign-in and Drive upload verified; Windows, macOS and Linux used with one real account; phones not verified |
| 4 | Manual, automatic and encrypted backups with groups/layout/attachments; import/merge/replace restores | Shared code and Windows native done; Android SAF, Apple bookmark and Linux native folders implemented but not run on real devices |
| 5 | Windows/macOS/Linux native hosts, layering/pass-through/shortcuts/displays | Implemented, built in CI or release workflows and used on real machines; the full OS matrix (versions, multi-display, IME, sleep) is missing. Quick move (C49–C57, 2026-10-24) is in the shared code and the three hosts but has not been used on a real machine |
| 6 | iOS/Android native apps, files/OAuth/sharing/life cycle | Android APK runs on a Pixel 9 Pro; iOS development build runs on an iPhone 16 Plus; Google and full operation not verified |
| 7 | Installers, signing and store submission preparation, license inventory, final 1.0 acceptance | Windows MSIX, Linux DEB and macOS notarized DMG come from manual workflows; phone APK/IPA workflows exist but have not been dispatched; release AAB, App Store archive, screenshots, final SDK license inventory and submissions are missing |

Slices may interleave according to their dependencies; this does not reduce the delivery scope.
Update this table in the same commit as the work it describes; history and verification evidence are in the git history and
[testing](../testing.md).
