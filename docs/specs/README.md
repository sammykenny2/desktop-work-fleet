# Feature Specifications

> This directory contains feature specifications that define *what* to build and *why*.

Current behavior contract: [SPEC-003](003-desktop-cards-groups-and-formation.md).
Pre-store data policy: [SPEC-007](007-schema-evolution-and-migrations.md). All current JSON formats remain V1; upgrades are deferred to store-launch planning.
Confirmed U requirements and delegated D defaults are actionable when implementation is authorized;
ask only the Q items needed for the current work. Earlier backup/editor cuts are not approved.

## Purpose

Specifications define requirements before implementation begins. They help:

- Clarify what needs to be built
- Get stakeholder approval before coding
- Prevent scope creep during implementation
- Ensure AI agents understand requirements fully

## When to Create a Spec

Create a spec when:

- Adding a new feature with multiple components
- Making changes that affect multiple files or systems
- The feature requires user/stakeholder approval
- Requirements need to be documented for future reference

## Workflow

```
1. Identify need → Create spec
2. Define requirements → Get approval
3. Create plan → Implement
4. Mark as implemented
```

## Naming Convention

```
SPEC-NNN-short-title.md

Examples:
SPEC-001-user-registration.md
SPEC-002-payment-integration.md
SPEC-003-notification-system.md
```

## Template

Use [000-template.md](./000-template.md) as the starting point for new specs.

## Index

| Spec | Title | Status | Related Plan |
|------|-------|--------|--------------|
| [008-workspace-initialization](008-workspace-initialization.md) | Workspace initialization and proof of reset completion | Approved; status in PROGRESS | [PLAN-008](../plans/008-workspace-initialization.md) |
| [006-desktop-window-startup-and-updates](006-desktop-window-startup-and-updates.md) | Main window placement, startup behaviour and in-app updates | Approved; Q pending; status in PROGRESS | [PLAN-006](../plans/006-desktop-window-startup-and-updates.md) |
| [005-windows-11-compatibility](005-windows-11-compatibility.md) | Windows 11 new/classic shell and install eligibility | Approved requirements; status in PROGRESS, evidence in the git history | [PLAN-004](../plans/004-windows-11-compatibility.md) |
| [004-revision-graph-and-file-sync](004-revision-graph-and-file-sync.md) | Immutable revisions and file sync | Accepted technical contract; status in PROGRESS | [PLAN-002](../plans/002-google-drive-notes-mvp.md) |
| [003-desktop-cards-groups-and-formation](003-desktop-cards-groups-and-formation.md) | Cards, groups, formation and desktop interaction | Confirmed U / delegated D / answered Q; status in PROGRESS | [PLAN-003](../plans/003-desktop-interaction-implementation.md) |
| [002-portable-backup-and-restore](002-portable-backup-and-restore.md) | Complete portable backup and restore | Accepted technical contract; status in PROGRESS | [PLAN-002](../plans/002-google-drive-notes-mvp.md) |
| [000-template](./000-template.md) | Template | - | - |
| [001-validation-version](001-validation-version.md) | Backlog validation version | Implemented with validation limits | [macOS handoff](../plans/001-validation-version-macos-handoff.md) |

Complete backup contract: [SPEC-002 Portable backup and safe restore](002-portable-backup-and-restore.md);
related [PLAN-002](../plans/002-google-drive-notes-mvp.md).
Current status of all specs is in the root [PROGRESS.md](../../PROGRESS.md); history and verification evidence are in
the git history and [testing](../testing.md).

## For AI Agents

1. **Before implementing**: Create spec for complex features
2. **Respect authorization**: Follow existing user authorization and U/D contracts; resolve affected Q items before dependent implementation, without reopening confirmed choices
3. **Link to plan**: Reference the related PLAN document when created

---

*See also: [plans/](../plans/) for implementation plans*
