# 2026-10-04 Desktop Interaction Development Handoff

## How to use this document

Later on 2026-10-04: full 1.0 implementation and per-slice commit/push were authorized.
The Q01–Q07 answers and working defaults are updated in SPEC-003, including native iOS / Android apps and store preparation.
First read the current status in PROGRESS and the slice status in PLAN-003; do not treat this document's original "documentation only" scope as a ban on implementation.

This handoff lets later agents develop to the same behaviour without the full chat history.
This round only organized documents; whether product implementation starts depends on the current user task.
If the user has told you to start implementing, finish the work within the U / D scope and do not ask about all requirements again just because the documents mark a few Qs.
Without authorization, do not buy certificates, set up accounts, submit to stores or resume the previously paused goal on the user's behalf.

## Required reading order

1. The root [AGENTS](../../AGENTS.md) and your own agent file.
2. [PROGRESS](../../PROGRESS.md): the current status snapshot; history is in the git history.
3. [Requirements entry](../requirements.md).
4. [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md): U / D / Q, state transitions, 48 acceptance cases.
5. [ADR-006](../decisions/006-card-group-and-formation-semantics.md) and
   [ADR-007](../decisions/007-desktop-scene-and-platform-host.md).
6. [PLAN-003](../plans/003-desktop-interaction-implementation.md) and the
   [platform research](../research/2026-10-04-desktop-interaction-platform-feasibility.md).
7. To trace intent, read the [discussion history](../research/2026-10-04-desktop-card-interaction-design.md).
8. For Google / backup work, read the current contracts in SPEC-004 / ADR-012 and SPEC-002 / ADR-013; the construction order is in PLAN-002.
   ADR-004 / 005 remain as historical background; the early exclusion lists do not apply.

## Core that must not drift

- One card per thing; the first version centres on backlog / idea capture and does not force a PM / agent execution workflow.
- A group is a general collection, and the local "mine" is a viewpoint; it is not a machine-specific data model.
- At most nine groups; rows × columns with rows ≤ 3, columns ≤ 4 and product ≤ 9; 2×4 / 3×3 are allowed, 3×4 is not.
- Ordinary dragging changes only position; crossing regions does not change the group. A group region is not a hard container / clipping boundary.
- Cycling changes only the temporary z-order; the current group rises as a whole and the selected card comes to the front within the group, without moving positions.
- Only formation does batch arrangement; it recalls the scattered cards of one group; Stack shows the first line, Spread lays out whole papers.
- Selection or editing never changes paper size in normal use; formation may adjust it only with explicit consent, and without consent cards may overflow the group region.
- A new card starts in its own group region without rearranging other cards; formation has Undo.
- Operating a chosen group / All first enters drag mode; single click selects, double click edits, and the default normal state is read-only and click-through.
- The group being operated temporarily floats above normal apps and returns to its resident layer on exit; this is answered and is not asked again.
- Only the group drop labels / Shift + region drop change the group, committed on release; the card action can still change the group.
- Shared content / membership are separate from per-machine position / size; there is no cross-device unlock lock.
- Windows/macOS/Linux must stay; the iOS/macOS/Android first-party app store targets stay.
- Do not add Focus / Pomodoro / review features, and do not copy the reference app's UI.

## Auxiliary desktop-interaction reference project

The maintainer has a separate desktop sticky-note reference project that can be consulted for platform-specific implementation experience and past failure causes.
To keep this repo portable and independent, it does not record that project's checkout name, remote URL or absolute machine path.
Do not guess a sibling directory, search the whole home / disk, or clone something with a similar name.

When you need deeper native layering, click-through, pointer coordinate or shortcut behaviour, first ask:

> Please give me the current readable location of the "auxiliary desktop-interaction reference project". I will consult it for platform behaviour and known issues and implement this product independently.

This obtains missing reference information; it is not a new request to approve confirmed features.
If the user already gave the correct location in this round, do not ask again; if the location is unreadable, report the specific gap.
While waiting, continue with this repo's model, formation, interaction contracts, documentation and pure-logic tests.
If no external implementation is needed at all, follow this repo's specifications directly and do not make the lookup a prerequisite for every task.

Order of consultation once available:

1. The source's license, any local reading rules and its document index.
2. The precedence of display / global operations / text selection / per-card layering and the related frontend and backend decisions.
3. Past issue records directly related to the current change; for Linux, especially the 2026-10-02 / 03 layer-shell series.
4. The minimum source code for the matching platform and drag entry, to check whether the reports still reflect the implementation.

Borrow only behaviour, constraints and test scenarios; do not bulk copy product code, UI, assets, data contracts or build identity.
The external project's feature list / AGENTS do not become requirements of this product and cannot override the user's decisions.
Never commit this product's work to the external reference repo or its upstream.
If third-party code genuinely has to be adopted, first make an explicit source and license judgment and keep a real notice;
the neutral name only avoids path coupling and must not hide a required attribution.

## Common misreadings and corrections

| Misreading | Correct behaviour |
|---|---|
| Each machine has one note listing many separate tasks | One card per thing; cards form groups |
| "Expanding" means making cards taller | It changes arrangement and overlap; paper size normally stays the same |
| Dragging into region B makes it B | An ordinary drag still belongs to A; only an explicit drop label / Shift or the action changes it |
| Cycling must rearrange positions to keep the first line visible | Cycling changes only z; formation restores the neat first-line view |
| Starting an operation unlocks all text at once | Drag mode first, then edit one card |
| Clicking A in all-groups mode shrinks to a single group | All stays operable; the active group is only a temporary ordering focus |
| A transparent overlay window naturally passes everything through | It needs evidence of the platform input policy and must not block the empty desktop |
| On Wayland, one window per card can be raised freely | Surface order within one layer is undefined; the renderer needs a controllable order |
| A successful basic Mac probe means the store launch is done | New interaction, sync, packaging and store each have their own acceptance |
| An early Draft said no-checklist, so it can be removed | The user questioned that scope; confirm it through the SPEC-003 Qs |
| Nothing can be done while the reference repo name is unknown | Ask for the specific location and keep doing independent contract work |

## What to report when starting

After receiving an implementation task, first report briefly: which commands / C cases you will complete, which unsettled Qs they depend on,
which platform / runtime you use, and whether the external reference location is really needed.
Do not replace the existing architecture and product work with "need to check again whether the Mac can do it".
Ask only about Qs that really block the current feature, and keep finishing authorized work that does not depend on the answers.

On delivery, distinguish item by item what is implemented, tested, untested and unsupported on the platform; include the specific versions and test methods.
Record status as the repository rules require (the commit body, the owning ADR / SPEC / PLAN, and PROGRESS when project-level status changes), update the related decisions / requirements, and do not claim an author's own check as an independent review.
As the user authorized, this repo commits and pushes directly to origin/main; do not create feature branches / PRs, and do not force push.
