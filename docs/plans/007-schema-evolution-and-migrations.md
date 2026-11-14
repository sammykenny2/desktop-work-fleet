# PLAN-007: Preserve data through format changes

## Metadata

| Field | Value |
|---|---|
| Status | Approved ongoing change gates, revised 2026-11-14; no universal migration runner implemented |
| Owner | Project maintainer |
| Reviewer | Independent review and installed-data acceptance per change |

## Related Spec

[SPEC-007](../specs/007-schema-evolution-and-migrations.md),
[ADR-073](../decisions/073-alpha-data-compatibility-and-migrations.md).

## Overview

The 2026-10-17 withdrawal is historical. The prohibition on schema increases and deferral until store planning are
superseded. Apply these gates to every format-affecting implementation. Add reusable migration machinery when a
concrete incompatible change needs it; compatible optional fields need evidence rather than a universal runner.

## Per-change gates

- [ ] Inventory affected installed formats, backup readers/writers, native storage and cloud clients.
- [ ] Record compatibility, supported sources/targets and upgrade/downgrade boundaries in the owning ADR/spec.
- [ ] For an additive change, test absence/default behavior and lossless prior-format open/save/reopen and ZIP restore.
- [ ] For an incompatible change, version and validate conversion; use atomic/staged activation and a recoverable
  original, with interruption, uncertain receipt, storage-full and retry coverage.
- [ ] Preserve ownership, identities, unsaved changes, history, attachments and pending sync; refuse future formats
  without mutation and define mixed-client behavior where relevant.
- [ ] Update recovery guides/fixtures with implementation; distinguish model, durable-store and installed-host
  acceptance, and report independent review availability.

These reusable gates do not claim completed work or create a competing feature task list. Track actual feature
completion in its plan, including [PLAN-015](015-desktop-note-stacking.md) for compatible desktop stacking labels.

## Historical boundary

The withdrawn V1-to-V2 runner and copy/API work are not restored by the policy alone. Current constants remain V1
until a concrete change needs another version; exact application release-version approval remains separate.
