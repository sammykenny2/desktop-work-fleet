# SPEC-013: Final product identity and Release distribution

## Metadata

| Field | Value |
|---|---|
| Status | Approved requirements and working defaults; implementation in progress under PLAN-014 |
| Owner | Project maintainer |
| Reviewer | Independent implementation review and maintainer device acceptance pending |
| Decisions | [ADR-069](../decisions/069-pin-it-anywhere-product-identity.md), [ADR-070](../decisions/070-release-channels-and-architecture.md) |
| Related Plan | [PLAN-014](../plans/014-product-identity-and-distribution.md) |

## Summary

Apply the final product identity coherently across native apps, OAuth, installation and update paths, then collect
feedback from signed Release builds through the intended desktop and mobile channels. The ADRs own the exact names
and format choices; this specification owns the required behavior and acceptance evidence.

## Goals

- Show the correct localized product identity while keeping technical identifiers stable across versions.
- Preserve access to existing local/cloud notes through an explicit, verified identity cutover.
- Make every distributed build installable and updatable through its actual channel without developer trust setup.
- Exercise Android and iOS beta distribution and native Windows ARM64 before claiming their support.

## Non-Goals

- A new task-state model, third-party source integrations, new automatic schema migrations or automatic cloud cleanup.
- Renaming historical releases, choosing a release version or publishing as part of the documentation task.
- A Windows portable/NSIS product, default macOS PKG, or immediate AppImage delivery.

## Requirements

| ID | Requirement |
|---|---|
| FR01 | Product names and application identifiers match ADR-069 in native metadata, launcher entries, locale catalogs, About/Settings, sharing, OAuth branding and store materials. Other locales default to the English product name. |
| FR02 | Repository links, CI checkout/update configuration, download URLs and future asset naming agree after a repo rename. Existing installed clients get a verified update or explicit manual transition; redirects alone are not acceptance. |
| FR03 | Changing Google projects or installed app identities requires a complete backup and a documented restore route before old access is retired. The old credentials, cloud data and local data are not deleted or revoked automatically. |
| FR04 | OAuth clients, callback schemes and Android certificate fingerprints match the actual app identity and signing channel. A new client's sign-in works on each supported platform, including after restart. |
| FR05 | Apple main app, extension, App Group and Keychain entitlements match the new IDs and correct provisioning profiles. Sharing reaches the intended app; old storage access is not assumed. |
| FR06 | Every distributed app meets ADR-070's Release/signing policy. Validation inspects actual build configuration, signatures and entitlements, rather than trusting artifact names. Debug development/CI outputs remain outside distribution sets. |
| FR07 | The future GitHub asset contract rejects CERs and Debug deliverables. Install instructions require no manually trusted preview certificate. Update archives, metadata and checksums remain included where required. |
| FR08 | Windows direct installation, native x64/ARM64 selection and subsequent updates validate the chosen package identity, publisher, version and compatible architecture. MSIX data retention and uninstall behavior continue to follow ADR-037. |
| FR09 | A macOS Universal DMG installs the app into Applications; the installed app updates through the signed ZIP/appcast with data preserved. Both CPU architectures are included and runtime acceptance is distinguished from package inspection. |
| FR10 | Linux DEB installation, system dependencies, startup, desktop entry, uninstall and verified in-app update work on the declared supported environments. The package architecture field accurately describes its contents. |
| FR11 | Any future AppImage must pass its own startup, stable-path, menu integration and update acceptance before it appears as a supported download. Changing download format must not leave visible actions that cannot complete. |
| FR12 | Google Play closed testing meets the project's tester target and applicable account rules; iOS TestFlight exercises external distribution. Feedback covers capture/editing, local/cloud notes, sync, sharing, backups and restart, with defects fed back into ordinary development. |
| FR13 | Evaluate format freeze and backup compatibility before inviting external testers. Existing V1 policy remains until an explicit follow-up decision; no implicit migration or data-discard authorization follows from naming or store preparation. |

## Design Overview

Resolve permanent identities and signing first, verify backup/restore with the old and new apps, then change public
surfaces and distribution pipelines together. Initial installation containers and updater payloads can differ; the
host must validate the one it actually consumes. Mobile stores handle their own update delivery.

## Acceptance

| Case | Required evidence |
|---|---|
| C01 Localized identity | Installed apps and extension show the selected product name under English and zh-TW system settings; other locales fall back as intended; technical IDs remain identical across locale switches. |
| C02 Identity cutover | Complete exports from old local and cloud collections are restored in the new identity; content, attachments and required metadata are checked; old copies remain available until accepted. |
| C03 Google cutover | Actual new-project clients sign in and refresh on native platforms; old/new app-data visibility is measured with a test account, and no unexplained empty cloud is treated as data deletion. |
| C04 Apple signing and sharing | Distribution signatures/profiles/entitlements agree for app and extension; real-device sharing and restart work; no development-device IPA is hosted publicly. |
| C05 Release asset inspection | Every channel's actual artifacts pass build-mode and signing checks; a CER or Debug artifact fails future release validation; development unit tests can still run in Debug. |
| C06 Windows x64 and ARM64 | Clean install and old-to-new update on both native architectures, including bundle selection, signature/publisher rejection, startup and data lifetime. |
| C07 macOS install and update | DMG install into Applications followed by a Sparkle update; arm64 and Intel runtime checks, with signature rejection and data preservation. |
| C08 Linux DEB | Clean install, menu launch, sign-in startup, update/cancel, dependencies and uninstall on each declared supported Debian-family environment. |
| C09 Mobile beta feedback | Release AAB reaches the closed track and Release iOS archive reaches external TestFlight; actual testers provide feedback and the applicable production-access steps are checked separately. |
| C10 Optional format gate | AppImage or PKG is advertised only after format-specific signing/runtime, first install, startup and old-to-new update checks; one format's success does not establish another's. |

## Dependencies and Open Questions

- Final external identities still listed as unresolved in ADR-069, actual signing credentials, account permissions,
  tester recruitment and available native devices.
- The format-freeze review must decide what compatibility external testers are promised; the current V1 policy does
  not already answer that question.
- Decide the tester feedback destination, supported device/OS matrix and any later production release channel.
  Existing preview-feed behavior in SPEC-006 remains until its channel question is resolved.

## References

- [SPEC-006: startup and updates](006-desktop-window-startup-and-updates.md),
  [SPEC-007: current data policy](007-schema-evolution-and-migrations.md),
  [SPEC-002: complete backup](002-portable-backup-and-restore.md).
- [Deployment](../deployment.md), [Testing](../testing.md).

---

*Created: 2026-11-13*
