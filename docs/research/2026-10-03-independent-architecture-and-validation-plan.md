# Independent architecture direction and staged validation research

- Date: 2026-10-03
- Status: candidate architecture and follow-up work suggestions; this session's authorized scope is only the new repo bootstrap and research documents.
- Decided: the name desktop-work-fleet, independent development, backlog/quick capture first.
- Not decided: programming language, UI framework, data service, sync method, formal repository subdirectories and minimum platform versions.

## 1. Boundaries of the new project

The new repo exists so that the product concept and architecture start from the current requirements. The historical project's window labels, event names, plug-in mechanism, notes JSON, scheduler and UI structure are not compatibility requirements for this project.

The only scaffold source for this session is the minimal preset of the maintainer's project skeleton template. It provides collaboration and documentation conventions, not a product runtime, and does not mean A2A, MCP or multi-agent scheduling has been adopted.

"Independent implementation" is not a claim of clean-room isolation in the legal sense; this session consulted public documentation and earlier technical observations, and brought in no substantial source content from other applications.

## 2. Candidate division of responsibilities

| Part | Responsible for | Choices it need not be tied to |
|---|---|---|
| Work content | Notes, text, to-dos and completion state | Desktop window APIs |
| Storage and sync | Revisions, drafts, conflicts, backups, device authorization | A particular note layout |
| Views | Filtering, grouping, sorting and collapsing | One copy of the data per screen |
| Clients | Quick capture, editing, reading and sync indicators | A single UI framework everywhere |
| Platform display | Desktop layer, input click-through, focus and device layout | Project or agent lifecycle |
| Optional integrations | External PM, code links or agent reports | Having to exist in the first version |

This division is a research suggestion. Early on it can live in one simple program; there is no need to split it into several services or packages right away.

## 3. Order of framework selection

First confirm the essential experience and platform limits, then choose a framework:

1. Whether the user can record and review the backlog smoothly.
2. Whether data is saved reliably under failures and multi-device races.
3. The minimum desktop display capability with macOS public APIs/sandbox.
4. Windows packaging and desktop interaction, and the testable Linux scope.
5. The editing and pairing experience of native mobile store clients.
6. Only then compare Tauri, native AppKit/SwiftUI, other cross-platform frameworks or hybrid approaches.

An AppKit probe does not decide native UI for every platform; a browser prototype does not decide that the production app is only a website container.

## 4. Proposed validation batches

### V-01: capture and review prototype

Use a simple web or other low-cost prototype to test a few real notes, quick add, complete, restore and an optional in-progress marker.

Acceptance focus: recording works without classifying first, recording is direct when the destination is known, and unfinished items can be found the next day. No agent sessions, scheduling or large sets of PM fields yet.

### V-02: data and conflict spike

Test two clients on the same prototype data, covering concurrent edits, offline, delete, retry and save failure. Compare at least one service-based candidate; if the file-based approach is still attractive, compare it with the same test set.

The output is selection evidence and failure behaviour, not just proof that "the data synced once".

### V-03: macOS public API spike

Implement a minimal AppKit/sandbox display in a separate experimental area of this repo. Use solid-colour cards and test receiving updates, read-only display, mouse click-through and keeping focus.

Record above-desktop-icons and below-desktop-icons separately. The full scenarios are in the [macOS research](2026-10-03-macos-public-api-desktop-feasibility.md).

V-01 and V-03 can proceed separately; which is implemented first is decided by the next development task. This session started no implementation on the user's behalf.

### V-04: vertical slice on the chosen stack

After selection, connect: add an item on the phone or web → write to the authoritative data → desktop receives it → user ticks it done → other devices update.

Validate save failure and draft retention at the same time, before extending appearance and advanced organizing features.

### V-05: release path validation

Prepare Apple sandbox/signing, Android AAB/testing conditions, Windows MSIX and one concrete Linux combination separately.

Record install, update and removal; the store accepting the package and the special desktop capabilities passing are two separate results.

## 5. Explicitly deferred at this stage

- Automatic agent dispatch, remote shell, execution management and dashboard state machines.
- Real-time multi-user cursors, full rich-text co-editing.
- Downloading arbitrary plug-ins or scripts.
- Full two-way sync with several PM providers.
- Full Jira/ClickUp-style workflow configuration and reports.
- Supporting every Linux distro/compositor at once.
- Moving over UI/code/assets of unconfirmed origin.

Deferred does not mean permanently forbidden; before adding any of these, there should be a clear use case and an independent evaluation.

## 6. Main open questions

| Question | Evidence suggested to answer it |
|---|---|
| Relationship between free notes and to-dos | V-01 input and organizing operations |
| Whether fixed notes and filtered notes coexist | V-01 understandability |
| Self-hosted or file-based authoritative source | V-02 cost and reliability |
| Whether full offline editing is required | Real mobile situations and V-02 |
| Whether to adopt a particular cross-platform framework | V-03 and the per-platform slices |
| Whether Windows can meet the goal without buying a certificate | V-05 MSIX and desktop tests |
| Initial Linux support scope | Real tests on available hardware and compositors |
| Whether an external PM service is needed | Evaluated by backlog UX, not presumed necessary |

## 7. Maintaining documents and evidence

- User requirements: [backlog research](2026-10-03-backlog-first-product-requirements.md).
- Accepted project boundaries: [ADR-001](../decisions/001-independent-backlog-first-foundation.md).
- Current status: [PROGRESS.md](../../PROGRESS.md) at the repository root; history and verification evidence are in the git history and [testing.md](../testing.md).
- Further research: keep it in docs/research, named YYYY-MM-DD-topic.md.
- Research marks source dates and fact/inference/candidate/verified; a candidate suggestion must never be promoted to a user decision.
- After platform and sync probes complete, add their results and limits; do not rewrite earlier unverified history as verified.

## 8. Source of this bootstrap

- Source: the maintainer's project skeleton template (not public).
- Source version: a7438cf81d44519db89d2783dc14b7cfc9e0e851.
- Skill: skills/bootstrap-project/SKILL.md.
- Generator: scripts/windows/Initialize-Project.ps1.
- Selection: Preset minimal, base only, no extra flavor.
- No application dependencies were installed, no services were started and nothing was published to a store.
- Creating the GitHub remote and remote repo is not part of this local bootstrap.

The source is recorded in the [third-party notices](../../THIRD-PARTY-NOTICES.md). The verification scope and actual commands of this session are as stated in [testing.md](../testing.md).
