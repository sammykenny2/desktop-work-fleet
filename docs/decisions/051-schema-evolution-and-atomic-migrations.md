# ADR-051: Formats stay at V1 during the pre-store testing phase

## Status

Accepted, revised 2026-10-17. The maintainer asked to withdraw this round's V1→V2 bump and automatic migration; this
revision supersedes the version-bump decision made earlier the same day.

## Context

Nobody else is testing the app yet, and building version-by-version upgrades, copies and compatibility upkeep for test
formats that have never been delivered adds development load.
The maintainer confirmed that V1 is adjusted directly for now, and that a version bump will be evaluated when listing on
the Windows Store, Apple App Store and Google Play is planned.

## Decision

- The current JSON schemas of Workspace, Layout, shared revisions, Drive metadata, backup/encrypted envelopes and the
  automatic backup journal all stay at V1.
- The shared version constants and basic format validation stay; new or changed fields update the current V1 contract
  and its tests directly.
- Withdrawn from this round: the version-by-version runner, the Workspace.open upgrade barrier, migration copies, the
  extra IndexedDB store, the native migration capability/API and the dedicated acceptance scripts.
- Ordinary CAS transactions, drafts, immutable history, attachments, account isolation and the existing ZIP backups
  stay; user data is neither reset nor cleaned up.
- Existing load defaults and layout normalization stay in V1 and create no separate upgrade transaction. SQLite's
  existing internal structure versions are not reset because of the public JSON schema names.
- Freezing the data contract, the compatibility range and migrations are decided when store-launch planning starts;
  this work is not done ahead of time during testing.

## Consequences

### Positive

- During testing there is no extra schema upgrade, snapshot capacity or cross-test-version compatibility upkeep.
- Basic format recognition and normal data storage are still validated.

### Negative

- No long-term compatibility is promised between test formats that have not been delivered.

### Neutral

- The app package version and the data schema are separate; this change does not alter the package version, existing
  tags or releases.

## Alternatives Considered

The earlier V1→V2 bump with a full migration mechanism: withdrawn at the maintainer's explicit request and deferred to
store-launch planning.

## References

- [SPEC-007](../specs/007-schema-evolution-and-migrations.md), [PLAN-007](../plans/007-schema-evolution-and-migrations.md)
- [Requirements](../requirements.md), [AGENTS](../../AGENTS.md), [PROGRESS](../../PROGRESS.md)
