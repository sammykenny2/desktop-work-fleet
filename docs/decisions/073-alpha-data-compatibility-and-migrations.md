# ADR-073: Preserve installed data as alpha testing approaches

## Status

Accepted, 2026-11-14, at the maintainer's explicit request. Supersedes
[ADR-051](051-schema-evolution-and-atomic-migrations.md)'s restriction to V1 and its deferral of migration work until
store planning. Requirements and ongoing change gates are in
[SPEC-007](../specs/007-schema-evolution-and-migrations.md) and
[PLAN-007](../plans/007-schema-evolution-and-migrations.md).

## Context

The product is approaching alpha testing. Installed user/tester data and exported backups must now be considered
when changing a format. The earlier assumption that test formats could change incompatibly inside V1 is no longer
appropriate. Removing that assumption does not itself make historical incompatible formats readable or authorize
resetting data, editing immutable cloud history, or changing an application release version.

## Decision

- Schema versions may advance when a format requires it. Assess compatibility for every persisted change rather
  than freezing all schemas or increasing every schema together. Package versions remain independent and retain
  the existing explicit target-version approval requirement.
- Additive optional fields may retain a schema version when absence has a safe meaning and existing data/backups
  can be opened and saved without losing content or unknown supported fields. Test that path with prior-format
  fixtures. Record downgrade limitations rather than promising old clients understand new features.
- Incompatible changes require an explicit source/target version or format discriminator and a deterministic
  migration before the new writer is enabled. Validate inputs and transformed outputs; preserve ownership, note
  identities, content, history, unsaved changes, attachment references and pending sync intent.
- A local migration publishes only a fully validated durable result. Use the existing transactional/receipt
  facilities where sufficient; otherwise stage a new generation and atomically switch its pointer. Interruption,
  storage-full, unknown acknowledgment and restart must preserve a recoverable old state and permit an idempotent
  retry. Do not use an in-place destructive rewrite followed by an optimistic success message.
- Backup readers support the declared earlier formats through validated in-memory conversion. Preserve the original
  ZIP. Preview adoption and identity mapping under existing restore rules; a migration must not silently change the
  destination account or import another profile's private data.
- Shared protocol changes also specify mixed-client behavior, minimum writers and safe pause/recovery. Never rewrite
  immutable cloud revisions merely to change a label, and never silently reset Google data to admit a new client.
- Unknown future or unsupported historical formats remain intact and are refused with an accurate explanation and
  recovery route. Existing historical incompatibilities are inventory items, not proof that they have been migrated.
- Each format-affecting commit owns its compatibility decision, fixtures, failure/restart tests and documentation.
  Reusable migration machinery is added when an actual change needs it; no universal runner is required for a
  compatible optional field. Independent review and installed-host acceptance are reported separately from tests.

## Consequences

### Positive

- Alpha updates can evolve formats while treating testers' data as durable user data.
- Compatible additions remain small; incompatible changes have an explicit, testable recovery contract.
- Local storage, cloud protocol, backup format and application releases can evolve independently.

### Negative

- Format work must maintain fixtures and exercise failures, not only clean-install behavior.
- Supported old versions, cloud mixed-client operation and downgrade limits must be decided for each incompatible
  change; this policy alone does not solve historical data conversion.

### Neutral

- Current format constants remain unchanged by this policy decision. No application version, cloud data, installed
  database or backup is modified by the documentation/policy change.
- Desktop stacking's optional labels can use an absence fallback and preserve V1 readability; its implementation
  must still demonstrate old-layout and backup round trips under this policy.

## Alternatives Considered

| Alternative | Reason not chosen |
|---|---|
| Continue incompatible V1 changes until store planning | Conflicts with the maintainer's alpha/tester data-protection requirement |
| Increase every schema for every field | Unnecessary conversions and mixed-client risk for compatible additions |
| Require users to reset after each format change | Discards installed work rather than providing a migration |
| Automatically accept unknown future versions | Cannot validate their semantics or promise lossless rewriting |

## References

- [SPEC-007](../specs/007-schema-evolution-and-migrations.md),
  [PLAN-007](../plans/007-schema-evolution-and-migrations.md).
- [ADR-008](008-portable-interaction-core.md), [SPEC-002](../specs/002-portable-backup-and-restore.md),
  [ADR-072](072-persistent-desktop-note-stacking.md).

---

*Decision made: 2026-11-14*
