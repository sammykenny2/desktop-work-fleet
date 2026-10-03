# Implementation Plans

> This directory contains implementation plans that define *how* to build features.

Current handoff: [macOS validation version](001-validation-version-macos-handoff.md).
This handoff records the authorized goal, execution order and evidence requirements;
it is not an accepted framework decision or a completed product specification.
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
| [000-template](./000-template.md) | Template | - | - |
| [001-validation-version-macos-handoff](001-validation-version-macos-handoff.md) | macOS validation handoff | Validation version implemented; platform matrix incomplete | [SPEC-001](../specs/001-validation-version.md) |
<!-- Add new plans above this line -->

## For AI Agents

1. **Link to spec**: Always reference the related SPEC document
2. **Update progress**: Mark tasks complete as you work
3. **Log updates**: Add entries to the Progress Log section

---

*See also: [specs/](../specs/) for feature specifications*
