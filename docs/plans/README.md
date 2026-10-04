# Implementation Plans

> This directory contains implementation plans that define *how* to build features.

Current interaction plan: [PLAN-003](003-desktop-interaction-implementation.md), based on SPEC-003.
The [Google Drive plan](002-google-drive-notes-mvp.md) supplies source/backup integration work,
with editor and backup scope reconciliation before contract freeze.
The [macOS validation handoff](001-validation-version-macos-handoff.md) remains a historical prototype handoff.
The new plan is a Draft, not an implemented feature or accepted framework decision.
Execution status remains in [PROGRESS.md](../../PROGRESS.md).

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
3. Implement → Update progress
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
| [003-desktop-interaction-implementation](003-desktop-interaction-implementation.md) | Cards, groups, formation, renderer and native hosts | Planned; product implementation not started | [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md) |
| [000-template](./000-template.md) | Template | - | - |
| [001-validation-version-macos-handoff](001-validation-version-macos-handoff.md) | macOS validation handoff | Validation version implemented; platform matrix incomplete | [SPEC-001](../specs/001-validation-version.md) |
| [002-google-drive-notes-mvp](002-google-drive-notes-mvp.md) | Google Drive notes with portable backup | Draft | [SPEC-002](../specs/002-portable-backup-and-restore.md) |
<!-- Add new plans above this line -->

## For AI Agents

1. **Link to spec**: Always reference the related SPEC document
2. **Update progress**: Mark tasks complete as you work
3. **Log updates**: Add entries to the Progress Log section

---

*See also: [specs/](../specs/) for feature specifications*
