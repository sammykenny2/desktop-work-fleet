# Feature Specifications

> This directory contains feature specifications that define *what* to build and *why*.

Current behavior contract: [SPEC-003](003-desktop-cards-groups-and-formation.md).
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
| [004-revision-graph-and-file-sync](004-revision-graph-and-file-sync.md) | Immutable revisions and file sync | Accepted technical contract; execution in PROGRESS | [PLAN-002](../plans/002-google-drive-notes-mvp.md) |
| [003-desktop-cards-groups-and-formation](003-desktop-cards-groups-and-formation.md) | Cards, groups, formation and desktop interaction | Confirmed U / delegated D / answered Q; execution in PROGRESS | [PLAN-003](../plans/003-desktop-interaction-implementation.md) |
| [002-portable-backup-and-restore](002-portable-backup-and-restore.md) | Portable backup proposal | Draft / scope and group schema revision required | [PLAN-002](../plans/002-google-drive-notes-mvp.md) |
| [000-template](./000-template.md) | Template | - | - |
| [001-validation-version](001-validation-version.md) | Backlog 驗證版 | Implemented with validation limits | [macOS handoff](../plans/001-validation-version-macos-handoff.md) |

目前新增規格：[SPEC-002 可攜備份與安全還原](002-portable-backup-and-restore.md)（Draft）；
相關 [PLAN-002](../plans/002-google-drive-notes-mvp.md)，執行狀態見根目錄 PROGRESS.md。

## For AI Agents

1. **Before implementing**: Create spec for complex features
2. **Respect authorization**: Follow existing user authorization and U/D contracts; resolve affected Q items before dependent implementation, without reopening confirmed choices
3. **Link to plan**: Reference the related PLAN document when created

---

*See also: [plans/](../plans/) for implementation plans*
