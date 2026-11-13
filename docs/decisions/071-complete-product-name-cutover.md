# ADR-071: Complete product-name cutover

## Status

Accepted, 2026-11-14. The maintainer requires the current repository, including source names and assets, to use the
selected product identity throughout. This supersedes ADR-069's internal-name deferral and the old manifest-name
compatibility choices in ADR-044. Historical documents and published releases remain historical records.

## Context

Display and download renaming left implementation identifiers, project paths, configuration keys and updater lookup
names behind. Those names are visible to maintainers and in generated products, so a display-only change is incomplete.

## Decision

- Use `Pin It Anywhere` for English display text, `PinItAnywhere` for native types, targets, assemblies and app products,
  `pin-it-anywhere` for filenames and protocol names, `pin_it_anywhere` for Python names, `pinItAnywhere` for JavaScript
  properties, and `PIN_IT_ANYWHERE_` for project environment/build settings. Drive application-property keys use `pia`.
- Keep the registered Apple/Android identifier `dev.sammykenny2.pinitanywhere`, its `.share` extension and
  `group.dev.sammykenny2.pinitanywhere`. Align new Windows and Linux defaults with the same application identifier;
  use `pin-it-anywhere` for the Debian package and installed command. Android's source namespace is
  `dev.sammykenny2.pinitanywhere.nativehost`.
- Use `pin-it-anywhere-update-windows.json`, `pin-it-anywhere-update-linux.json` and
  `pin-it-anywhere-update-macos.json` in both release producers and native consumers. Keep the standard Sparkle name
  `appcast.xml`. Do not keep retired-name aliases in current source or publish them alongside the new manifests.
- Rename the current V1 format identifiers, native storage filenames and credential labels consistently without
  changing schema versions or adding automatic migrations, as required by ADR-051. Existing local/cloud data, signing
  keys, installed applications and public releases are not deleted or rewritten by source renaming.
- Treat pre-cutover installations as a manual-transition boundary. An older installed updater cannot discover the
  new manifest name; a changed Windows identity/publisher and Debian package name are separate installations.
  Data recovery and actual installed acceptance must be resolved before distributing that transition.
- Rename local and CI configuration keys together. A Windows preview signer must match its configured Publisher;
  replacing signing credentials or modifying their repository Secrets requires the applicable authorization.
  Source checks and unsigned builds do not establish that credential cutover.
- Enforce a regression guard over current tracked and newly added source, filenames, configuration and binary assets.
  Historical ADRs, research, handoffs, plans and version release notes retain their original prose; repair file links
  when their targets move. Current guides, specifications and procedures follow the implemented names.

## Consequences

### Positive

- The product identity agrees across implementation, packaging, updates and maintainer-facing configuration.
- A repository guard catches reintroduction of the retired identity outside documentary history.

### Negative

- Earlier preview clients and backups are not automatically compatible with renamed V1 identifiers.
- Real local-data recovery, provider acceptance and signing/setup changes need evidence beyond isolated fixtures.

### Neutral

- Package versions, published tags/releases, registered Apple/Android identities and private keys are unchanged by this
  source change. A new published version still requires explicit approval.

## Alternatives Considered

- Retain internal and updater aliases: rejected by the maintainer's explicit complete-renaming request.
- Add automatic V1 migrations or silently reset existing storage: outside the authorized naming scope and contrary to
  the current pre-store data policy.

## References

- [ADR-069: product identity](069-pin-it-anywhere-product-identity.md).
- [ADR-070: delivery policy](070-release-channels-and-architecture.md).
- [ADR-051: V1 policy](051-schema-evolution-and-atomic-migrations.md).
- [Deployment](../deployment.md), [Testing](../testing.md), [PLAN-014](../plans/014-product-identity-and-distribution.md).

---

*Decision made: 2026-11-14*
*Decision maker: Project maintainer*
