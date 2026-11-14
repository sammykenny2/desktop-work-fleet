# SPEC-007: Data compatibility and recoverable migrations

## Metadata

| Field | Value |
|---|---|
| Status | Approved policy, revised 2026-11-14; per-change implementation and acceptance required |
| Owner | Project maintainer |
| Reviewer | Independent review and installed-data acceptance per implementation |
| Decision | [ADR-073](../decisions/073-alpha-data-compatibility-and-migrations.md) |
| Related Plan | [PLAN-007](../plans/007-schema-evolution-and-migrations.md) |

## Summary

As alpha testing approaches, protect installed user/tester data and supported backups. Schema increases are allowed
when needed. Compatible optional additions can keep their version with safe absence behavior and lossless prior-data
round trips. This supersedes the V1-only testing policy; historical incompatible formats are not claimed migrated.

## Requirements

| ID | Requirement |
|---|---|
| FR01 | Classify each persisted change for installed-data, backup and cloud mixed-client compatibility; declare affected formats and supported source/target versions. |
| FR02 | Compatible additions define absence/default behavior and preserve content and supported extension fields on load/save. Cover prior-format open/edit/reopen and backup round trips without a reset. |
| FR03 | Incompatible changes version the affected discriminator and supply deterministic validated conversion before enabling the new writer. Unknown future versions remain refused without mutation. |
| FR04 | Preserve ownership, identities, history, unsaved changes, attachments and pending intent. Any intentionally lossy transform needs separate explicit consent. |
| FR05 | Migrations commit atomically or stage a validated generation before pointer activation. Failure, full disk, uncertain acknowledgment, interruption and restart preserve a recoverable original and permit idempotent retry. |
| FR06 | Backup conversion leaves the original ZIP intact, validates references/checksums and honors existing restore preview/identity mapping. Declare supported import and downgrade boundaries. |
| FR07 | Cloud protocol changes specify mixed-client/minimum-writer behavior, safe pause/rejoin and recovery; never rewrite immutable history or silently reset Google data. |
| FR08 | Data versions are independent of application release versions; exact application target-version and publication approval still apply. |
| FR09 | Each change includes compatibility fixtures, relevant failure/restart coverage and recovery documentation. Clean-install/build success alone is not migration acceptance. |

## Acceptance

| Case | Required evidence |
|---|---|
| M01 | Prior supported installed state opens, edits, saves and reopens without losing content, identities, unsaved changes or pending intent. |
| M02 | Supported old ZIP imports through validation/preview without modifying original bytes or unrelated profiles. |
| M03 | Interrupt incompatible migrations at every durable boundary; restart reaches the recoverable original or fully validated new state, never a partial acknowledged state. |
| M04 | Unsupported/malformed/future data is refused without a destructive write or cloud upload. |
| M05 | Mixed supported cloud clients cannot silently lose pending work or overwrite incompatible protocol data. |
| M06 | Compatible optional fields demonstrate absence fallback and retention without an unnecessary upgrade transaction. |

## Current boundary

`core/schema.js` owns current constants; this policy neither changes them nor installs a universal migration runner.
Historical dataset/whole-workspace incompatibilities keep their documented recovery limits until a conversion is
implemented and accepted. Native SQLite table versions and application package versions remain distinct.

## References

- [ADR-073](../decisions/073-alpha-data-compatibility-and-migrations.md),
  [ADR-051: superseded policy](../decisions/051-schema-evolution-and-atomic-migrations.md).
- [SPEC-002](002-portable-backup-and-restore.md), [PLAN-007](../plans/007-schema-evolution-and-migrations.md).
