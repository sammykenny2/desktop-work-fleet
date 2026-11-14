# Feature Specifications

> This directory contains feature specifications that define *what* to build and *why*.

Current behavior contract: [SPEC-003](003-desktop-cards-groups-and-formation.md).
Alpha data policy: [SPEC-007](007-schema-evolution-and-migrations.md). Preserve installed data/backups; version incompatible formats with recoverable migrations when needed.
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
| [014-desktop-note-stacking](014-desktop-note-stacking.md) | Persistent desktop note/group stacking through ordinary interaction | Draft; design only, implementation not started | [PLAN-015](../plans/015-desktop-note-stacking.md) |
| [013-product-identity-and-distribution](013-product-identity-and-distribution.md) | Final identity, safe cutover, Release artifacts and beta feedback | Approved requirements; implementation pending | [PLAN-014](../plans/014-product-identity-and-distribution.md) |
| [011-efficient-idle-sync](011-efficient-idle-sync.md) | Efficient idle checks with existing dataset and record formats | Approved for implementation; native/provider proof and review pending | [PLAN-012](../plans/012-efficient-idle-sync.md) |
| [012-cloud-and-local-notes](012-cloud-and-local-notes.md) | Cloud and local notes side by side, moves across, chosen regions, Trash and search | Approved; implementation in progress |
| [010-dataset-checkpoints-and-deletable-history](010-dataset-checkpoints-and-deletable-history.md) | Dataset checkpoints, manual note purge and explicit reset/recovery | Approved for implementation; remote proof gates remain | [PLAN-011](../plans/011-dataset-checkpoints-and-deletable-history.md) |
| [009-desktop-presentation-lifecycle](009-desktop-presentation-lifecycle.md) | Desktop presentation availability and recovery | Draft; implementation approval pending | [PLAN-009](../plans/009-desktop-presentation-lifecycle.md) |
| [008-workspace-initialization](008-workspace-initialization.md) | Workspace initialization and proof of reset completion | Approved; status in PROGRESS | [PLAN-008](../plans/008-workspace-initialization.md) |
| [007-schema-evolution-and-migrations](007-schema-evolution-and-migrations.md) | Data compatibility and recoverable migrations | Approved alpha policy, 2026-11-14; per-change evidence required | [PLAN-007](../plans/007-schema-evolution-and-migrations.md) |
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
