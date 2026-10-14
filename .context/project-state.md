# Project State

Updated: 2026-10-04.

## Current focus

The current delivery is a documentation handoff for one-card-one-thing desktop notes,
logical groups, explicit formations, and group-scoped interaction. No product code
or external account was changed in this documentation task. The earlier validation goal remains paused.

Read docs/handoff/2026-10-04-desktop-interaction-handoff.md, requirements.md, and
SPEC-003 before planning implementation. ADR-006 accepts confirmed product semantics;
SPEC-003 labels confirmed requirements U, delegated working defaults D, and unresolved scope Q.
The user explicitly confirmed temporary floating above ordinary apps and the gesture defaults:
single-click selects, double-click edits, ordinary dragging only moves, dropping on a group label
or Shift-dragging into its region changes membership. Do not ask those again.

Groups are generic, not machines. Up to nine groups; rows 1..3, columns 1..4,
product <= 9; 2x4 and 3x3 valid, 3x4 invalid. Regions are arrangement targets, not containers.
Cycling changes temporary z-order only. Formation explicitly recalls/repositions the selected scope,
resizes only with consent, permits region overflow without that consent, and supports undo.
Cards created locally or remotely start in their group's region without moving existing cards.
Shared card/group data, per-device geometry, and ephemeral interaction state are separate.

Windows/macOS/Linux are required desktop targets; retain the Apple/Google app-store goals.
No focus timer or retrospective features. The first release uses Google-hosted files without
a local note server. Drive appDataFolder is a planning baseline, not a completed integration.
Editor/checklist/attachment scope, backup/restore options, detailed layer/selection settings,
release sequencing, runtime/sync format and large-capacity UX remain explicit Q items.
Earlier plaintext-only/no-checklist/no-layout-backup/import-only cuts were not approved.

ADR-007 proposes renderer-managed card ordering and platform hosts. Wayland layer-shell
does not guarantee ordering among independent surfaces in the same layer; do not assume
one native window per card. Cross-platform APIs and external reports are not new-product test passes.

A separate desktop-interaction reference project may be useful. Do not guess its location,
scan the user's filesystem, or hardcode its name/path. Ask the maintainer for the current readable
location when native implementation investigation actually requires it, and continue independent work.
Use it for behavior and failure analysis, not code/UI/assets/schema copying. Real reused code
would still require explicit provenance and license records.

ADR-002 still documents the implemented 0.1.0 prototype: Swift/AppKit/WebKit,
ES modules and Python/SQLite. It has not become the Drive or grouped desktop product.
ADR-003 and the full PM/server blueprint remain Deferred; the old Note-container model
does not override the new one-card-one-thing contract.

## Entry points

- PROGRESS.md: authoritative execution status.
- docs/handoff/2026-10-04-desktop-interaction-handoff.md: agent handoff and reference-location policy.
- docs/specs/003-desktop-cards-groups-and-formation.md: behavior and C01-C48 acceptance cases.
- docs/decisions/006-card-group-and-formation-semantics.md: accepted semantics.
- docs/decisions/007-desktop-scene-and-platform-host.md: proposed implementation boundaries.
- docs/plans/003-desktop-interaction-implementation.md: implementation sequence.
- docs/research/2026-10-04-desktop-interaction-platform-feasibility.md: platform evidence and limits.
- docs/plans/002-google-drive-notes-mvp.md: source/backup plan requiring scope reconciliation.
- docs/specs/002-portable-backup-and-restore.md: backup proposal requiring group/schema updates.
- docs/validation/2026-10-03-validation-report.md: historical Mac evidence, not new feature acceptance.

## Workflow

No Conductor is assigned. Follow the authorized user task. Direct commit/push to origin/main
is authorized; no feature branches, PRs or force pushes. Preserve unrelated changes.
