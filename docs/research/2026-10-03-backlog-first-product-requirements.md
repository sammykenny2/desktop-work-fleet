# Backlog-first product requirements and how the discussion evolved

> 2026-10-04 validity update: this document is kept as historical research; it is not the current 1.0 interaction contract.
> The user has since moved to one card per thing, general-purpose groups, explicit formation and temporary z-order;
> the old Note container, per-item task model or other candidate UX must not override
> [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md).
> The reasons for the change are in [the same-day summary](2026-10-04-desktop-card-interaction-design.md).

- Date: 2026-10-03
- Project: desktop-work-fleet
- Nature: requirements research and handoff; not a finished product specification.
- Basis: this session's user requirements and later clarifications. This document needs no third-party product to prove the user's intent.

## 1. Latest requirements first

The primary user treats notes as a backlog: seeing what is still unhandled, and quickly recording an idea in the right place when it comes. Several development machines and several CLI agents are the context of use; agent scheduling, execution monitoring and complex states are not the current product centre.

Product job statement:

> Work notes synced across devices, so the user can quickly record ideas, organize to-dos and keep seeing what is still unfinished. Default operations stay simple; different views can be switched on later as needed.

This statement organizes the user's intent; the note editor, data model and information architecture still need to be validated with prototypes.

## 2. Requirements the user has stated explicitly

| ID | Requirement | Qualification and interpretation |
|---|---|---|
| U-01 | Quickly record things that come to mind | Needs a correct place that is easy to find again; no tedious fields to fill before recording |
| U-02 | Mainly see unhandled items | Notes are a daily backlog; the home screen is not agent execution history |
| U-03 | Basic project management | Originally Todo, In Progress, Done; no further states requested |
| U-04 | Share content across several personal development machines | Initially each machine maps to at least one note, and every machine can show all notes |
| U-05 | Recognize the current machine's content | Colour can highlight notes related to this machine; colour is not the only possible approach |
| U-06 | Desktop is read-only and click-through by default | Clicks, drags, desktop marquee selection and keyboard input must not operate a note by mistake |
| U-07 | Occasional in-place editing | Deliberately unlock, edit, lock again; the entry point and failure handling still need validation |
| U-08 | Editable elsewhere too | A desktop app, web app or phone can all serve as editing entry points |
| U-09 | Cross-device sync and conflict handling | Server or file based is acceptable, but data must never be lost silently |
| U-10 | Convenient phone pairing for a local server | If that architecture is chosen, QR code pairing is wanted |
| U-11 | Own iOS, macOS and Android apps in the stores | The browser can be used for research and prototypes; it does not cancel the Apple/Google store goal |
| U-12 | No Windows signing certificate purchase yet | Evaluate the Microsoft Store; the specific packaging and desktop features need validation |
| U-13 | Linux capabilities must match what can be tested | GitHub Releases is a distribution candidate; no full support matrix is chosen yet |
| U-14 | Redesign from a new repo | Avoid bringing in an existing application's architecture, UI, assets and large amounts of code |
| U-15 | Keep view flexibility for different users | A simple default and later extension both matter; this does not mean building a large PM system now |
| U-16 | Repo name | desktop-work-fleet, lowercase with hyphens |

The user accepts that the new project may use suitable open-source components; this does not mean any external dependency has had a license inventory or selection approval.

## 3. How the discussion evolved and what still applies

| Stage | What was discussed | Current validity |
|---|---|---|
| Desktop sticky notes | One or more notes per machine, all machines shown together | Kept as the main usage scenario |
| Separate data and renderer | Task data editable in several clients; the desktop is only one entry point | Reasonable candidate architecture; no framework or data service chosen |
| Mainstream PM comparison | Models such as Project, Issue, Environment, Agent, Run | Research material; cannot be taken wholesale as approved requirements |
| Agent execution workbench | States such as queued, running, waiting for input, succeeded, failed | The user said this is too complex; not in the first version's default |
| Backlog first | See unfinished items, quickly record ideas, keep view flexibility | The latest product centre |
| Independent bootstrap | New directory and independent research documents | Authorized for this session; product implementation was not authorized along with it |

Earlier suggestions to make "Needs me" the home screen, or to adopt GitHub Projects first, did not become decisions; any selection should be re-weighed by the burden it places on quick capture and backlog review.

## 4. Candidate daily experience

The following are research suggestions, to be confirmed with low-cost prototypes:

1. On opening, see familiar notes, each with a clear name.
2. Write a sentence directly at the end of an existing note.
3. When something cannot be classified right away, put it in an inbox and move it later.
4. An idea can start as text and become a to-do when it needs tracking.
5. By default see unfinished items; tick an item off when done and it collapses, and it can be restored if needed.
6. "In progress" is a simple marker; not every piece of work is forced through every stage.
7. A board, a list and a kanban board can present the same work data.
8. After recording on the phone, the desktop shows the new content later without stealing focus from the app in use.

The inbox, collapsing after completion and turning text into a to-do are candidate UX, not a specification the user confirmed item by item.

## 5. Where simple defaults end and flexibility begins

The first version avoids making any of these required: owner, agent, machine, repository, worktree, date, priority, estimate and acceptance criteria.

Underneath, independent item IDs, completion state and view settings can be kept. They need not appear as a form burden when creating a task. A later extension with tags or a kanban board should not require users to re-create their existing data.

One note can have its own fixed content; another kind of note might be a saved filter result. How the two coexist is an open question to validate; all notes cannot simply be restricted to database queries.

## 6. Meaning of the display mode

"Locked" is first defined as a client mode that prevents accidental operation, separate from permission control or a cross-device write lock.

- A locked desktop still receives content updates from other devices.
- The phone does not need to unlock the desktop remotely before editing the same data.
- For notes that cannot be clicked, a reachable unlock entry point is needed in the menu bar, tray or editing window.
- If saving fails after unlocking, keep the draft and say so clearly; locking again must not hide the failure.
- Phones and browsers do not need to imitate the desktop's click-through mode.

## 7. Still to be confirmed (not blocking this documentation bootstrap)

- Is a note free-form layout, a list of blocks, or a mix of both?
- Must work belong to a project? Where do ideas without a project go?
- When the same item appears in several notes, how does the user understand it is the same record?
- Must editing work offline, or does the first version support offline reading and draft saving first?
- With many notes, how is "understandable at a glance" density kept?
- Backend deployment preference: self-hosted, a managed service, or files only?
- How does the phone reach the data once it leaves the local network?

## 8. Candidate acceptance scenarios

- When the destination is known, add an idea in one sentence without being interrupted by other fields.
- An idea without a destination can still be saved first, then found and organized later.
- Returning to the work environment, the user can quickly see unfinished items.
- After ticking an item done, the same item updates consistently on other devices.
- When two devices edit the same content, the user's draft does not disappear.
- The desktop display does not interfere with existing clicks, drags, marquee selection and keyboard input.
- A person who only records a backlog never sees an agent execution state machine.

Related research: [mainstream experience and models](2026-10-03-lightweight-project-management-and-view-model.md), [data source and sync](2026-10-03-source-of-truth-sync-and-conflict-analysis.md).
