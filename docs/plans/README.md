# Implementation Plans

> This directory contains implementation plans that define *how* to build features.

Current interaction plan: [PLAN-003](003-desktop-interaction-implementation.md), based on SPEC-003.
The schema-upgrade work in [PLAN-007](007-schema-evolution-and-migrations.md) was withdrawn; pre-store testing changes V1 directly.
The [Google Drive plan](002-google-drive-notes-mvp.md) supplies source/backup integration work,
with editor and backup scope reconciliation before contract freeze; it is not an accepted framework decision.
The [macOS validation handoff](001-validation-version-macos-handoff.md) remains a historical prototype handoff.

A plan's Status field and its task checkboxes (or phase status lines) are updated in the same commit as the work they
describe. The Progress Log section holds only dated plan-level milestones; per-change history is the git history,
verification procedures and unverified boundaries are in [testing](../testing.md), and the current project snapshot is
in [PROGRESS.md](../../PROGRESS.md).

## Purpose

Implementation plans break down approved specifications into actionable tasks. They help:

- Coordinate work across multiple developers/agents
- Track progress through implementation phases
- Document technical decisions made during development

## When to Create a Plan

Create a plan when:

- A specification (SPEC) has been approved
- The feature requires multiple implementation phases
- Work needs to be coordinated across multiple contributors

## Workflow

```
1. Spec approved → Create plan
2. Break into phases → Define tasks
3. Implement → Update Status and tasks in the same commit
4. Complete → Mark as done
```

## Naming Convention

```
PLAN-NNN-short-title.md

Examples:
PLAN-001-user-authentication.md
PLAN-002-api-rate-limiting.md
PLAN-003-database-migration.md
```

## Template

Use [000-template.md](./000-template.md) as the starting point for new plans.

## Index

| Plan | Title | Status | Related Spec |
|------|-------|--------|--------------|
| [010-unsaved-changes](010-unsaved-changes.md) | Unsaved changes instead of drafts | Completed, 2026-11-01; Windows and real desktop hosts not verified | [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md), [ADR-061](../decisions/061-unsaved-changes-instead-of-drafts.md) |
| [009-desktop-presentation-lifecycle](009-desktop-presentation-lifecycle.md) | Nonvisual core, presentation isolation and native lifecycle recovery | Draft; implementation not started or approved | [SPEC-009](../specs/009-desktop-presentation-lifecycle.md) |
| [008-workspace-initialization](008-workspace-initialization.md) | Workspace initialization and resumable reset | Completed, 2026-10-17; real Google and native apps not verified | [SPEC-008](../specs/008-workspace-initialization.md) |
| [004-windows-11-compatibility](004-windows-11-compatibility.md) | 23H2 native baseline, minimal fixes and Windows 11 package floor | In Progress: Phases 1–2 done, Phase 3 partly done, Phase 4 not started | [SPEC-005](../specs/005-windows-11-compatibility.md) |
| [003-desktop-interaction-implementation](003-desktop-interaction-implementation.md) | Cards, groups, formation, renderer and native hosts | In Progress; slice status in the plan | [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md) |
| [005-msix-data-and-cloud-overwrite](005-msix-data-and-cloud-overwrite.md) | MSIX private data and a safe, resumable full Google overwrite | Completed, 2026-10-12; real-environment verification open | [SPEC-002](../specs/002-portable-backup-and-restore.md) |
| [000-template](./000-template.md) | Template | - | - |
| [001-validation-version-macos-handoff](001-validation-version-macos-handoff.md) | macOS validation handoff | Validation version implemented; platform matrix incomplete | [SPEC-001](../specs/001-validation-version.md) |
| [002-google-drive-notes-mvp](002-google-drive-notes-mvp.md) | Google Drive notes with portable backup | In Progress under the full 1.0 authorization | [SPEC-002](../specs/002-portable-backup-and-restore.md) |
| [006-desktop-window-startup-and-updates](006-desktop-window-startup-and-updates.md) | Main window placement, startup behaviour and in-app updates on three platforms | In Progress: Phases 0–6 implemented, Phase 7 not recorded | [SPEC-006](../specs/006-desktop-window-startup-and-updates.md) |
| [007-schema-evolution-and-migrations](007-schema-evolution-and-migrations.md) | Schema upgrade plan withdrawn | Cancelled, 2026-10-17 | [SPEC-007](../specs/007-schema-evolution-and-migrations.md) |
<!-- Add new plans above this line -->

## For AI Agents

1. **Link to spec**: Always reference the related SPEC document
2. **Update status**: Tick tasks and update the Status field in the same commit as the work
3. **Log milestones**: Add dated plan-level milestones to the Progress Log section; do not copy per-commit history there

---

*See also: [specs/](../specs/) for feature specifications*
